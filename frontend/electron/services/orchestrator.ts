/**
 * Atlas Orchestrator — LangGraph-style Local State Machine
 *
 * Replaces the cloud-based supervisor agent with a local routing engine
 * running in the Electron main process. Implements a directed graph of nodes:
 *
 *   Input → Router → [Search | Action | Chat]
 *                          ↓         ↓
 *                      Execute   Draft → Approval → Execute
 *                          ↓         ↓         ↓
 *                       Response ← ← ← ← ← ← ←
 *
 * Destructive actions generate a draft first, then pause at Approval and
 * require user confirmation before proceeding to Execute.
 */

import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { streamChat } from "./ollama";
import { classifyIntent, Intent, resolveEntities, splitMultiIntent } from "./intent-classifier";
import { MCPServerManager } from "./mcp-manager";
import { repairAndParseJson, MissingArgumentError } from "./json-repair";
import {
  initDB,
  createConversation,
  saveMessage,
  getConversationHistory,
  saveToolExecution,
  Message,
  saveWorkflowCheckpoint,
  deleteWorkflowCheckpoint,
  getAllWorkflowCheckpoints
} from "./local-store";
import { initRAGStore, searchContext, storeContext } from "./memory-rag";
import { listConfigured } from "./token-store";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowState {
  input: string;
  userId: string;
  conversationId: string;
  intent: Intent;
  context: any[];
  toolCalls: Array<{
    id?: string;
    server: string;
    tool: string;
    params: Record<string, unknown>;
    result?: unknown;
    error?: string;
  }>;
  plannedTools?: Array<{
    id?: string;
    server: string;
    tool: string;
    params: Record<string, unknown>;
  }>;
  response: string;
  requiresApproval: boolean;
  approved: boolean;
  draft?: DraftResult;
  error?: string;
}

export interface DraftResult {
  executionId: string;
  actionType: string;
  fields: Record<string, string>;
  description: string;
}

export interface PendingApproval {
  executionId: string;
  conversationId: string;
  state: WorkflowState;
  resolve: (approved: boolean) => void;
  createdAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DESTRUCTIVE_TOOLS = new Set([
  "send_email",
  "reply_email",
  "forward_email",
  "create_task",
  "complete_task",
  "update_task",
  "merge_pr",
  "close_pr",
  "close_issue",
  "create_issue",
  "post_message",
  "send_message",
  "update_page",
  "create_page",
  "delete_page",
  "delete_file",
  "write_file",
  "move_file",
  "create_event",
  "schedule_event",
  "delete_event",
  "create_branch",
  "create_pull_request",
]);

const READONLY_TOOLS = new Set([
  "read_emails",
  "search_emails",
  "list_emails",
  "list_calendar",
  "get_calendar_event",
  "list_tasks",
  "search_repo",
  "list_prs",
  "get_pr",
  "list_issues",
  "get_issue",
  "read_file",
  "list_directory",
  "search_files",
  "list_channels",
  "read_messages",
  "search_messages",
  "search_pages",
  "get_page",
]);

// NOTE: Some keywords (e.g. 'email', 'message', 'post') also appear in ACTION_KEYWORDS
// in intent-classifier.ts. This is intentional — TOOL_ROUTING maps keywords to candidate
// tools, but resolveTools() filters by READONLY_TOOLS or DESTRUCTIVE_TOOLS based on the
// classified intentType. So 'email' as a search query routes to search_emails (readonly),
// while 'email' as an action routes to send_email (destructive). No conflict.
const TOOL_ROUTING: Record<string, { server: string; tool: string }[]> = {
  email: [
    { server: "google_workspace", tool: "search_emails" },
    { server: "google_workspace", tool: "send_email" },
  ],
  emails: [
    { server: "google_workspace", tool: "search_emails" },
  ],
  mail: [
    { server: "google_workspace", tool: "search_emails" },
    { server: "google_workspace", tool: "send_email" },
  ],
  send: [
    { server: "google_workspace", tool: "send_email" },
    { server: "slack", tool: "send_message" },
  ],
  compose: [
    { server: "google_workspace", tool: "send_email" },
  ],
  draft: [
    { server: "google_workspace", tool: "send_email" },
  ],
  reply: [
    { server: "google_workspace", tool: "reply_email" },
    { server: "slack", tool: "send_message" },
  ],
  inbox: [
    { server: "google_workspace", tool: "search_emails" },
  ],
  gmail: [
    { server: "google_workspace", tool: "search_emails" },
    { server: "google_workspace", tool: "send_email" },
  ],
  calendar: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  meeting: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  meetings: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  schedule: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  event: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  task: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "create_task" },
  ],
  tasks: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "create_task" },
  ],
  todo: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "create_task" },
  ],
  todos: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "create_task" },
  ],
  tomorrow: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  today: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  pr: [
    { server: "github", tool: "list_prs" },
    { server: "github", tool: "get_pr" },
  ],
  "pull request": [
    { server: "github", tool: "list_prs" },
    { server: "github", tool: "get_pr" },
  ],
  review: [
    { server: "github", tool: "list_prs" },
  ],
  issue: [
    { server: "github", tool: "list_issues" },
    { server: "github", tool: "get_issue" },
  ],
  merge: [
    { server: "github", tool: "merge_pr" },
  ],
  repo: [
    { server: "github", tool: "list_prs" },
    { server: "github", tool: "list_issues" },
  ],
  slack: [
    { server: "slack", tool: "search_messages" },
    { server: "slack", tool: "read_messages" },
  ],
  channel: [
    { server: "slack", tool: "search_messages" },
    { server: "slack", tool: "read_messages" },
  ],
  message: [
    { server: "slack", tool: "read_messages" },
    { server: "slack", tool: "search_messages" },
    { server: "slack", tool: "post_message" },
    { server: "slack", tool: "send_message" },
  ],
  notion: [
    { server: "notion", tool: "search_pages" },
    { server: "notion", tool: "get_page" },
  ],
  doc: [
    { server: "notion", tool: "search_pages" },
    { server: "google_workspace", tool: "search_emails" },
    { server: "filesystem", tool: "search_files" },
  ],
  page: [
    { server: "notion", tool: "search_pages" },
    { server: "notion", tool: "get_page" },
  ],
  document: [
    { server: "notion", tool: "search_pages" },
    { server: "google_workspace", tool: "search_emails" },
    { server: "filesystem", tool: "search_files" },
  ],
  "to do": [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "create_task" },
    { server: "notion", tool: "search_pages" },
  ],
  assignment: [
    { server: "notion", tool: "search_pages" },
    { server: "google_workspace", tool: "search_emails" },
    { server: "filesystem", tool: "search_files" },
  ],
  file: [
    { server: "filesystem", tool: "read_file" },
    { server: "filesystem", tool: "search_files" },
    { server: "filesystem", tool: "list_directory" },
  ],
  forward: [
    { server: "google_workspace", tool: "forward_email" },
  ],
  "set up a meeting": [
    { server: "google_workspace", tool: "create_event" },
  ],
  "add to calendar": [
    { server: "google_workspace", tool: "create_event" },
  ],
  "create event": [
    { server: "google_workspace", tool: "create_event" },
  ],
  "book": [
    { server: "google_workspace", tool: "create_event" },
  ],
  post: [
    { server: "slack", tool: "post_message" },
  ],
  "send message": [
    { server: "slack", tool: "send_message" },
  ],
  "create issue": [
    { server: "github", tool: "create_issue" },
  ],
  "open issue": [
    { server: "github", tool: "create_issue" },
  ],
  branch: [
    { server: "github", tool: "create_branch" },
  ],
  "create branch": [
    { server: "github", tool: "create_branch" },
  ],
  "create pull request": [
    { server: "github", tool: "create_pull_request" },
  ],
  "open pr": [
    { server: "github", tool: "create_pull_request" },
  ],
  "create page": [
    { server: "notion", tool: "create_page" },
  ],
  "add to notion": [
    { server: "notion", tool: "create_page" },
  ],
  "write note": [
    { server: "notion", tool: "create_page" },
  ],
  "add note": [
    { server: "notion", tool: "create_page" },
  ],
};


// ── Standalone response keywords (issue #7) ───────────────────────────────────
// Short follow-ups that are themselves actionable and should NOT be concatenated
// with the previous message for routing context enrichment.
const STANDALONE_RESPONSE_KEYWORDS = new Set([
  "yes", "no", "ok", "okay", "sure", "approve", "reject", "cancel",
  "send it", "send", "confirm", "deny", "stop", "go ahead", "do it",
  "nevermind", "never mind", "skip", "done", "thanks", "thank you",
]);

// ── Approval TTL ───────────────────────────────────────────────────────────────
export const APPROVAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── ISO-8601 date regex ────────────────────────────────────────────────────────
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE_LOOSE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function sanitizeText(str: string): string {
  return str
    .replace(/[\u034F\u200B\u200C\u200D\uFEFF\u00AD\u00A0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatFriendlyDate(d: Date): string {
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (isToday) return `Today at ${timeStr}`;
  if (isYesterday) return `Yesterday at ${timeStr}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined }) + ` at ${timeStr}`;
}

/**
 * Recursively walks an object/array and reformats date strings (ISO-8601 and RFC-2822)
 * into friendly readable form (e.g. 'Today at 7:16 AM' or 'Aug 22 at 7:16 AM')
 * and strips invisible zero-width characters.
 */
function humanizeDates(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const sanitized = sanitizeText(obj);
    if (
      ISO_DATE_LOOSE_REGEX.test(sanitized) ||
      ISO_DATE_REGEX.test(sanitized) ||
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/i.test(sanitized)
    ) {
      try {
        const d = new Date(sanitized);
        if (!isNaN(d.getTime())) {
          return formatFriendlyDate(d);
        }
      } catch (e) { console.warn("Caught error:", e); }
    }
    return sanitized;
  }
  if (Array.isArray(obj)) {
    return obj.map(humanizeDates);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = humanizeDates(value);
    }
    return result;
  }
  return obj;
}


// ── Orchestrator Class ─────────────────────────────────────────────────────────

export class Orchestrator {
  private mcpManager: MCPServerManager;
  private pendingApprovals: Map<string, PendingApproval> = new Map();
  private activeStreams: Map<string, AbortController> = new Map();
  private approvalCleanupInterval: NodeJS.Timeout | null = null;

  constructor(mcpManager: MCPServerManager) {
    this.mcpManager = mcpManager;
    // Evict stale pending approvals every 60 seconds to prevent memory leaks
    // and zombie approval cards that the user will never see again.
    this.approvalCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, pending] of this.pendingApprovals) {
        if (now - pending.createdAt > APPROVAL_TTL_MS) {
          console.warn(`[Orchestrator] Auto-rejecting stale approval ${id} (TTL exceeded)`);
          try { pending.resolve(false); } catch (e) { console.warn("Caught error:", e); }
          this.pendingApprovals.delete(id);
        }
      }
    }, 60_000);
  }


  public async recoverCheckpoints(mainWindow: BrowserWindow): Promise<void> {
    initDB();
    const checkpoints = getAllWorkflowCheckpoints();
    for (const cp of checkpoints) {
      console.log(`[Orchestrator] Recovering workflow for conversation: ${cp.conversationId}`);
      const state = cp.state as WorkflowState;
      
      // If it was waiting for approval, we can restore it to pending approvals
      if (state.requiresApproval && !state.approved && state.draft) {
        this.safeSend(mainWindow, "workflow-draft-ready", {
          conversationId: state.conversationId,
          draft: state.draft
        });
        
        // Setup pending approval promise without blocking the loop
        new Promise<boolean>((resolve) => {
          this.pendingApprovals.set(state.draft!.executionId, {
            executionId: state.draft!.executionId,
            conversationId: state.conversationId,
            state,
            resolve,
            createdAt: Date.now()
          });
        }).then(async (approved) => {
          if (approved) {
            state.approved = true;
            saveWorkflowCheckpoint(state.conversationId, state);
            try {
               await this.executeNode(state, mainWindow);
               await this.responseNode(state, mainWindow);
               if (state.response) {
                 saveMessage(state.conversationId, "assistant", state.response);
                 storeContext(`User: ${state.input}\nAtlas: ${state.response}`);
               }
               deleteWorkflowCheckpoint(state.conversationId);
               this.safeSend(mainWindow, "workflow-complete", {
                 conversationId: state.conversationId,
                 response: state.response,
                 intent: state.intent,
                 toolCalls: state.toolCalls,
                 results: [],
                 error: undefined,
                 cancelled: false
               });
            } catch (err) {
              console.error("[Orchestrator] Error completing recovered workflow:", err);
            }
          } else {
            // User rejected or TTL expired
            this.safeSend(mainWindow, "workflow-complete", {
              conversationId: state.conversationId,
              cancelled: true
            });
            deleteWorkflowCheckpoint(state.conversationId);
          }
        });
      } else {
        // If it was in some other state, we can either resume from scratch or just delete the checkpoint for safety
        deleteWorkflowCheckpoint(state.conversationId);
      }
    }
  }

  /** Release resources — call on app shutdown. */
  destroy(): void {
    if (this.approvalCleanupInterval) {
      clearInterval(this.approvalCleanupInterval);
      this.approvalCleanupInterval = null;
    }
    // Auto-reject all remaining pending approvals
    for (const [id, pending] of this.pendingApprovals) {
      try { pending.resolve(false); } catch (e) { console.warn("Caught error:", e); }
      this.pendingApprovals.delete(id);
    }
  }

  private safeSend(mainWindow: BrowserWindow, channel: string, ...args: any[]): void {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    } catch (e) {
      console.warn(`[Orchestrator] IPC send error on ${channel}:`, e);
    }
  }

  /**
   * Execute a full workflow for a user prompt.
   */
  async execute(
    prompt: string,
    mainWindow: BrowserWindow,
    conversationId?: string
  ): Promise<void> {
    initDB();
    initRAGStore();

    // Limit prompt to ~500 tokens (whitespace approximation)
    const promptTokens = prompt.split(/\s+/);
    if (promptTokens.length > 500) {
      prompt = promptTokens.slice(0, 500).join(" ");
    }

    if (!conversationId) {
      const title = prompt.slice(0, 50).trim() || "New Conversation";
      const conversation = createConversation(title);
      conversationId = conversation.id;
    }

    saveMessage(conversationId, "user", prompt);

    try {
      const history = getConversationHistory(conversationId, 10);
      const recent5 = history.slice(-5).map(m => ({ role: m.role, content: m.content }));
      prompt = await resolveEntities(prompt, recent5);

      const subPrompts = await splitMultiIntent(prompt);

      let combinedResponse = "";
      let combinedResults: any[] = [];
      const allToolCalls: any[] = [];
      let lastIntent: Intent = "unknown";
      let finalError: string | undefined;
      let isCancelled = false;
      let cumulativeContext: any[] = [];

      for (let i = 0; i < subPrompts.length; i++) {
        const currentPrompt = subPrompts[i];

        let enrichedPrompt = currentPrompt;
        const prevUserMessages = history.filter(m => m.role === "user");
        
        const isSupplementaryInfo = /^(his|her|their|the|my)?\s*(email|address|name|number)\s*(is|:)/i.test(currentPrompt.trim());
        const isStandaloneResponse = STANDALONE_RESPONSE_KEYWORDS.has(currentPrompt.trim().toLowerCase());

        if (!isSupplementaryInfo && !isStandaloneResponse && currentPrompt.trim().split(/\s+/).length <= 5 && prevUserMessages.length > 1) {
          const prevMsg = prevUserMessages[prevUserMessages.length - 2];
          if (prevMsg) {
            enrichedPrompt = `${prevMsg.content} — ${currentPrompt}`;
          }
        }

        const state: WorkflowState = {
          input: enrichedPrompt,
          userId: "local",
          conversationId,
          intent: "unknown",
          context: [...cumulativeContext],
          toolCalls: [],
          response: "",
          requiresApproval: false,
          approved: false,
        };

        try {
          await this.routerNode(state);

          switch (state.intent) {
            case "search":
              await this.searchNode(state, mainWindow);
              break;

            case "action":
              await this.prefetchActionContext(state, mainWindow);
              await this.actionNode(state, mainWindow);
              if (state.requiresApproval) {
                await this.draftNode(state, mainWindow);
  saveWorkflowCheckpoint(state.conversationId, state);
                const approved = await this.approvalNode(state, mainWindow);
                if (approved) {
                  await this.executeNode(state, mainWindow);
                } else {
                  isCancelled = true;
                  break;
                }
              } else {
                await this.executeNode(state, mainWindow);
              }
              break;

            case "chat":
            default:
              break;
          }

          if (isCancelled) {
            break;
          }

          if (i > 0 && state.response && combinedResponse) {
            this.safeSend(mainWindow, "workflow-stream", "\n\n");
          }
          await this.responseNode(state, mainWindow);

          if (state.response) {
            combinedResponse += (combinedResponse ? "\n\n" : "") + state.response;
            history.push({ id: randomUUID(), role: "assistant", content: state.response, timestamp: new Date().toISOString() });
          }
          allToolCalls.push(...state.toolCalls);
          cumulativeContext.push(...state.context);
          
          const hasUsefulResults = state.context.some(
            (c) => c.type === "tool_result" && c.result && 
            (Array.isArray(c.result) ? c.result.length > 0 : !c.result.error)
          );
          if (hasUsefulResults) {
            combinedResults.push(...this.formatToolResultsAsCards(state));
          }
          lastIntent = state.intent;

        } catch (error: any) {
          if (error.name === 'AbortError' || error.message?.includes('aborted')) {
            console.log("[Orchestrator] Workflow aborted by user");
            isCancelled = true;
            break;
          }
          
          if (error instanceof MissingArgumentError) {
            const clarificationMsg = `I need a bit more info before I can do that: ${error.message}`;
            combinedResponse += (combinedResponse ? "\n\n" : "") + clarificationMsg;
            isCancelled = true;
            continue;
          }

          const errorMsg = error instanceof Error ? error.message : "Unknown error";
          finalError = errorMsg;
          console.error("[Orchestrator] Workflow error:", errorMsg);

          const errorResponse = `I encountered an error while processing your request: ${errorMsg}`;
          combinedResponse += (combinedResponse ? "\n\n" : "") + errorResponse;
          continue;
        }
      }

      if (combinedResponse) {
        saveMessage(conversationId, "assistant", combinedResponse);
        storeContext(`User: ${prompt}\nAtlas: ${combinedResponse}`);
      }

      this.safeSend(mainWindow, "workflow-complete", {
        conversationId,
        response: combinedResponse,
        intent: lastIntent,
        toolCalls: allToolCalls,
        results: combinedResults.slice(0, 5),
        error: finalError,
        cancelled: isCancelled && !combinedResponse,
      });
    } finally {
      if (conversationId) {
        this.activeStreams.delete(conversationId);
      }
    }
  }


  // ── Dynamic Tool Planner & Router (Like ChatGPT / Gemini / Claude) ─────────

  private async planWithLLM(
    state: WorkflowState,
    configuredServers: string[]
  ): Promise<{
    decision: "tool" | "chat";
    toolCall?: { server: string; tool: string; params: Record<string, unknown> };
    isAction?: boolean;
  } | null> {
    if (configuredServers.length === 0) return { decision: "chat" };

    // Collect available tools from configured servers
    const availableTools: Array<{ server: string; name: string; description: string; inputSchema?: any }> = [];
    for (const server of configuredServers) {
      try {
        const tools = await this.mcpManager.listTools(server);
        for (const t of tools) {
          availableTools.push({
            server,
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          });
        }
      } catch (err) {
        console.warn(`[Orchestrator] Error listing tools for ${server}:`, err);
      }
    }

    if (availableTools.length === 0) return { decision: "chat" };

    const toolSummaries = availableTools
      .map((t) => `- ${t.server}/${t.name}: ${t.description}`)
      .join("\n");

    const planningPrompt = `You are Atlas AI's dynamic tool calling engine.
Available tools from user's connected services:
${toolSummaries}

User Request: "${state.input}"

Decide if fulfilling this user request requires executing any of the tools above.
- If YES: choose the single most relevant tool and parameters.
  Respond with JSON ONLY:
  {"decision": "tool", "server": "<server>", "tool": "<tool_name>", "params": { <tool_arguments> }}
- If NO (the request is conversational, general knowledge, coding, writing, brainstorming, math, or explanation):
  Respond with JSON ONLY:
  {"decision": "chat"}

Respond ONLY with valid JSON. No markdown fences, no explanation.`;

    try {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 3000);

      let responseText = "";
      for await (const token of streamChat(
        [{ role: "user", content: planningPrompt }],
        undefined,
        abortController.signal
      )) {
        responseText += token;
      }
      clearTimeout(timeout);

      const parsed = repairAndParseJson(responseText);
      if (parsed && parsed.decision === "tool" && parsed.server && parsed.tool) {
        const isAction = DESTRUCTIVE_TOOLS.has(parsed.tool);
        return {
          decision: "tool",
          toolCall: {
            server: parsed.server,
            tool: parsed.tool,
            params: parsed.params || {},
          },
          isAction,
        };
      }
      if (parsed && parsed.decision === "chat") {
        return { decision: "chat" };
      }
    } catch {
      // Timeout or error — fall back to rule-based classification
    }

    return null;
  }

  // ── Node Implementations ───────────────────────────────────────────────────

  private async routerNode(state: WorkflowState): Promise<void> {
    const configuredList = listConfigured();
    const configuredServers = configuredList.map((p) => (p === "local_fs" ? "filesystem" : p));

    // Try dynamic LLM tool planning first (like ChatGPT / Gemini / Claude)
    const dynamicPlan = await this.planWithLLM(state, configuredServers);

    if (dynamicPlan) {
      if (dynamicPlan.decision === "tool" && dynamicPlan.toolCall) {
        state.intent = dynamicPlan.isAction ? "action" : "search";
        const toolObj = {
          id: randomUUID(),
          server: dynamicPlan.toolCall.server,
          tool: dynamicPlan.toolCall.tool,
          params: dynamicPlan.toolCall.params,
        };
        state.plannedTools = [toolObj];
        state.context.push({
          type: "classification",
          intent: state.intent,
          confidence: 0.95,
          params: dynamicPlan.toolCall.params,
        });
        return;
      } else if (dynamicPlan.decision === "chat") {
        state.intent = "chat";
        return;
      }
    }

    // Fallback to keyword-based intent classification
    const result = await classifyIntent(state.input);
    state.intent = result.intent;

    if (result.correctedQuery) {
      state.input = result.correctedQuery;
    }

    if (Object.keys(result.extractedParams).length > 0) {
      state.context.push({
        type: "classification",
        intent: result.intent,
        confidence: result.confidence,
        params: result.extractedParams,
      });
    }
  }

  private async searchNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    const toolsToCall = this.resolveTools(state, "search");

    if (toolsToCall.length === 0) {
      state.context.push({
        type: "search_fallback",
        reason: "No relevant MCP tools available for this search",
      });
      return;
    }

    // Anthropic Workflow: Parallelization (Sectioning)
    await Promise.all(
      toolsToCall.map(async (tool) => {
        this.safeSend(mainWindow, "workflow-tool-executing", {
          id: tool.id,
          server: tool.server,
          tool: tool.tool,
          params: tool.params,
        });

        try {
          const result = await this.mcpManager.callTool(
            tool.server,
            tool.tool,
            tool.params as Record<string, any>
          );

          // Check if the result is an error response from the connector or an MCP isError
          const isMcpError = result && typeof result === "object" && result.isError === true;
          if (result && typeof result === "object" && (result.error || isMcpError)) {
            const errorMsg = result.error || (Array.isArray(result.content) ? result.content.map((c: any) => c.text).join('\n') : "Tool execution failed");
            console.warn(`[Orchestrator] Tool returned error: ${tool.server}/${tool.tool}: ${errorMsg}`);
            state.context.push({
              type: "tool_error",
              server: tool.server,
              tool: tool.tool,
              error: errorMsg,
            });
            tool.result = { error: errorMsg };
            tool.error = errorMsg;
            state.toolCalls.push(tool);
          } else {
            tool.result = result;
            state.toolCalls.push(tool);

            saveToolExecution(
              state.conversationId,
              tool.server,
              tool.tool,
              tool.params,
              result
            );

            state.context.push({
              type: "tool_result",
              server: tool.server,
              tool: tool.tool,
              result,
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Tool call failed";
          console.warn(
            `[Orchestrator] Tool call failed: ${tool.server}/${tool.tool}: ${errorMsg}`
          );
          state.context.push({
            type: "tool_error",
            server: tool.server,
            tool: tool.tool,
            error: errorMsg,
          });
          tool.result = { error: errorMsg };
          tool.error = errorMsg;
          state.toolCalls.push(tool);
        }
      })
    );
  }

  private async actionNode(
    state: WorkflowState,
    _mainWindow: BrowserWindow
  ): Promise<void> {
    const toolsToCall = this.resolveTools(state, "action");

    if (toolsToCall.length === 0) {
      state.context.push({
        type: "action_fallback",
        reason: "No relevant MCP tools available for this action",
      });
      return;
    }

    const primaryTool = toolsToCall[0];
    state.toolCalls.push(primaryTool);

    if (DESTRUCTIVE_TOOLS.has(primaryTool.tool)) {
      state.requiresApproval = true;
    }
  }


  /**
   * Pre-fetch context for actions that need external data before drafting.
   * This ensures the draft has real data (email addresses, PR numbers, etc.)
   */
  private async prefetchActionContext(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    const lower = state.input.toLowerCase();
    const configuredList = listConfigured();
    const isGoogleConnected = configuredList.includes("google_workspace");
    const isNotionConnected = configuredList.includes("notion");
    const isGitHubConnected = configuredList.includes("github");
    const isSlackConnected = configuredList.includes("slack");

    // 1. Semantic Memory RAG search for relevant past context
    try {
      const memories = await searchContext(state.input, 2);
      if (memories && memories.length > 0) {
        state.context.push({ type: "memory_result", memories });
      }
    } catch (e) { console.warn("Caught error:", e); }

    // 2. Email actions (send_email, reply_email, forward_email)
    if (lower.includes("reply") || lower.includes("respond") || lower.includes("forward") || lower.startsWith("email") || lower.startsWith("send email") || lower.startsWith("mail") || lower.includes("email ") || lower.includes("mail to")) {
      if (isGoogleConnected) {
        let emailQuery = this.buildGmailQuery(state.input, {});
        if (emailQuery.startsWith("from:")) {
          const contactName = emailQuery.replace("from:", "").replace(/is:unread/g, "").trim();
          if (contactName) {
            emailQuery = `${contactName}`;
          }
        }
        try {
          const prefetchId = randomUUID();
          this.safeSend(mainWindow, "workflow-tool-executing", { id: prefetchId, server: "google_workspace", tool: "search_emails" });
          const emails = await this.mcpManager.callTool("google_workspace", "search_emails", { query: emailQuery, maxResults: 5 });
          
          const toolCall = { id: prefetchId, server: "google_workspace", tool: "search_emails", params: { query: emailQuery, maxResults: 5 }, result: emails };
          state.toolCalls.push(toolCall as any);
          if (emails && !emails.error && Array.isArray(emails) && emails.length > 0) {
            state.context.push({ type: "tool_result", server: "google_workspace", tool: "search_emails", result: emails });
          }
        } catch (e) { console.warn("Caught error:", e); }

        // If email mentions meeting, calendar, or schedule, fetch calendar context too
        if (lower.includes("meeting") || lower.includes("calendar") || lower.includes("schedule") || lower.includes("tomorrow") || lower.includes("today")) {
          try {
            const events = await this.mcpManager.callTool("google_workspace", "list_events", { timeMin: new Date().toISOString() });
            if (events && !events.error) {
              state.context.push({ type: "tool_result", server: "google_workspace", tool: "list_events", result: events });
            }
          } catch (e) { console.warn("Caught error:", e); }
        }

        // If email mentions tasks/todos, fetch tasks context
        if (lower.includes("task") || lower.includes("todo") || lower.includes("deliverable") || lower.includes("action item")) {
          try {
            const tasks = await this.mcpManager.callTool("google_workspace", "list_tasks", {});
            if (tasks && !tasks.error) {
              state.context.push({ type: "tool_result", server: "google_workspace", tool: "list_tasks", result: tasks });
            }
          } catch (e) { console.warn("Caught error:", e); }
        }
      }
    }

    // 3. Calendar event creation / scheduling
    if (lower.includes("calendar") || lower.includes("meeting") || lower.includes("schedule") || lower.includes("event") || lower.includes("invite")) {
      if (isGoogleConnected) {
        try {
          const emailQuery = this.buildGmailQuery(state.input, {});
          const emails = await this.mcpManager.callTool("google_workspace", "search_emails", { query: emailQuery, maxResults: 3 });
          if (emails && !emails.error && Array.isArray(emails) && emails.length > 0) {
            state.context.push({ type: "tool_result", server: "google_workspace", tool: "search_emails", result: emails });
          }
        } catch (e) { console.warn("Caught error:", e); }
      }
    }

    // 4. Task actions (create_task, update_task, complete_task)
    if (lower.includes("task") || lower.includes("todo") || lower.includes("remind") || lower.includes("to-do")) {
      if (isGoogleConnected) {
        try {
          const tasks = await this.mcpManager.callTool("google_workspace", "list_tasks", {});
          if (tasks && !tasks.error) {
            state.context.push({ type: "tool_result", server: "google_workspace", tool: "list_tasks", result: tasks });
          }
        } catch (e) { console.warn("Caught error:", e); }

        const nameMatch = state.input.match(/(?:from|with|to|by)\s+([A-Za-z]+)/i);
        if (nameMatch && nameMatch[1]) {
          try {
            const emails = await this.mcpManager.callTool("google_workspace", "search_emails", { query: nameMatch[1], maxResults: 3 });
            if (emails && !emails.error && Array.isArray(emails) && emails.length > 0) {
              state.context.push({ type: "tool_result", server: "google_workspace", tool: "search_emails", result: emails });
            }
          } catch (e) { console.warn("Caught error:", e); }
        }
      }
    }

    // 5. Notion actions (create_page, update_page)
    if (lower.includes("notion") || lower.includes("page") || lower.includes("doc") || lower.includes("notes") || lower.includes("summary")) {
      if (isNotionConnected) {
        try {
          const pages = await this.mcpManager.callTool("notion", "search_pages", { query: "" });
          if (pages && !pages.error) {
            state.context.push({ type: "tool_result", server: "notion", tool: "search_pages", result: pages });
          }
        } catch (e) { console.warn("Caught error:", e); }
      }

      if (isGoogleConnected) {
        if (lower.includes("meeting") || lower.includes("calendar")) {
          try {
            const events = await this.mcpManager.callTool("google_workspace", "list_events", { timeMin: new Date(Date.now() - 86400000).toISOString() });
            if (events && !events.error) {
              state.context.push({ type: "tool_result", server: "google_workspace", tool: "list_events", result: events });
            }
          } catch (e) { console.warn("Caught error:", e); }
        }
        if (lower.includes("email") || lower.includes("mail")) {
          try {
            const emails = await this.mcpManager.callTool("google_workspace", "search_emails", { query: "is:unread", maxResults: 5 });
            if (emails && !emails.error && Array.isArray(emails) && emails.length > 0) {
              state.context.push({ type: "tool_result", server: "google_workspace", tool: "search_emails", result: emails });
            }
          } catch (e) { console.warn("Caught error:", e); }
        }
      }
    }

    // 6. GitHub actions (PRs, issues)
    if (/\b(pr|prs|pull request|pull requests|pull-request|pull-requests|github)\b/i.test(lower) || /\b(merge|branch|issue|issues)\b/i.test(lower)) {
      if (isGitHubConnected) {
        try {
          const prefetchId = randomUUID();
          this.safeSend(mainWindow, "workflow-tool-executing", { id: prefetchId, server: "github", tool: "list_prs" });
          const prs = await this.mcpManager.callTool("github", "list_prs", { state: "open" });
          const toolCall = { id: prefetchId, server: "github", tool: "list_prs", params: { state: "open" }, result: prs };
          state.toolCalls.push(toolCall as any);
          if (prs && !prs.error) {
            state.context.push({ type: "tool_result", server: "github", tool: "list_prs", result: prs });
          }
        } catch (e) { console.warn("Caught error:", e); }
      }
    }

    // 7. Slack actions
    const hasSlackSignal = lower.includes("slack") || /#[\w-]+/.test(lower);
    const startsWithSlackVerb = /^(post|message)\b/.test(lower);
    if ((hasSlackSignal || startsWithSlackVerb) && !lower.includes("email") && !lower.includes("mail")) {
      if (isSlackConnected) {
        try {
          const prefetchId = randomUUID();
          this.safeSend(mainWindow, "workflow-tool-executing", { id: prefetchId, server: "slack", tool: "list_channels" });
          const channels = await this.mcpManager.callTool("slack", "list_channels", {});
          const toolCall = { id: prefetchId, server: "slack", tool: "list_channels", params: {}, result: channels };
          state.toolCalls.push(toolCall as any);
          if (channels && !channels.error) {
            state.context.push({ type: "tool_result", server: "slack", tool: "list_channels", result: channels });
          }
        } catch (e) { console.warn("Caught error:", e); }
      }
    }
  }

  /**
   * Draft Node: Uses Ollama to generate a draft for the action.
   * Emits workflow-draft-ready to the renderer.
   */
  private async draftNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    const pendingTool = state.toolCalls[state.toolCalls.length - 1];
    const executionId = randomUUID();
    const actionType = pendingTool.tool;

    let toolSchemaStr = "";
    try {
      const tools = await this.mcpManager.listTools(pendingTool.server);
      const toolDef = tools.find(t => t.name === actionType);
      if (toolDef && toolDef.inputSchema) {
         toolSchemaStr = JSON.stringify(toolDef.inputSchema, null, 2);
      }
    } catch (e) { console.warn("Caught error:", e); }

    const abortController = new AbortController();
    const existing = this.activeStreams.get(state.conversationId);
    if (existing) existing.abort();
    this.activeStreams.set(state.conversationId, abortController);

    let fields: Record<string, string> = {};
    try {
      try {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), 6000);
        fields = await this.generateDraft(actionType, state.input, state.context, toolSchemaStr, undefined, timeoutController.signal);
        clearTimeout(timeout);
      } catch (err) {
        console.warn("[Orchestrator] LLM draft generation timed out or failed, using heuristic fallback:", err);
      }
      
      if (!fields || Object.keys(fields).length === 0) {
        fields = this.getFallbackDraftFields(actionType, state.input);
      }
    } finally {
      this.activeStreams.delete(state.conversationId);
    }

    // Post-process: fix fields using real pre-fetched data
    this.fixDraftFieldsWithContext(actionType, fields, state.context);

    state.draft = {
      executionId,
      actionType,
      fields,
      description: `Draft for "${actionType}" on ${pendingTool.server}`,
    };

    // Generate natural conversational intro message for the assistant
    let introMessage = "";
    switch (actionType) {
      case "send_email":
      case "reply_email":
      case "forward_email":
        introMessage = `I've prepared a draft email to **${fields.to || "your recipient"}**. Please review the details below and confirm when you'd like me to send it.`;
        break;
      case "post_message":
      case "send_message":
        introMessage = `I've prepared a draft message for **${fields.channel || "Slack"}**. Please review and confirm to send it.`;
        break;
      case "create_task":
      case "update_task":
        introMessage = `I've prepared this task for you. Please review and confirm to add it to your tasks.`;
        break;
      case "create_page":
      case "update_page":
        introMessage = `I've prepared a draft Notion page for you. Please review and confirm to create it.`;
        break;
      case "create_event":
      case "schedule_event":
        introMessage = `I've prepared a calendar event draft. Please review and confirm to schedule it.`;
        break;
      default:
        introMessage = `I've prepared this draft for your review. Please confirm below when you're ready to proceed.`;
        break;
    }

    state.response = introMessage;

    // Emit draft-ready event to renderer
    this.safeSend(mainWindow, "workflow-draft-ready", {
      executionId,
      conversationId: state.conversationId,
      actionType,
      fields,
      description: state.draft.description,
      server: pendingTool.server,
      tool: pendingTool.tool,
      introMessage,
    });

    this.safeSend(mainWindow, "workflow-stream", introMessage);
  }

  /**
   * Generate draft content using Ollama based on action type and user input.
   */
  private async generateDraft(
    actionType: string,
    userInput: string,
    context: any[],
    toolSchemaStr: string,
    evalContext?: string,
    abortSignal?: AbortSignal
  ): Promise<Record<string, string>> {
    const draftPrompt = this.buildDraftPrompt(actionType, userInput, context, toolSchemaStr);

    if (evalContext) {
      draftPrompt.user += `\n\nEVALUATOR FEEDBACK:\n${evalContext}`;
    }

    const messages = [
      { role: "system" as const, content: draftPrompt.system },
      { role: "user" as const, content: draftPrompt.user },
    ];

    let fullResponse = "";
    try {
      for await (const token of streamChat(messages, undefined, abortSignal)) {
        fullResponse += token;
      }

      return repairAndParseJson(fullResponse);
    } catch (error) {
      if (error instanceof MissingArgumentError) {
        throw error;
      }
      console.warn("[Orchestrator] Draft generation failed:", error);
      throw error;
    }
  }

  /**
   * Evaluate a generated draft against the tool schema and user input.
   */
  private async evaluateDraft(
    actionType: string,
    draftFields: Record<string, string>,
    userInput: string,
    toolSchemaStr: string,
    abortSignal?: AbortSignal
  ): Promise<{ valid: boolean; feedback: string }> {
    if (!toolSchemaStr) return { valid: true, feedback: "" };

    const messages = [
      { role: "system" as const, content: `You are an evaluator checking a generated JSON draft against a tool schema.
The user requested: "${userInput}"
The tool schema is:
${toolSchemaStr}

The generated draft fields are:
${JSON.stringify(draftFields, null, 2)}

Does the draft correctly and completely satisfy the user's intent without hallucinating arguments? Is it missing any required parameters from the schema?
Output JSON only: {"valid": boolean, "feedback": "if invalid, explain why and what to fix"}` }
    ];

    let fullResponse = "";
    try {
      for await (const token of streamChat(messages, undefined, abortSignal)) {
        fullResponse += token;
      }
      const result = repairAndParseJson(fullResponse);
      return { valid: result.valid === true, feedback: result.feedback || "" };
    } catch (error: any) { if (error.name === 'AbortError' || (abortSignal && abortSignal.aborted)) { throw error; } return { valid: true, feedback: "" }; }
  }

  private buildDraftPrompt(
    actionType: string,
    userInput: string,
    context: any[],
    toolSchemaStr: string
  ): { system: string; user: string } {
    const rawContextStr = context
      .filter((c) => c.type === "classification" || c.type === "tool_result")
      .map((c) => JSON.stringify(humanizeDates(c.params || c.result)))
      .join("\n");

    const contextTokens = rawContextStr.split(/\s+/);
    const contextStr = contextTokens.length > 500 ? contextTokens.slice(0, 500).join(" ") : rawContextStr;

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const nowTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    let basePrompt: { system: string; user: string };

    switch (actionType) {
      case "reply_email":
      case "send_email":
      case "forward_email":
        basePrompt = {
          system: `You are an email assistant. The user wants to send/reply/forward an email. Use the fetched email data below to extract the ACTUAL recipient email address (from the "from" field in the data). Output ONLY a JSON object: {"to": "actual-email@domain.com", "subject": "appropriate subject", "body": "email body text"}.

Rules:
- For replies: extract recipient email from the "from" field in the fetched data. Prefix subject with "Re:" 
- For new emails: use the email/name the user explicitly mentioned
- Write the body using the user's exact intent/words — be direct, not overly formal
- If an email address appears in the fetched data, use that exact address
- No placeholders like [Recipient] or [Your Name] — use real data from context
- No markdown, ONLY the JSON object`,
          user: `User request: "${userInput}"\nToday: ${today}\nFetched data: ${contextStr}`,
        };
        break;

      case "merge_pr":
      case "close_pr":
        basePrompt = {
          system: `You interpret GitHub PR actions. Use the fetched PR data below to get the actual PR number, title, and repo. Output ONLY a JSON object: {"owner": "owner", "repo": "repo-name", "pull_number": number, "commit_title": "merge commit message"}.

Rules:
- Extract the actual PR number from fetched data if available
- Extract owner/repo from the data
- No explanation, ONLY the JSON object`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "create_branch":
        basePrompt = {
          system: `You interpret branch creation requests. Output ONLY a JSON object: {"owner": "github-username", "repo": "repo-name", "branch": "new-branch-name", "from_branch": "main"}. Extract repo name from the user's message. Default from_branch to "main". No explanation, just JSON.`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "create_pull_request":
        basePrompt = {
          system: `You interpret PR creation requests. Output ONLY a JSON object: {"owner": "github-username", "repo": "repo-name", "title": "PR title", "body": "PR description", "head": "source-branch", "base": "main"}. No explanation, just JSON.`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "post_message":
      case "send_message":
        basePrompt = {
          system: `You interpret Slack message requests. Use any fetched Slack data below to identify the correct channel. Output ONLY a JSON object: {"channel": "#channel-name", "message": "the message text"}.

Rules:
- Extract channel from user's message or from fetched data
- Write the message using the user's exact words/intent
- No markdown, ONLY the JSON object`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "create_issue":
        basePrompt = {
          system: `You interpret GitHub issue creation requests. Output ONLY a JSON object: {"owner": "owner", "repo": "repo-name", "title": "issue title", "body": "issue description", "labels": "bug,enhancement"}. Use fetched data to determine repo if available. No explanation, just JSON.`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "create_event":
      case "schedule_event":
        basePrompt = {
          system: `You interpret calendar event requests. Output ONLY a JSON object: {"title": "event title", "startTime": "ISO 8601 datetime", "endTime": "ISO 8601 datetime", "description": "details", "attendees": ["email@example.com"]}.

Rules:
- Today is ${today}, current time is ${nowTime}
- "tomorrow" = ${new Date(Date.now() + 86400000).toISOString().split('T')[0]}
- If no end time, default to 1 hour after start
- If no specific time, use 10:00 for morning, 14:00 for afternoon
- ATTENDEES: ONLY email addresses. If user mentions a name without email, check fetched data for their email. Otherwise leave attendees empty.
- No markdown, ONLY the JSON object`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      case "create_task":
        basePrompt = {
          system: `You interpret task creation requests. Output ONLY a JSON object: {"title": "task title", "notes": "optional notes", "due": "YYYY-MM-DD"}.
Rules:
- Generate a clear, actionable task title
- If a due date is mentioned, format it as YYYY-MM-DD based on today (${today})
- No explanation, ONLY the JSON object`,
          user: `User request: "${userInput}"\nToday: ${today}\nFetched data: ${contextStr}`,
        };
        break;

      case "create_page":
      case "update_page":
        basePrompt = {
          system: `You interpret Notion page requests. Output ONLY a JSON object: {"title": "page title", "content": "page content"}.

Rules:
- Generate a clear title from the user's intent
- Write organized content based on what the user described
- No markdown, ONLY the JSON object`,
          user: `User request: "${userInput}"\nFetched data: ${contextStr}`,
        };
        break;

      default:
        basePrompt = {
          system: `You interpret action requests. CRITICAL: You MUST extract ALL relevant context from the user's message (descriptions, times, subjects, participants, repositories) and seamlessly inject them as arguments into the appropriate tool fields. Output ONLY a JSON object with the fields for a "${actionType}" action. No explanation, no markdown.`,
          user: `User request: "${userInput}"\nToday: ${today}\nContext: ${contextStr}`,
        };
        break;
    }

    if (toolSchemaStr) {
      basePrompt.system += `\n\nCRITICAL: You MUST strictly adhere to this JSON Schema for your output parameters to prevent hallucinated arguments. Only output valid JSON matching this schema:\n${toolSchemaStr}`;
    }

    return basePrompt;
  }

  private getFallbackDraftFields(
    actionType: string,
    userInput: string
  ): Record<string, string> {
    // Attempt enhanced regex extraction so fallback fields are accurately pre-populated
    const emailMatch = userInput.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const channelMatch = userInput.match(/#([\w-]+)/);
    const repoMatch = userInput.match(/(\w+\/\w+)/) || userInput.match(/(?:repo|repository)\s+(\S+)/i);

    switch (actionType) {
      case "reply_email":
      case "send_email":
      case "forward_email": {
        const toMatch = userInput.match(/(?:to|email|mail)\s+([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,})/i) || emailMatch;
        const nameMatch = userInput.match(/(?:to|email|mail)\s+([A-Z][a-z]+|[a-z]+)\b/i);
        const bodyMatch = userInput.match(/(?:that|saying|with body|message:?)\s+(.+)$/i) || userInput.match(/(?:subject\s+[^and]+(?:and\s+)?(?:body\s+)?)(.+)$/i);
        const subjectMatch = userInput.match(/subject:?\s*["']?([^"'\n,]+)["']?/i);

        return {
          to: toMatch ? toMatch[1] || toMatch[0] : (nameMatch ? nameMatch[1] : ""),
          subject: subjectMatch ? subjectMatch[1].trim() : "Message via Atlas",
          body: bodyMatch ? bodyMatch[1].trim() : userInput,
        };
      }
      case "merge_pr":
      case "close_pr": {
        const prNumMatch = userInput.match(/#(\d+)/);
        return {
          title: "",
          description: userInput,
          action: actionType.replace("_", " "),
          ...(prNumMatch ? { pull_number: prNumMatch[1] } : {}),
          ...(repoMatch ? { repo: repoMatch[1] } : {}),
        };
      }
      case "create_branch": {
        const branchMatch = userInput.match(/(?:branch|named?)\s+([\w./-]+)/i);
        return {
          owner: "",
          repo: repoMatch ? repoMatch[1] : "",
          branch: branchMatch ? branchMatch[1] : "",
          from_branch: "main",
        };
      }
      case "create_pull_request":
        return {
          owner: "",
          repo: repoMatch ? repoMatch[1] : "",
          title: "",
          body: userInput,
          head: "",
          base: "main",
        };
      case "post_message":
      case "send_message":
        return { channel: channelMatch ? `#${channelMatch[1]}` : "", message: userInput };
      case "create_issue":
        return {
          title: "",
          body: userInput,
          labels: "",
          ...(repoMatch ? { repo: repoMatch[1] } : {}),
        };
      case "create_event":
      case "schedule_event":
        return { title: userInput, startTime: "", endTime: "", description: "", attendees: emailMatch ? emailMatch[0] : "" };
      case "create_page":
      case "update_page":
        return { title: "", content: userInput };
      default:
        return { description: userInput };
    }
  }

  /**
   * Post-process draft fields using pre-fetched context data.
   * Fixes common LLM mistakes like using names instead of emails.
   */
  private fixDraftFieldsWithContext(
    actionType: string,
    fields: Record<string, string>,
    context: any[]
  ): void {
    const toolResults = context.filter((c) => c.type === "tool_result");

    // For email actions: ensure 'to' is accurately matched
    if (actionType === "send_email" || actionType === "forward_email") {
      const emailResult = toolResults.find((c) => c.tool === "search_emails");
      if (emailResult?.result && Array.isArray(emailResult.result) && emailResult.result.length > 0) {
        if (fields.to && !fields.to.includes("@")) {
          const nameLower = fields.to.toLowerCase().trim();
          const match = emailResult.result.find((e: any) =>
            (e.from && e.from.toLowerCase().includes(nameLower)) ||
            (e.to && e.to.toLowerCase().includes(nameLower)) ||
            (e.snippet && e.snippet.toLowerCase().includes(nameLower))
          );
          if (match) {
            const fromField = match.from || match.to || "";
            const emailMatch = fromField.match(/<([^>]+)>/) || fromField.match(/([^\s<]+@[^\s>]+)/);
            if (emailMatch) {
              fields.to = emailMatch[1];
            }
          }
          // If no matching contact was found in emails, do NOT replace fields.to with random newsletter!
        }
      }
      // Never attach messageId/threadId to a new send_email draft
      delete fields.messageId;
      delete fields.threadId;
    } else if (actionType === "reply_email") {
      const emailResult = toolResults.find((c) => c.tool === "search_emails");
      if (emailResult?.result && Array.isArray(emailResult.result) && emailResult.result.length > 0) {
        let targetEmail = emailResult.result[0];
        if (fields.to && !fields.to.includes("@")) {
          const nameLower = fields.to.toLowerCase().trim();
          const match = emailResult.result.find((e: any) =>
            (e.from && e.from.toLowerCase().includes(nameLower)) ||
            (e.to && e.to.toLowerCase().includes(nameLower))
          );
          if (match) targetEmail = match;
        }

        const fromField = targetEmail.from || "";
        const emailMatch = fromField.match(/<([^>]+)>/) || fromField.match(/([^\s<]+@[^\s>]+)/);
        const actualEmail = emailMatch ? emailMatch[1] : fromField;

        if (!fields.to || !fields.to.includes("@")) {
          fields.to = actualEmail;
        }
        if (!fields.subject || fields.subject === "Re: " || fields.subject.length < 3) {
          const originalSubject = targetEmail.subject || "";
          fields.subject = originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`;
        }
        if (targetEmail.id) fields.messageId = targetEmail.id;
        if (targetEmail.threadId) fields.threadId = targetEmail.threadId;
      }
    }

    // For GitHub actions: ensure owner is set
    if (actionType === "create_branch" || actionType === "create_pull_request" || actionType === "create_issue") {
      if (!fields.owner) {
        // Will be auto-filled by MCP Manager from PAT
      }
    }

    // For calendar: ensure times are valid ISO strings
    if (actionType === "create_event" || actionType === "schedule_event") {
      if (fields.startTime && !fields.startTime.includes("T")) {
        // Not a valid ISO datetime — try to fix
        try { fields.startTime = new Date(fields.startTime).toISOString(); } catch (e) { console.warn("Caught error:", e); }
      }
      if (fields.endTime && !fields.endTime.includes("T")) {
        try { fields.endTime = new Date(fields.endTime).toISOString(); } catch (e) { console.warn("Caught error:", e); }
      }
      // If attendees is a string, try to parse as JSON array
      if (typeof fields.attendees === "string" && fields.attendees.startsWith("[")) {
        try {
          const parsed = JSON.parse(fields.attendees);
          fields.attendees = Array.isArray(parsed) ? parsed.join(",") : fields.attendees;
        } catch (e) { console.warn("Caught error:", e); }
      }
    }
  }

  private approvalNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const executionId = state.draft?.executionId ?? randomUUID();
      const pendingTool = state.toolCalls[state.toolCalls.length - 1];

      // Automatically timeout approval after 10 minutes (600,000 ms)
      const timeoutId = setTimeout(() => {
        const p = this.pendingApprovals.get(executionId);
        if (p) {
          this.pendingApprovals.delete(executionId);
          p.resolve(false);
          console.warn(`[Orchestrator] Approval for ${executionId} timed out`);
        }
      }, 10 * 60 * 1000);

      const resolveWithClear = (approved: boolean) => {
        clearTimeout(timeoutId);
        resolve(approved);
      };

      const pending: PendingApproval = {
        executionId,
        conversationId: state.conversationId,
        state,
        resolve: resolveWithClear,
        createdAt: Date.now(),
      };

      this.pendingApprovals.set(executionId, pending);

      // DraftCard in the UI handles approve/reject — no need to emit a separate approval event
    });
  }

  private async executeNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    for (const tool of state.toolCalls) {
      if (tool.result !== undefined) continue;

      // If we have draft fields, merge them into tool params
      if (state.draft?.fields) {
        tool.params = { ...tool.params, ...state.draft.fields };
      }

      // Type-safe numeric parameter normalization for tools (e.g. GitHub PR numbers, maxResults)
      if (tool.params) {
        for (const key of ["pull_number", "issue_number", "maxResults", "limit", "pageSize"]) {
          if (typeof tool.params[key] === "string" && !isNaN(Number(tool.params[key]))) {
            tool.params[key] = Number(tool.params[key]);
          }
        }
      }

      this.safeSend(mainWindow, "workflow-tool-executing", {
        id: tool.id,
        server: tool.server,
        tool: tool.tool,
        params: tool.params,
      });

      try {
        let result: any;
        try {
          result = await this.mcpManager.callTool(
            tool.server,
            tool.tool,
            tool.params as Record<string, any>
          );
        } catch (initialError) {
          console.warn(`[Orchestrator] Tool call failed, retrying after 1s backoff:`, initialError);
          await new Promise(resolve => setTimeout(resolve, 1000));
          result = await this.mcpManager.callTool(
            tool.server,
            tool.tool,
            tool.params as Record<string, any>
          );
        }

        // Check if the result indicates an error or MCP isError
        const isMcpError = result && typeof result === 'object' && result.isError === true;
        if (result && typeof result === 'object' && (result.error || isMcpError)) {
          const errorMsg = result.error || (Array.isArray(result.content) ? result.content.map((c: any) => c.text).join('\n') : "Tool execution failed");
          console.error(`[Orchestrator] Execute error: ${tool.server}/${tool.tool}: ${errorMsg}`);
          state.context.push({ type: "tool_error", server: tool.server, tool: tool.tool, error: errorMsg });
          state.error = errorMsg;
          tool.result = { error: errorMsg };
          tool.error = errorMsg;
        } else {
          tool.result = result;
          saveToolExecution(state.conversationId, tool.server, tool.tool, tool.params, result);
          state.context.push({ type: "tool_result", server: tool.server, tool: tool.tool, result });
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Tool call failed";
        console.error(
          `[Orchestrator] Execute failed: ${tool.server}/${tool.tool}: ${errorMsg}`
        );
        state.context.push({
          type: "tool_error",
          server: tool.server,
          tool: tool.tool,
          error: errorMsg,
        });
        tool.result = { error: errorMsg };
        tool.error = errorMsg;
      }
    }
  }


  /**
   * Response Node: Generates the final response using Ollama (streaming).
   * For search intents, generates a natural language summary of the data.
   */
  private async responseNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    // If action was drafted and executed, produce clear confirmation response
    if (state.intent === "action" && state.draft) {
      if (state.error) {
        state.response = `Sorry, I encountered an issue executing this action: ${state.error}`;
      } else {
        const actionType = state.draft.actionType;
        const fields = state.draft.fields || {};
        switch (actionType) {
          case "send_email":
          case "reply_email":
          case "forward_email":
            state.response = `Your email to **${fields.to || "the recipient"}** has been sent successfully.`;
            break;
          case "post_message":
          case "send_message":
            state.response = `Your message has been posted to **${fields.channel || "Slack"}**.`;
            break;
          case "create_task":
            state.response = `Task **"${fields.title || "New Task"}"** has been added to your tasks.`;
            break;
          case "create_page":
            state.response = `Notion page **"${fields.title || "New Page"}"** has been created.`;
            break;
          case "create_event":
          case "schedule_event":
            state.response = `Calendar event **"${fields.title || "New Event"}"** has been scheduled.`;
            break;
          default:
            state.response = `Action completed successfully.`;
            break;
        }
      }
      this.safeSend(mainWindow, "workflow-stream", state.response);
      return;
    }

    const history = getConversationHistory(state.conversationId, 10);
    let messages = await this.buildResponseMessages(state, history);

    let fullResponse = "";
    const abortController = new AbortController();
    const existing = this.activeStreams.get(state.conversationId);
    if (existing) existing.abort();
    this.activeStreams.set(state.conversationId, abortController);

    let attempt = 0;
    let success = false;
    
    while (!success && attempt < 2) {
      try {
        for await (const token of streamChat(messages, undefined, abortController.signal)) {
          fullResponse += token;
          this.safeSend(mainWindow, "workflow-stream", token);
        }

        state.response = fullResponse;
        
        if (!state.response.trim()) {
          console.warn("[Orchestrator] Ollama returned empty response, using fallback");
          state.response = this.generateFallbackResponse(state);
          this.safeSend(mainWindow, "workflow-stream", state.response);
        }
        success = true;
      } catch (error: any) {
        if (error.name === 'AbortError' || abortController.signal.aborted) {
          throw error;
        }
        if (error.name === 'ContextWindowOverflowError' && attempt === 0) {
          console.warn("[Orchestrator] Context window overflow, retrying with aggressive truncation...");
          attempt++;
          // Re-build messages with much smaller limits
          messages = await this.buildResponseMessages(state, history.slice(-2), true);
          continue;
        }
        console.warn("[Orchestrator] Ollama unavailable for response, using fallback:", error);
        state.response = this.generateFallbackResponse(state);
        this.safeSend(mainWindow, "workflow-stream", state.response);
        success = true;
      }
    }
    
    this.activeStreams.delete(state.conversationId);
  }

  // ── Stream Management ──────────────────────────────────────────────────────

  public abortWorkflow(conversationId: string): boolean {
    const controller = this.activeStreams.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(conversationId);
      return true;
    }
    return false;
  }

  public abortAll(): void {
    for (const controller of this.activeStreams.values()) {
      controller.abort();
    }
    this.activeStreams.clear();
  }

  // ── Helper Methods ─────────────────────────────────────────────────────────

  private resolveTools(
    state: WorkflowState,
    intentType: "search" | "action"
  ): Array<{ id?: string; server: string; tool: string; params: Record<string, unknown>; result?: unknown }> {
    // If dynamic LLM tool planner already selected the tool, prioritize it
    if (state.plannedTools && state.plannedTools.length > 0) {
      const filtered = state.plannedTools.filter((t) => {
        if (intentType === "search" && !READONLY_TOOLS.has(t.tool)) return false;
        if (intentType === "action" && READONLY_TOOLS.has(t.tool)) return false;
        return true;
      });
      if (filtered.length > 0) return filtered;
    }

    const input = state.input.toLowerCase();
    const classificationParams =
      state.context.find((c) => c.type === "classification")?.params || {};

    const tools: Array<{
      id?: string;
      server: string;
      tool: string;
      params: Record<string, unknown>;
      result?: unknown;
    }> = [];

    // Issue #5: Optimize keyword matching — split input into a word Set for O(1) single-word
    // lookups; only do substring search for multi-word keys.
    const cleanInput = input.replace(/[.,!?]/g, '');
    const inputWords = new Set(cleanInput.split(/\s+/));
    // Separate single-word and multi-word keys for efficient matching
    const matchedKeywords: string[] = [];

    // Filter tools strictly by configured/connected services
    const configuredProviders = new Set<string>();
    try {
      const list = listConfigured();
      list.forEach((p) => configuredProviders.add(p));
      if (configuredProviders.has("local_fs")) configuredProviders.add("filesystem");
    } catch (err) {
      console.warn("[Orchestrator] Error reading configured providers:", err);
    }

    for (const [keyword, routes] of Object.entries(TOOL_ROUTING)) {
      // Fast path: single-word keywords checked via Set lookup
      const isMultiWord = keyword.includes(' ');
      const matches = isMultiWord ? input.includes(keyword) : inputWords.has(keyword);

      if (matches) {
        matchedKeywords.push(keyword);
        for (const route of routes) {
          if (intentType === "search" && !READONLY_TOOLS.has(route.tool)) {
            continue;
          }
          if (intentType === "action" && READONLY_TOOLS.has(route.tool)) {
            continue;
          }

          // If we know which providers are configured, skip servers that are NOT configured
          if (configuredProviders.size > 0 && !configuredProviders.has(route.server)) {
            continue;
          }

          tools.push({
            id: randomUUID(),
            server: route.server,
            tool: route.tool,
            params: this.buildToolParams(route.tool, state.input, classificationParams),
          });
        }
      }
    }

    const seen = new Set<string>();
    const deduped = tools.filter((t) => {
      const key = `${t.server}:${t.tool}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Issue #6: For simple "get my latest X" queries where only one keyword matched,
    // cap to 1 tool to avoid calling 3 tools when 1 suffices.
    const isSimpleFetch = /^(what'?s?|show|get)\s+(my\s+)?(latest|last|newest)\b/i.test(input);
    const distinctKeywords = new Set(matchedKeywords);
    if (isSimpleFetch && distinctKeywords.size <= 1) {
      return deduped.slice(0, 1);
    }

    return deduped.slice(0, 3); // General cap: max 3 tools for speed vs coverage
  }

  private buildToolParams(
    toolName: string,
    input: string,
    classParams: Record<string, unknown>
  ): Record<string, unknown> {
    const query = (classParams.query as string) || input;

    switch (toolName) {
      case "search_emails":
      case "list_emails":
      case "read_emails": {
        // Convert natural language to Gmail query syntax
        const emailQuery = this.buildGmailQuery(input, classParams);
        // Limit to fewer results for specific queries (latest, from person)
        const lower = input.toLowerCase();
        const maxResults = (lower.includes("latest") || lower.includes("last") || lower.includes("recent")) ? 1 : 5;
        return { query: emailQuery, maxResults };
      }

      case "list_calendar":
      case "get_calendar_event": {
        // Calendar API uses timeMin/timeMax, not text queries
        const timeRange = this.buildCalendarTimeRange(input);
        return { ...timeRange };
      }

      case "list_prs":
      case "search_repo": {
        // GitHub API: extract repo, state, author from natural language
        const ghParams = this.buildGitHubQuery(input, classParams);
        return ghParams;
      }

      case "get_pr":
      case "merge_pr":
      case "close_pr": {
        const prMatch = input.match(/#(\d+)/);
        return { pull_number: prMatch ? parseInt(prMatch[1]) : undefined };
      }

      case "list_issues": {
        const issueParams = this.buildGitHubQuery(input, classParams);
        return issueParams;
      }

      case "get_issue":
      case "close_issue": {
        const issueMatch = input.match(/#(\d+)/);
        return { issue_number: issueMatch ? parseInt(issueMatch[1]) : undefined };
      }

      case "search_messages":
      case "read_messages": {
        // Slack: extract channel and search terms
        const slackParams = this.buildSlackQuery(input, classParams);
        return slackParams;
      }

      case "post_message":
      case "send_message": {
        const channelMatch = input.match(/#([\w-]+)/);
        return {
          channel: channelMatch ? channelMatch[1] : undefined,
          text: (classParams.details as string) || input,
        };
      }

      case "search_pages":
      case "get_page": {
        // Notion: extract search terms from natural language
        const notionQuery = this.buildNotionQuery(input, classParams);
        return { query: notionQuery };
      }

      case "read_file":
      case "list_directory":
      case "search_files": {
        // Filesystem: extract path or search term
        const fsParams = this.buildFilesystemQuery(input, classParams);
        return fsParams;
      }

      case "write_file":
      case "delete_file":
      case "move_file":
        return {
          path: (classParams.target as string) || undefined,
          content: (classParams.details as string) || undefined,
        };

      default:
        return { query };
    }
  }

  private async buildResponseMessages(
    state: WorkflowState,
    history: Message[],
    aggressiveTruncation: boolean = false
  ): Promise<Array<{ role: "system" | "user" | "assistant"; content: string }>> {
    const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];

    // Add tool context FIRST if available — so it's prominent for the model
    const toolResults = state.context.filter(
      (c) => c.type === "tool_result" || c.type === "tool_error"
    );

    if (state.intent === "search" && toolResults.length > 0) {
      // For search: simple prompt with data injected directly
      // Truncate results to keep prompt small for faster generation
      const contextStr = toolResults
        .map((c) => {
          if (c.type === "tool_result") {
            // Humanize ISO dates so LLM outputs natural phrasing
            const humanized = humanizeDates(c.result);
            const str = JSON.stringify(humanized);
            const strTokens = str.split(/\s+/);
            const limit = aggressiveTruncation ? 200 : 750;
            return strTokens.length > limit ? strTokens.slice(0, limit).join(" ") + "..." : str;
          }
          return `Error fetching from ${c.server}: ${c.error}`;
        })
        .join("\n\n");

      messages.push({
        role: "system",
        content: `You are Atlas, a personal executive AI assistant. Answer the user's request accurately using ONLY the data below. Do NOT invent or add information not present in the data.

Formatting Guidelines:
- For Emails: Always format each email consistently:
  • **Subject:** [Subject]
    **From:** [Sender name or email]
    **Date:** [Date/time]
    **Summary:** [1-2 sentences summarizing the core message concisely. Ignore tracking noise.]
- For Tasks: Format as clean bullet points with task title and due date.
- For Calendar / Meetings: Format with event title, date, time, and attendees.
- For GitHub PRs / Issues: Format with repository, PR title, author, and status.

Strict Rules:
- NEVER include introductory pleasantries or filler (e.g. 'Sure!', 'Here are your emails:', 'I would be happy to help'). Start directly with the formatted content or answer.
- If the data is empty or has errors, explain what happened and suggest checking Settings > Integrations.\n\nDATA:\n${contextStr}`,
      });
      messages.push({ role: "user", content: state.input });

    } else if (state.intent === "search") {
      // Search but no results
      const fallback = state.context.find((c) => c.type === "search_fallback" || c.type === "action_fallback");
      const reason = fallback?.reason || "No data was retrieved.";
      messages.push({
        role: "system",
        content: `You are Atlas, a personal AI assistant. The user asked a question but no data could be retrieved. ${reason} Politely inform the user and suggest checking Settings > Integrations if the relevant integration is not connected. Do NOT make up any data.`,
      });
      messages.push({ role: "user", content: state.input });

    } else {
      // Chat or action — include some history for context
      messages.push({
        role: "system",
        content: `You are Atlas, a personal AI assistant. Be direct, concise, and helpful. Use clean markdown formatting (bullet points, bold titles) where appropriate to make information readable. NEVER invent information. If you don't know something or cannot access a tool, explain clearly.`,
      });

      // Include conversation history so the agent has full context
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          // Truncate history messages to prevent context window overflow
          const charLimit = aggressiveTruncation ? 500 : 2000;
          const content = msg.content.length > charLimit 
            ? msg.content.slice(0, charLimit) + "... [truncated]" 
            : msg.content;
          messages.push({ role: msg.role as "user" | "assistant", content });
        }
      }

      try {
        const ragContext = await searchContext(state.input, 3);
        if (ragContext.length > 0) {
          messages.push({
            role: "system",
            content: `Relevant past context (use if helpful):\n${ragContext.join("\n\n")}`,
          });
        }
      } catch (err) {
        console.warn("[Orchestrator] Failed to get RAG context:", err);
      }

      messages.push({ role: "user", content: state.input });

      // Add tool results if any (for action intents)
      if (toolResults.length > 0) {
        const contextStr = toolResults
          .map((c) => {
            if (c.type === "tool_result") {
              const humanized = humanizeDates(c.result);
              const str = JSON.stringify(humanized, null, 2);
              const strTokens = str.split(/\s+/);
              return strTokens.length > 750 ? strTokens.slice(0, 750).join(" ") + "..." : str;
            }
            return `Error: ${c.error}`;
          })
          .join("\n\n");

        messages.push({
          role: "system",
          content: `Tool results (use ONLY this data):\n${contextStr}`,
        });
      }
    }

    return messages;
  }

  /**
   * Format tool call results into SearchResult-shaped cards for the UI.
   */
  private formatToolResultsAsCards(state: WorkflowState): any[] {
    const results: any[] = [];
    const toolResults = state.context.filter((c) => c.type === "tool_result");

    for (const ctx of toolResults) {
      const rawResult = ctx.result;
      if (!rawResult) continue;

      // Handle array results (list of items)
      const items = Array.isArray(rawResult) ? rawResult : rawResult?.items ?? rawResult?.results ?? rawResult?.messages ?? rawResult?.emails ?? [];

      if (Array.isArray(items)) {
        for (const item of items.slice(0, 3)) {
          const card = this.itemToCard(item, ctx.server, ctx.tool);
          if (card) results.push(card);
        }
      } else if (typeof rawResult === "object" && rawResult.title) {
        const card = this.itemToCard(rawResult, ctx.server, ctx.tool);
        if (card) results.push(card);
      }
    }

    // Max 5 cards total across all tools
    return results.slice(0, 5);
  }

  /**
   * Convert a raw item from a tool result into a UI card format.
   */
  private itemToCard(item: any, server: string, tool: string): any | null {
    if (!item || typeof item !== "object") return null;

    const type = this.inferType(server, tool);
    const id = item.id || item.message_id || item.threadId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
      id: String(id),
      type,
      title: item.title || item.subject || item.name || item.full_name || item.filename || "Untitled",
      excerpt: item.snippet || item.body || item.description || item.summary || item.text || item.content || "",
      source: this.getSourceDisplayName(server),
      score: item.score ?? 1,
      url: item.url || item.html_url || item.link || item.webLink || undefined,
      timestamp: item.date || item.created_at || item.updated_at || item.timestamp || item.internalDate || new Date().toISOString(),
    };
  }

  /**
   * Build time range params for Google Calendar API.
   */
  private buildCalendarTimeRange(input: string): Record<string, string> {
    const lower = input.toLowerCase();
    const now = new Date();

    if (lower.includes("tomorrow")) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setHours(23, 59, 59, 999);
      return { timeMin: tomorrow.toISOString(), timeMax: dayAfter.toISOString() };
    }
    if (lower.includes("today")) {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      return { timeMin: startOfDay.toISOString(), timeMax: endOfDay.toISOString() };
    }
    if (lower.includes("yesterday")) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      const endYesterday = new Date(yesterday);
      endYesterday.setHours(23, 59, 59, 999);
      return { timeMin: yesterday.toISOString(), timeMax: endYesterday.toISOString() };
    }
    if (lower.includes("this week")) {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      return { timeMin: startOfWeek.toISOString(), timeMax: endOfWeek.toISOString() };
    }
    if (lower.includes("next week")) {
      const startNextWeek = new Date(now);
      startNextWeek.setDate(startNextWeek.getDate() + (7 - startNextWeek.getDay()));
      startNextWeek.setHours(0, 0, 0, 0);
      const endNextWeek = new Date(startNextWeek);
      endNextWeek.setDate(endNextWeek.getDate() + 6);
      endNextWeek.setHours(23, 59, 59, 999);
      return { timeMin: startNextWeek.toISOString(), timeMax: endNextWeek.toISOString() };
    }
    if (lower.includes("this month")) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return { timeMin: startOfMonth.toISOString(), timeMax: endOfMonth.toISOString() };
    }
    if (lower.includes("next month")) {
      const startNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const endNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
      return { timeMin: startNextMonth.toISOString(), timeMax: endNextMonth.toISOString() };
    }
    // "next X days" pattern
    const nextDaysMatch = lower.match(/next\s+(\d+)\s+days?/);
    if (nextDaysMatch) {
      const days = parseInt(nextDaysMatch[1]);
      const end = new Date(now);
      end.setDate(end.getDate() + days);
      return { timeMin: now.toISOString(), timeMax: end.toISOString() };
    }
    // Day of week: "monday", "tuesday", etc.
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (let i = 0; i < dayNames.length; i++) {
      if (lower.includes(dayNames[i])) {
        const targetDay = i;
        const currentDay = now.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil <= 0) daysUntil += 7; // Next occurrence
        const targetDate = new Date(now);
        targetDate.setDate(targetDate.getDate() + daysUntil);
        targetDate.setHours(0, 0, 0, 0);
        const endTarget = new Date(targetDate);
        endTarget.setHours(23, 59, 59, 999);
        return { timeMin: targetDate.toISOString(), timeMax: endTarget.toISOString() };
      }
    }
    // "in X hours/days" pattern
    const inHoursMatch = lower.match(/in\s+(\d+)\s+hours?/);
    if (inHoursMatch) {
      const hours = parseInt(inHoursMatch[1]);
      const end = new Date(now);
      end.setHours(end.getHours() + hours);
      return { timeMin: now.toISOString(), timeMax: end.toISOString() };
    }
    const inDaysMatch = lower.match(/in\s+(\d+)\s+days?/);
    if (inDaysMatch) {
      const days = parseInt(inDaysMatch[1]);
      const start = new Date(now);
      start.setDate(start.getDate() + days);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };
    }
    // Specific date patterns: "August 8", "8th August", "Aug 9", "9/8", "2026-08-09"
    const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
    const monthsShort = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    // "Month Day" or "Month Day, Year"
    for (let mi = 0; mi < months.length; mi++) {
      const monthPattern = new RegExp(`(?:${months[mi]}|${monthsShort[mi]})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?`, "i");
      const match = lower.match(monthPattern);
      if (match) {
        const day = parseInt(match[1]);
        const year = match[2] ? parseInt(match[2]) : now.getFullYear();
        const targetDate = new Date(year, mi, day, 0, 0, 0, 0);
        const endDate = new Date(year, mi, day, 23, 59, 59, 999);
        return { timeMin: targetDate.toISOString(), timeMax: endDate.toISOString() };
      }
      // "Day Month" pattern: "8th August", "9 Aug"
      const dayFirstPattern = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${months[mi]}|${monthsShort[mi]})(?:[,\\s]+(\\d{4}))?`, "i");
      const dayMatch = lower.match(dayFirstPattern);
      if (dayMatch) {
        const day = parseInt(dayMatch[1]);
        const year = dayMatch[2] ? parseInt(dayMatch[2]) : now.getFullYear();
        const targetDate = new Date(year, mi, day, 0, 0, 0, 0);
        const endDate = new Date(year, mi, day, 23, 59, 59, 999);
        return { timeMin: targetDate.toISOString(), timeMax: endDate.toISOString() };
      }
    }
    // Numeric date: "8/9", "08/09", "2026-08-09"
    const numericDate = lower.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (numericDate) {
      const part1 = parseInt(numericDate[1]);
      const part2 = parseInt(numericDate[2]);
      const year = numericDate[3] ? parseInt(numericDate[3]) : now.getFullYear();
      // Assume MM/DD format
      const month = part1 - 1;
      const day = part2;
      const targetDate = new Date(year, month, day, 0, 0, 0, 0);
      const endDate = new Date(year, month, day, 23, 59, 59, 999);
      return { timeMin: targetDate.toISOString(), timeMax: endDate.toISOString() };
    }
    // "last week", "last month"
    if (lower.includes("last week")) {
      const startLastWeek = new Date(now);
      startLastWeek.setDate(startLastWeek.getDate() - startLastWeek.getDay() - 7);
      startLastWeek.setHours(0, 0, 0, 0);
      const endLastWeek = new Date(startLastWeek);
      endLastWeek.setDate(endLastWeek.getDate() + 6);
      endLastWeek.setHours(23, 59, 59, 999);
      return { timeMin: startLastWeek.toISOString(), timeMax: endLastWeek.toISOString() };
    }
    if (lower.includes("last month")) {
      const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { timeMin: startLastMonth.toISOString(), timeMax: endLastMonth.toISOString() };
    }
    // "morning", "afternoon", "evening" (today)
    if (lower.includes("morning")) {
      const start = new Date(now); start.setHours(6, 0, 0, 0);
      const end = new Date(now); end.setHours(12, 0, 0, 0);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };
    }
    if (lower.includes("afternoon")) {
      const start = new Date(now); start.setHours(12, 0, 0, 0);
      const end = new Date(now); end.setHours(17, 0, 0, 0);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };
    }
    if (lower.includes("evening") || lower.includes("tonight")) {
      const start = new Date(now); start.setHours(17, 0, 0, 0);
      const end = new Date(now); end.setHours(23, 59, 59, 999);
      return { timeMin: start.toISOString(), timeMax: end.toISOString() };
    }
    // Default: from start of today to next 2 days
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setDate(end.getDate() + 2);
    return { timeMin: startOfToday.toISOString(), timeMax: end.toISOString() };
  }

  /**
   * Build GitHub API query params from natural language.
   */
  private buildGitHubQuery(input: string, classParams: Record<string, unknown>): Record<string, unknown> {
    const lower = input.toLowerCase();
    const params: Record<string, unknown> = { state: "open" };

    // Extract repo name
    const repoMatch = input.match(/(?:repo|repository)\s+(\S+)/i) || input.match(/(\w+\/\w+)/);
    if (repoMatch) params.repo = repoMatch[1];

    // State
    if (lower.includes("closed")) params.state = "closed";
    if (lower.includes("merged")) params.state = "closed";
    if (lower.includes("all")) params.state = "all";

    // Author/assignee
    const authorMatch = lower.match(/(?:by|from|author)\s+(\w+)/);
    if (authorMatch) params.author = authorMatch[1];

    const assigneeMatch = lower.match(/(?:assigned to|assignee)\s+(\w+)/);
    if (assigneeMatch) params.assignee = assigneeMatch[1];

    // Review needed
    if (lower.includes("review") || lower.includes("needs review")) {
      params.review = "required";
    }

    // Labels
    const labelMatch = lower.match(/(?:label|tagged)\s+(\w+)/);
    if (labelMatch) params.labels = labelMatch[1];

    return params;
  }

  /**
   * Build Slack search query from natural language.
   */
  private buildSlackQuery(input: string, classParams: Record<string, unknown>): Record<string, unknown> {
    const lower = input.toLowerCase();
    const params: Record<string, unknown> = {};

    // Extract channel
    const channelMatch = input.match(/#([\w-]+)/);
    if (channelMatch) params.channel = channelMatch[1];

    // Extract search terms (remove common filler words)
    const cleanedQuery = lower
      .replace(/(?:search|find|look for|messages?|in|from|on|slack|channel|#\w+)/g, "")
      .trim();
    if (cleanedQuery) params.query = cleanedQuery;

    // From user
    const fromMatch = lower.match(/(?:from|by)\s+@?(\w+)/);
    if (fromMatch) params.from = fromMatch[1];

    return params;
  }

  /**
   * Build Notion search query from natural language.
   */
  private buildNotionQuery(input: string, classParams: Record<string, unknown>): string {
    const lower = input.toLowerCase();

    // Extract actual search terms from natural language
    const cleaned = lower
      .replace(/(?:find|search|look for|get|show|notion|pages?|docs?|documents?|about|regarding|on)/g, "")
      .trim();

    return cleaned || (classParams.query as string) || "";
  }

  /**
   * Build filesystem query/path from natural language.
   */
  private buildFilesystemQuery(input: string, classParams: Record<string, unknown>): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    // Extract path if mentioned
    const pathMatch = input.match(/(?:in|at|from|path)\s+([\/\\]?\S+)/i);
    if (pathMatch) {
      params.path = pathMatch[1];
    } else {
      params.path = (classParams.target as string) || ".";
    }

    // Extract search term
    const searchTerms = input.toLowerCase()
      .replace(/(?:find|search|look for|files?|in|at|from|path|directory|folder|about|named|called)\s*/g, "")
      .trim();
    if (searchTerms) params.query = searchTerms;

    return params;
  }

  /**
   * Convert natural language to a Gmail search query.
   */
  private buildGmailQuery(input: string, classParams: Record<string, unknown>): string {
    const lower = input.toLowerCase();

    // If classification extracted a specific query, use it
    if (classParams.query && classParams.query !== input) {
      return classParams.query as string;
    }

    // Person-based queries — "from pranav", "latest from pranav", "email from john"
    const fromMatch = lower.match(/(?:from|by)\s+(\w+)/);
    if (fromMatch) return `from:${fromMatch[1]}`;

    if (lower.includes("all email") || lower.includes("all mail") || lower.includes("read email")) {
      return "is:inbox";
    }

    // Time-based queries
    if (lower.includes("today")) return "is:unread newer_than:1d";
    if (lower.includes("yesterday")) return "is:unread newer_than:2d older_than:1d";
    if (lower.includes("this week")) return "is:unread newer_than:7d";
    if (lower.includes("this month")) return "is:unread newer_than:30d";

    // Subject/topic queries
    const aboutMatch = lower.match(/(?:about|regarding|re:?)\s+(.+?)(?:\s*$|\s+(?:from|today|this))/);
    if (aboutMatch) return `${aboutMatch[1]} is:unread`;

    // Default: unread emails
    return "is:unread";
  }

  private getSourceDisplayName(server: string): string {
    const names: Record<string, string> = {
      google_workspace: "Google Workspace",
      github: "GitHub",
      slack: "Slack",
      notion: "Notion",
      filesystem: "Local Files",
    };
    return names[server] || server.replace(/_/g, " ");
  }

  private inferType(server: string, tool: string): string {
    if (server.includes("google") || tool.includes("email") || tool.includes("gmail")) return "email";
    if (tool.includes("calendar") || tool.includes("event")) return "calendar";
    if (tool.includes("pr") || tool.includes("pull")) return "pr";
    if (tool.includes("issue")) return "issue";
    if (server.includes("slack") || tool.includes("message")) return "task";
    if (server.includes("notion") || tool.includes("page")) return "document";
    if (tool.includes("file") || tool.includes("directory")) return "file";
    return "document";
  }

  private generateFallbackResponse(state: WorkflowState): string {
    const toolResults = state.context.filter((c) => c.type === "tool_result");
    const toolErrors = state.context.filter((c) => c.type === "tool_error");

    if (toolResults.length > 0) {
      const formattedSections: string[] = [];

      for (const c of toolResults) {
        const data = humanizeDates(c.result);
        if (Array.isArray(data)) {
          if (data.length === 0) {
            formattedSections.push(`• **${this.getSourceDisplayName(c.server)}**: No items found.`);
          } else {
            const itemsList = data.slice(0, 5).map((item: any) => {
              if (item.subject || item.from) {
                return `  - **${item.subject || "No Subject"}** from *${item.from || "Unknown"}* (${item.date || "Recent"})`;
              }
              if (item.title || item.summary) {
                return `  - **${item.title || item.summary}** ${item.due ? `(Due: ${item.due})` : ""}`;
              }
              if (item.name) {
                return `  - **${item.name}**`;
              }
              return `  - ${typeof item === "string" ? item : JSON.stringify(item)}`;
            }).join("\n");
            formattedSections.push(`• **${this.getSourceDisplayName(c.server)}**:\n${itemsList}`);
          }
        } else if (data && typeof data === "object") {
          const item = data as any;
          if (item.title || item.subject) {
            formattedSections.push(`• **${item.title || item.subject}** (${this.getSourceDisplayName(c.server)})`);
          } else {
            formattedSections.push(`• **${this.getSourceDisplayName(c.server)}**: ${item.message || "Completed successfully"}`);
          }
        }
      }

      return `Here's what I found:\n\n${formattedSections.join("\n\n")}`;
    }

    if (toolErrors.length > 0) {
      return `I wasn't able to complete your request. The following tools encountered errors:\n${toolErrors
        .map((c) => `• ${c.server}/${c.tool}: ${c.error}`)
        .join("\n")}\n\nPlease check that the relevant integrations are configured and authorized.`;
    }

    if (state.intent === "chat") {
      return "I'm Atlas, your personal AI assistant. I can help you search emails, manage GitHub PRs, check your calendar, and more. However, my AI capabilities are currently limited because Ollama is not running. Please start Ollama for full functionality.";
    }

    return "I wasn't able to process your request. Please make sure Ollama is running for full AI features, or check that the relevant MCP servers are connected.";
  }

  // ── Public Approval API ────────────────────────────────────────────────────

  approve(executionId: string, editedFields?: Record<string, string>): boolean {
    const pending = this.pendingApprovals.get(executionId);
    if (!pending) {
      console.warn(`[Orchestrator] No pending approval found for: ${executionId}`);
      return false;
    }
    // Check TTL expiry
    if (Date.now() - pending.createdAt > APPROVAL_TTL_MS) {
      console.warn(`[Orchestrator] Approval expired for: ${executionId}`);
      this.pendingApprovals.delete(executionId);
      pending.resolve(false);
      return false;
    }
    if (editedFields && pending.state.draft) {
      pending.state.draft.fields = { ...pending.state.draft.fields, ...editedFields };
    }
    this.pendingApprovals.delete(executionId);
    pending.resolve(true);
    return true;
  }

  reject(executionId: string): boolean {
    const pending = this.pendingApprovals.get(executionId);
    if (!pending) {
      console.warn(`[Orchestrator] No pending approval found for: ${executionId}`);
      return false;
    }
    // Check TTL expiry
    if (Date.now() - pending.createdAt > APPROVAL_TTL_MS) {
      console.warn(`[Orchestrator] Approval expired for: ${executionId}`);
      this.pendingApprovals.delete(executionId);
      pending.resolve(false);
      return false;
    }
    this.pendingApprovals.delete(executionId);
    pending.resolve(false);
    return true;
  }

  getPendingApprovals(): Array<{
    executionId: string;
    conversationId: string;
    tool: string;
    server: string;
  }> {
    const pending: Array<{
      executionId: string;
      conversationId: string;
      tool: string;
      server: string;
    }> = [];

    for (const [, approval] of this.pendingApprovals) {
      const lastTool = approval.state.toolCalls[approval.state.toolCalls.length - 1];
      pending.push({
        executionId: approval.executionId,
        conversationId: approval.conversationId,
        tool: lastTool?.tool || "unknown",
        server: lastTool?.server || "unknown",
      });
    }

    return pending;
  }
}

