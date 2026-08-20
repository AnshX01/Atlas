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
  is_summarizing?: boolean;
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

function calculatePriorityScore(item: BriefingItemData): number {
  let score = item.priority_score || 50;
  const text = `${item.title} ${item.summary}`.toLowerCase();
  
  if (text.includes("urgent") || text.includes("asap") || text.includes("immediate") || text.includes("action required")) {
    score += 30;
  }
  
  if (item.type === "calendar") {
    const eventTime = item.timestamp ? new Date(item.timestamp).getTime() : 0;
    if (eventTime) {
      const diffHours = (eventTime - Date.now()) / (1000 * 60 * 60);
      if (diffHours >= -1 && diffHours <= 3) {
        score = 100; // max score for soon events
      } else if (diffHours > 3 && diffHours <= 24) {
        score += 20;
      }
    }
  }
  
  return Math.min(100, Math.max(1, score));
}

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
          const isGoogleTask = entry.source === "tasks";
          const title = isGoogleTask
            ? (msg?.title || "Untitled task")
            : (msg?.text?.slice(0, 80) || "Message");
          const summary = isGoogleTask
            ? (msg?.due ? `Due: ${new Date(msg.due).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}${msg?.notes ? ` — ${msg.notes}` : ""}` : (msg?.notes || "No details provided"))
            : (msg?.text || "New message");
          items.push({
            id: makeId(entry.source, "task", i, msg?.ts || msg?.id),
            type: "task",
            title,
            summary,
            source: entry.source,
            priority_score: isGoogleTask ? 65 : 50,
            action_label: isGoogleTask ? "View Task" : "Open in Slack",
            action_url: msg?.permalink || undefined,
            metadata: {
              channel: msg?.channel || msg?.channelName || "",
              sender: msg?.user || msg?.username || "",
              list: msg?.list || "",
            },
            timestamp: msg?.due || (msg?.ts ? new Date(parseFloat(msg.ts) * 1000).toISOString() : new Date().toISOString()),
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

function validateAndFormatItem(item: any, index: number): BriefingItemData | null {
  if (!item || typeof item.title !== "string" || typeof item.summary !== "string" || typeof item.type !== "string") {
    return null;
  }
  
  let deterministicId = item.id;
  if (!deterministicId || deterministicId.includes("unique-string-id") || deterministicId.includes("THE EXACT ID")) {
    const cleanTitle = String(item.title).replace(/[^a-zA-Z0-9]/g, "").slice(0, 15);
    const metaId = item.metadata?.source_id || item.metadata?.event_id || item.metadata?.pr_number;
    deterministicId = makeId(item.source || "unknown", item.type, index, metaId || cleanTitle);
  }

  return {
    id: deterministicId,
    type: validateType(item.type),
    title: String(item.title).slice(0, 120),
    summary: String(item.summary).slice(0, 500),
    source: item.source || "unknown",
    priority_score: Math.max(1, Math.min(100, Number(item.priority_score) || 50)),
    action_label: item.action_label || undefined,
    action_url: item.action_url || undefined,
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : {},
    timestamp: item.timestamp || new Date().toISOString(),
  };
}

async function generateBriefingWithOllama(rawData: RawDataEntry[], options?: { onStream?: (items: BriefingItemData[]) => void }): Promise<BriefingItemData[]> {
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
  "id": "THE EXACT ID FROM THE SOURCE DATA (e.g. id, messageId, or eventId)",
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
- Return ONLY valid JSON Lines (JSONL). Output one complete JSON object per line.
- Do NOT output a JSON array (no [ or ]). Do not use commas between lines. No markdown fences.
- Prioritize items that need action or are time-sensitive
- Limit to the top 10 most important items
- Use the "type" field that best matches: emails→"email", PRs→"pr", calendar→"calendar", slack messages→"task"
- Make summaries actionable and concise
- priority_score: 80-100 = urgent, 60-79 = important, 40-59 = informational, <40 = low priority
- CRITICAL: You MUST use the exact original ID from the source data for the "id" field so the frontend can deduplicate items.`;

  const userPrompt = `Here is today's data from my connected services:\n\n${JSON.stringify(dataSummary, null, 2)}\n\nGenerate my daily briefing items as JSON Lines (one JSON object per line).`;

  try {
    // Use sendChatMessage and collect the streamed response
    const response = await new Promise<string>((resolve, reject) => {
      let fullResponse = "";

      // Capture the unsubscribe functions returned by the preload API
      let unsubStream: (() => void) | null = null;
      let unsubEnd: (() => void) | null = null;

      const cleanup = () => {
        unsubStream?.();
        unsubEnd?.();
      };

      // Set a timeout in case Ollama is unresponsive
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Ollama timeout"));
      }, 60000);

      let buffer = "";
      const streamHandler = (chunk: string) => {
        fullResponse += chunk;
        buffer += chunk;
        
        // Split by newline to find complete JSON lines
        const lines = buffer.split('\n');
        // Keep the last line in the buffer as it might be incomplete
        buffer = lines.pop() || "";
        
        const newItems: BriefingItemData[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed);
              const validated = validateAndFormatItem(parsed, newItems.length);
              if (validated) {
                newItems.push(validated);
              }
            } catch (e) {
              // Ignore incomplete or invalid JSON lines
            }
          }
        }
        
        if (newItems.length > 0 && options?.onStream) {
          options.onStream(newItems);
        }
      };

      const streamEndHandler = () => {
        // Parse anything remaining in the buffer
        const trimmed = buffer.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
           try {
             const parsed = JSON.parse(trimmed);
             const validated = validateAndFormatItem(parsed, 0);
             if (validated && options?.onStream) {
               options.onStream([validated]);
             }
           } catch (e) { console.warn("Caught error:", e); }
        }
        
        clearTimeout(timeout);
        cleanup();
        resolve(fullResponse);
      };

      // onChatStream/onChatStreamEnd return unsubscribe functions directly
      unsubStream = electron.onChatStream(streamHandler);
      unsubEnd = electron.onChatStreamEnd(streamEndHandler);

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
    const items = await parseOllamaResponse(response);
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
import { JsonWorkerPool } from '../utils/json-worker-pool';

async function parseOllamaResponse(response: string): Promise<BriefingItemData[]> {
  let cleaned = response.trim();
  
  // Try to parse as JSONL first
  const lines = cleaned.split('\n');
  const items: BriefingItemData[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        const validated = validateAndFormatItem(parsed, items.length);
        if (validated) items.push(validated);
      } catch (e) { console.warn("Caught error:", e); }
    }
  }
  if (items.length > 0) return items;

  // Fallback to array parsing
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  try {
    const parsed = await JsonWorkerPool.parse(cleaned, 'parseArray');
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: any, index: number) => validateAndFormatItem(item, index))
      .filter((item): item is BriefingItemData => item !== null);
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
  async getDaily(options?: { onFallback?: (data: DailyBriefingResponse) => void }): Promise<DailyBriefingResponse> {
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

    // 4. Emit fallback cards immediately if a callback was provided
    const streamedItems: BriefingItemData[] = [];
    let fallbackItems: BriefingItemData[] = [];

    const getEmailCount = () => {
      const emailEntry = rawData.find((d) => d.type === "emails");
      return Array.isArray(emailEntry?.data) ? emailEntry.data.length : emailEntry?.data ? 1 : 0;
    };

    if (options?.onFallback) {
      fallbackItems = createFallbackItems(rawData).map((item) => ({
        ...item,
        priority_score: calculatePriorityScore(item),
      }));
      const focusScore = Math.min(100, fallbackItems.length * 15);
      const focusScoreLabel =
        fallbackItems.length > 5 ? "Busy" : fallbackItems.length > 2 ? "Moderate" : "Light";

      options.onFallback({
        date: new Date().toISOString(),
        focus_score: focusScore,
        focus_score_label: focusScoreLabel,
        items: fallbackItems,
        total_unread: getEmailCount(),
        generated_at: new Date().toISOString(),
        is_summarizing: false,
      });
    }

    // 5. Generate briefing items and proactive suggestion in parallel
    const ollamaPromise = generateBriefingWithOllama(rawData, {
      onStream: (newItems) => {
        streamedItems.push(...newItems);
        const updatedStreamedItems = streamedItems.map(item => ({
          ...item,
          priority_score: calculatePriorityScore(item),
        }));
        updatedStreamedItems.sort((a, b) => b.priority_score - a.priority_score);

        const combined = [...updatedStreamedItems];
        for (const fb of fallbackItems) {
           if (!combined.some(i => i.id === fb.id || (i.source === fb.source && i.type === fb.type && combined.length >= 10))) {
              if (combined.length < 15) {
                combined.push(fb);
              }
           }
        }
        combined.sort((a, b) => b.priority_score - a.priority_score);

        if (options?.onFallback) {
          options.onFallback({
            date: new Date().toISOString(),
            focus_score: Math.min(100, combined.length * 15),
            focus_score_label: combined.length > 5 ? "Busy" : combined.length > 2 ? "Moderate" : "Light",
            items: combined,
            total_unread: getEmailCount(),
            generated_at: new Date().toISOString(),
            is_summarizing: false,
          });
        }
      }
    });

    const [itemsRaw] = await Promise.all([ollamaPromise]);

    const items = itemsRaw.map((item: any) => ({
      ...item,
      priority_score: calculatePriorityScore(item),
    }));
    
    // Sort items by calculated priority
    items.sort((a: any, b: any) => b.priority_score - a.priority_score);


    // 6. Compute focus score
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
      is_summarizing: false,
    };
  },
};
