/**
 * Atlas — Briefing API (fully local).
 * Generates daily briefings using Electron MCP servers + Ollama.
 * No Docker/backend dependency required.
 */

import type { BriefingItemData } from "@/components/composite/BriefingCard";

export interface DailyBriefingResponse {
  date: string;
  focus_score: number;
  focus_score_label: string;
  items: BriefingItemData[];
  total_unread: number;
  generated_at: string;
}

interface RawDataEntry {
  source: string;
  type: "emails" | "events" | "pull_requests" | "messages";
  data: any;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function emptyBriefing(): DailyBriefingResponse {
  return {
    date: new Date().toISOString(),
    focus_score: 0,
    focus_score_label: "No Data",
    items: [],
    total_unread: 0,
    generated_at: new Date().toISOString(),
  };
}

function getElectron() {
  if (typeof window === "undefined") return null;
  return (window as any).atlasElectron ?? null;
}

/**
 * Generate a stable ID for a briefing item based on its source data.
 */
function makeId(source: string, type: string, index: number, identifier?: string): string {
  const base = identifier || `${index}`;
  return `briefing-${source}-${type}-${base}`.replace(/[^a-zA-Z0-9-]/g, "_");
}

// ── Fallback: create briefing items without AI ─────────────────────────────────

function createFallbackItems(rawData: RawDataEntry[]): BriefingItemData[] {
  const items: BriefingItemData[] = [];

  for (const entry of rawData) {
    const dataArray = Array.isArray(entry.data) ? entry.data : [entry.data];

    switch (entry.type) {
      case "emails":
        for (let i = 0; i < Math.min(dataArray.length, 5); i++) {
          const email = dataArray[i];
          items.push({
            id: makeId(entry.source, "email", i, email?.id || email?.messageId),
            type: "email",
            title: email?.subject || email?.title || "New email",
            summary: email?.snippet || email?.preview || email?.body?.slice(0, 200) || "No preview available.",
            source: entry.source,
            priority_score: 60,
            action_label: "Open in Gmail",
            action_url: email?.id ? `https://mail.google.com/mail/u/0/#inbox/${email.id}` : undefined,
            metadata: {
              sender: email?.from || email?.sender || "",
              sender_name: email?.fromName || email?.senderName || "",
              subject: email?.subject || "",
              source_id: email?.id || email?.messageId || "",
            },
            timestamp: email?.date || email?.receivedAt || new Date().toISOString(),
          });
        }
        break;

      case "events":
        for (let i = 0; i < Math.min(dataArray.length, 5); i++) {
          const event = dataArray[i];
          items.push({
            id: makeId(entry.source, "calendar", i, event?.id || event?.eventId),
            type: "calendar",
            title: event?.summary || event?.title || "Calendar event",
            summary: event?.description || `Scheduled for ${event?.start?.dateTime || event?.startTime || "today"}`,
            source: entry.source,
            priority_score: 70,
            action_label: "Open in Calendar",
            action_url: event?.htmlLink || undefined,
            metadata: {
              event_id: event?.id || event?.eventId || "",
              attendees: event?.attendees?.map((a: any) => a.email || a) || [],
              start_time: event?.start?.dateTime || event?.startTime || "",
              end_time: event?.end?.dateTime || event?.endTime || "",
            },
            timestamp: event?.start?.dateTime || event?.startTime || new Date().toISOString(),
          });
        }
        break;

      case "pull_requests":
        for (let i = 0; i < Math.min(dataArray.length, 5); i++) {
          const pr = dataArray[i];
          items.push({
            id: makeId(entry.source, "pr", i, pr?.id || pr?.number?.toString()),
            type: "pr",
            title: pr?.title || "Pull Request",
            summary: pr?.body?.slice(0, 200) || `PR #${pr?.number || "?"} needs review`,
            source: "github",
            priority_score: 65,
            action_label: "View Pull Request",
            action_url: pr?.html_url || pr?.url || undefined,
            metadata: {
              repo: pr?.head?.repo?.full_name || pr?.repository || pr?.repo || "",
              pr_number: pr?.number || "",
              url: pr?.html_url || pr?.url || "",
              author: pr?.user?.login || pr?.author || "",
            },
            timestamp: pr?.updated_at || pr?.created_at || new Date().toISOString(),
          });
        }
        break;

      case "messages":
        for (let i = 0; i < Math.min(dataArray.length, 5); i++) {
          const msg = dataArray[i];
          items.push({
            id: makeId(entry.source, "task", i, msg?.ts || msg?.id),
            type: "task",
            title: msg?.text?.slice(0, 80) || "Slack message",
            summary: msg?.text || "New message in Slack",
            source: "slack",
            priority_score: 50,
            action_label: "Open in Slack",
            action_url: msg?.permalink || undefined,
            metadata: {
              channel: msg?.channel || msg?.channelName || "",
              sender: msg?.user || msg?.username || "",
            },
            timestamp: msg?.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : new Date().toISOString(),
          });
        }
        break;
    }
  }

  // Sort by priority descending
  items.sort((a, b) => b.priority_score - a.priority_score);
  return items.slice(0, 15);
}

// ── AI-powered briefing generation via Ollama ──────────────────────────────────

async function generateBriefingWithOllama(rawData: RawDataEntry[]): Promise<BriefingItemData[]> {
  const electron = getElectron();
  if (!electron?.sendChatMessage) {
    return createFallbackItems(rawData);
  }

  // Prepare a compact summary of the raw data for the prompt
  const dataSummary = rawData.map((entry) => {
    const dataArray = Array.isArray(entry.data) ? entry.data : [entry.data];
    return {
      source: entry.source,
      type: entry.type,
      count: dataArray.length,
      items: dataArray.slice(0, 8).map((item: any) => {
        // Strip large fields to keep prompt size manageable
        const { body, description, content, ...compact } = item || {};
        return {
          ...compact,
          body: body?.slice(0, 150),
          description: description?.slice(0, 150),
        };
      }),
    };
  });

  const systemPrompt = `You are Atlas, an AI assistant that generates daily briefing items from a user's connected services data.

Analyze the provided data and produce a JSON array of briefing items. Each item must have this exact shape:
{
  "id": "unique-string-id",
  "type": "email" | "pr" | "issue" | "calendar" | "document" | "task",
  "title": "Brief descriptive title (max 80 chars)",
  "summary": "1-2 sentence summary of why this matters or what action is needed",
  "source": "gmail" | "calendar" | "github" | "slack" | "notion",
  "priority_score": <number 1-100, higher = more urgent>,
  "action_label": "Open in Gmail" | "View Pull Request" | etc,
  "metadata": { relevant key-value pairs like sender, repo, etc },
  "timestamp": "ISO timestamp from the original data"
}

Rules:
- Return ONLY valid JSON array, no markdown fences, no explanation
- Prioritize items that need action or are time-sensitive
- Limit to the top 10 most important items
- Use the "type" field that best matches: emails→"email", PRs→"pr", calendar→"calendar", slack messages→"task"
- Make summaries actionable and concise
- priority_score: 80-100 = urgent, 60-79 = important, 40-59 = informational, <40 = low priority`;

  const userPrompt = `Here is today's data from my connected services:\n\n${JSON.stringify(dataSummary, null, 2)}\n\nGenerate my daily briefing items as a JSON array.`;

  try {
    // Use sendChatMessage and collect the streamed response
    const response = await new Promise<string>((resolve, reject) => {
      let fullResponse = "";
      let streamEndHandler: (() => void) | null = null;
      let streamHandler: ((chunk: string) => void) | null = null;

      const cleanup = () => {
        if (streamHandler) electron.removeOnChatStream?.(streamHandler);
        if (streamEndHandler) electron.removeOnChatStreamEnd?.(streamEndHandler);
      };

      // Set a timeout in case Ollama is unresponsive
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Ollama timeout"));
      }, 60000);

      streamHandler = (chunk: string) => {
        fullResponse += chunk;
      };

      streamEndHandler = () => {
        clearTimeout(timeout);
        cleanup();
        resolve(fullResponse);
      };

      electron.onChatStream(streamHandler);
      electron.onChatStreamEnd(streamEndHandler);

      electron.sendChatMessage(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        "llama3:8b"
      ).catch((err: Error) => {
        clearTimeout(timeout);
        cleanup();
        reject(err);
      });
    });

    // Parse the JSON response from Ollama
    const items = parseOllamaResponse(response);
    if (items.length > 0) return items;

    // If parsing failed, fall back to non-AI items
    return createFallbackItems(rawData);
  } catch {
    // Ollama unavailable or errored — use fallback
    return createFallbackItems(rawData);
  }
}

/**
 * Parse Ollama's response which should be a JSON array of briefing items.
 * Handles common LLM quirks like markdown code fences or extra text.
 */
function parseOllamaResponse(response: string): BriefingItemData[] {
  let cleaned = response.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Try to find a JSON array in the response
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate and sanitize each item
    return parsed
      .filter(
        (item: any) =>
          item &&
          typeof item.title === "string" &&
          typeof item.summary === "string" &&
          typeof item.type === "string"
      )
      .map((item: any, index: number) => ({
        id: item.id || makeId(item.source || "unknown", item.type, index),
        type: validateType(item.type),
        title: String(item.title).slice(0, 120),
        summary: String(item.summary).slice(0, 500),
        source: item.source || "unknown",
        priority_score: Math.max(1, Math.min(100, Number(item.priority_score) || 50)),
        action_label: item.action_label || undefined,
        action_url: item.action_url || undefined,
        metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
        timestamp: item.timestamp || new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function validateType(type: string): BriefingItemData["type"] {
  const valid: BriefingItemData["type"][] = ["email", "pr", "issue", "calendar", "document", "task"];
  return valid.includes(type as any) ? (type as BriefingItemData["type"]) : "task";
}

// ── Data Fetching from MCP Servers ─────────────────────────────────────────────

async function fetchMCPData(electron: any, configured: string[]): Promise<RawDataEntry[]> {
  const rawData: RawDataEntry[] = [];

  const fetchers: Array<() => Promise<void>> = [];

  if (configured.includes("google_workspace")) {
    fetchers.push(async () => {
      try {
        const emails = await electron.mcpCallTool("google_workspace", "search_emails", {
          query: "is:inbox newer_than:1d",
          maxResults: 10,
        });
        if (emails && !emails.error) {
          rawData.push({ source: "gmail", type: "emails", data: emails });
        }
      } catch { /* connector unavailable */ }
    });

    fetchers.push(async () => {
      try {
        const events = await electron.mcpCallTool("google_workspace", "list_calendar", {});
        if (events && !events.error) {
          rawData.push({ source: "calendar", type: "events", data: events });
        }
      } catch { /* connector unavailable */ }
    });

    fetchers.push(async () => {
      try {
        const tasks = await electron.mcpCallTool("google_workspace", "list_tasks", {});
        if (tasks && !tasks.error && Array.isArray(tasks) && tasks.length > 0) {
          rawData.push({ source: "tasks", type: "messages" as any, data: tasks.map((t: any) => ({ text: `Task: ${t.title}${t.due ? ` (due: ${t.due})` : ''}${t.notes ? ` - ${t.notes}` : ''}`, ...t })) });
        }
      } catch { /* connector unavailable */ }
    });
  }

  if (configured.includes("github")) {
    fetchers.push(async () => {
      try {
        const prs = await electron.mcpCallTool("github", "list_prs", { state: "open" });
        if (prs && !prs.error) {
          rawData.push({ source: "github", type: "pull_requests", data: prs });
        }
      } catch { /* connector unavailable */ }
    });
  }

  if (configured.includes("slack")) {
    fetchers.push(async () => {
      try {
        const msgs = await electron.mcpCallTool("slack", "read_messages", { query: "" });
        if (msgs && !msgs.error) {
          rawData.push({ source: "slack", type: "messages", data: msgs });
        }
      } catch { /* connector unavailable */ }
    });
  }

  // Fetch all in parallel for speed
  await Promise.allSettled(fetchers.map((fn) => fn()));

  return rawData;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const briefingAPI = {
  /**
   * Generate a daily briefing locally using MCP servers + Ollama.
   * Falls back gracefully if Ollama is unavailable or no connectors are configured.
   */
  async getDaily(): Promise<DailyBriefingResponse> {
    const electron = getElectron();
    if (!electron) {
      return emptyBriefing();
    }

    // 1. Check which connectors are configured
    let configured: string[] = [];
    try {
      configured = await electron.tokenStore.listConfigured();
    } catch {
      return emptyBriefing();
    }

    if (!configured || configured.length === 0) {
      return emptyBriefing();
    }

    // 2. Fetch data from each configured MCP connector in parallel
    const rawData = await fetchMCPData(electron, configured);

    // 3. If no data was fetched, return empty
    if (rawData.length === 0) {
      return emptyBriefing();
    }

    // 4. Generate briefing items (AI-powered with Ollama, fallback to direct formatting)
    const items = await generateBriefingWithOllama(rawData);

    // 5. Compute focus score
    const focusScore = Math.min(100, items.length * 15);
    const focusScoreLabel =
      items.length > 5 ? "Busy" : items.length > 2 ? "Moderate" : "Light";

    // 6. Count unread emails
    const emailEntry = rawData.find((d) => d.type === "emails");
    const totalUnread = Array.isArray(emailEntry?.data)
      ? emailEntry.data.length
      : emailEntry?.data
        ? 1
        : 0;

    return {
      date: new Date().toISOString(),
      focus_score: focusScore,
      focus_score_label: focusScoreLabel,
      items,
      total_unread: totalUnread,
      generated_at: new Date().toISOString(),
    };
  },
};
