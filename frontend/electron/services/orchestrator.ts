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
} from "./local-store";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowState {
  input: string;
  userId: string;
  conversationId: string;
  intent: Intent;
  context: any[];
  toolCalls: Array<{
    server: string;
    tool: string;
    params: Record<string, unknown>;
    result?: unknown;
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
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DESTRUCTIVE_TOOLS = new Set([
  "send_email",
  "reply_email",
  "forward_email",
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
  ],
  inbox: [
    { server: "google_workspace", tool: "search_emails" },
  ],
  gmail: [
    { server: "google_workspace", tool: "search_emails" },
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
    { server: "google_workspace", tool: "create_event" },
  ],
  event: [
    { server: "google_workspace", tool: "list_calendar" },
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
  task: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "list_calendar" },
    { server: "notion", tool: "search_pages" },
    { server: "slack", tool: "search_messages" },
  ],
  tasks: [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "list_calendar" },
    { server: "notion", tool: "search_pages" },
    { server: "slack", tool: "search_messages" },
  ],
  "to do": [
    { server: "google_workspace", tool: "list_tasks" },
    { server: "google_workspace", tool: "list_calendar" },
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
  // ── Write/Action keywords ──────────────────────────────────────────
  send: [
    { server: "google_workspace", tool: "send_email" },
    { server: "slack", tool: "post_message" },
  ],
  mail: [
    { server: "google_workspace", tool: "send_email" },
  ],
  reply: [
    { server: "google_workspace", tool: "reply_email" },
  ],
  forward: [
    { server: "google_workspace", tool: "forward_email" },
  ],
  compose: [
    { server: "google_workspace", tool: "send_email" },
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

// ── ISO-8601 date regex ────────────────────────────────────────────────────────
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DATE_LOOSE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * Recursively walks an object/array and reformats ISO-8601 date strings
 * into human-readable form (e.g. 'Sat, Aug 8, 2026, 1:18 PM') so the LLM
 * outputs natural language dates rather than parroting raw ISO strings.
 * Only applied to LLM-facing context — NOT to UI-facing card data (UI uses date-fns).
 */
function humanizeDates(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (ISO_DATE_LOOSE_REGEX.test(obj) || ISO_DATE_REGEX.test(obj)) {
      try {
        const d = new Date(obj);
        if (!isNaN(d.getTime())) {
          return d.toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          }) + ', ' + d.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          });
        }
      } catch {}
    }
    return obj;
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

  constructor(mcpManager: MCPServerManager) {
    this.mcpManager = mcpManager;
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

    if (prompt.length > 2000) {
      prompt = prompt.substring(0, 2000);
    }

    if (!conversationId) {
      const title = prompt.slice(0, 60) + (prompt.length > 60 ? "..." : "");
      const conversation = createConversation(title);
      conversationId = conversation.id;
    }

    saveMessage(conversationId, "user", prompt);

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
        context: [],
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
        }
        allToolCalls.push(...state.toolCalls);
        
        const hasUsefulResults = state.context.some(
          (c) => c.type === "tool_result" && c.result && 
          (Array.isArray(c.result) ? c.result.length > 0 : !c.result.error)
        );
        if (hasUsefulResults) {
          combinedResults.push(...this.formatToolResultsAsCards(state));
        }
        lastIntent = state.intent;

      } catch (error) {
        if (error instanceof MissingArgumentError) {
          const clarificationMsg = `I need a bit more info before I can do that: ${error.message}`;
          combinedResponse += (combinedResponse ? "\n\n" : "") + clarificationMsg;
          isCancelled = true;
          break;
        }

        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        finalError = errorMsg;
        console.error("[Orchestrator] Workflow error:", errorMsg);

        const errorResponse = `I encountered an error while processing your request: ${errorMsg}`;
        combinedResponse += (combinedResponse ? "\n\n" : "") + errorResponse;
        break;
      }
    }

    if (combinedResponse) {
      saveMessage(conversationId, "assistant", combinedResponse);
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
  }


  // ── Node Implementations ───────────────────────────────────────────────────

  private async routerNode(state: WorkflowState): Promise<void> {
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

    for (const tool of toolsToCall) {
      this.safeSend(mainWindow, "workflow-tool-executing", {
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

        // Check if the result is an error response from the connector
        if (result && typeof result === 'object' && result.error) {
          console.warn(`[Orchestrator] Tool returned error: ${tool.server}/${tool.tool}: ${result.error}`);
          state.context.push({
            type: "tool_error",
            server: tool.server,
            tool: tool.tool,
            error: result.error,
          });
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
      }
    }
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

    // Reply/respond/forward email — fetch the relevant email first
    if (lower.includes("reply") || lower.includes("respond") || lower.includes("forward")) {
      // Issue #1: Reuse buildGmailQuery to target the person mentioned in the user's input
      const emailQuery = this.buildGmailQuery(state.input, {});
      try {
        this.safeSend(mainWindow, "workflow-tool-executing", { server: "google_workspace", tool: "search_emails" });
        // Use maxResults=3 to increase chances of finding the right email
        const emails = await this.mcpManager.callTool("google_workspace", "search_emails", { query: emailQuery, maxResults: 3 });
        if (emails && !emails.error && Array.isArray(emails) && emails.length > 0) {
          state.context.push({ type: "tool_result", server: "google_workspace", tool: "search_emails", result: emails });
        }
      } catch {}
    }

    // Merge/close PR — fetch the PR details
    if (lower.includes("merge") || (lower.includes("close") && lower.includes("pr"))) {
      try {
        this.safeSend(mainWindow, "workflow-tool-executing", { server: "github", tool: "list_prs" });
        const prs = await this.mcpManager.callTool("github", "list_prs", { state: "open" });
        if (prs && !prs.error) {
          state.context.push({ type: "tool_result", server: "github", tool: "list_prs", result: prs });
        }
      } catch {}
    }

    // Post to Slack — fetch channels for context
    // Issue #9: Tightened condition — 'post' and 'message' alone cause false positives
    // (e.g. 'create a post about X', 'send message' for email). Require 'slack' OR
    // a channel reference (#channel), OR 'post'/'message' as first word (imperative).
    const hasSlackSignal = lower.includes("slack") || /#[\w-]+/.test(lower);
    const startsWithSlackVerb = /^(post|message)\b/.test(lower);
    if ((hasSlackSignal || startsWithSlackVerb) && !lower.includes("email") && !lower.includes("mail")) {
      try {
        this.safeSend(mainWindow, "workflow-tool-executing", { server: "slack", tool: "read_messages" });
        const channels = await this.mcpManager.callTool("slack", "list_channels", {});
        if (channels && !channels.error) {
          state.context.push({ type: "tool_result", server: "slack", tool: "list_channels", result: channels });
        }
      } catch {}
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
    } catch(e) {}

    const abortController = new AbortController();
    this.activeStreams.set(state.conversationId, abortController);

    let fields: Record<string, string>;
    try {
      // Generate draft content with Ollama
      fields = await this.generateDraft(actionType, state.input, state.context, toolSchemaStr, abortController.signal);
      
      // Check for placeholders in required fields
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === "string") {
          const valTrimmed = value.trim();
          if (valTrimmed === "" || (valTrimmed.startsWith("[") && valTrimmed.endsWith("]"))) {
            throw new MissingArgumentError(`Please provide a valid ${key}.`);
          }
        }
      }
    } finally {
      this.activeStreams.delete(state.conversationId);
    }

    // Post-process: fix fields using real pre-fetched data
    this.fixDraftFieldsWithContext(actionType, fields, state.context);

    // Issue #1: Validate email recipient — if still not a valid email after fixDraftFieldsWithContext,
    // try harder to find one in context, or blank it and flag for user editing
    if (actionType === "reply_email" || actionType === "send_email" || actionType === "forward_email") {
      if (!fields.to || !fields.to.includes('@')) {
        // Try harder: scan all tool_result context for any email address
        const allContextStr = JSON.stringify(state.context);
        const emailsInContext = allContextStr.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g);
        if (emailsInContext && emailsInContext.length > 0) {
          // Use the first email found that isn't a system/noreply address
          const validEmail = emailsInContext.find(e => !e.includes('noreply') && !e.includes('no-reply') && !e.includes('mailer-daemon'));
          if (validEmail) {
            fields.to = validEmail;
          } else {
            fields.to = '';
            fields._recipientNotFound = 'true';
          }
        } else {
          // No email found anywhere — blank it and flag for UI
          fields.to = '';
          fields._recipientNotFound = 'true';
        }
      }
    }

    state.draft = {
      executionId,
      actionType,
      fields,
      description: `Draft for "${actionType}" on ${pendingTool.server}`,
    };

    // Emit draft-ready event to renderer
    this.safeSend(mainWindow, "workflow-draft-ready", {
      executionId,
      conversationId: state.conversationId,
      actionType,
      fields,
      description: state.draft.description,
      server: pendingTool.server,
      tool: pendingTool.tool,
    });

    // DraftCard in UI shows all the info — no need to stream text
    state.response = "";
  }

  /**
   * Generate draft content using Ollama based on action type and user input.
   */
  private async generateDraft(
    actionType: string,
    userInput: string,
    context: any[],
    toolSchemaStr: string,
    abortSignal?: AbortSignal
  ): Promise<Record<string, string>> {
    const draftPrompt = this.buildDraftPrompt(actionType, userInput, context, toolSchemaStr);

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
      console.warn("[Orchestrator] Draft generation failed, using fallback:", error);
    }

    // Fallback: return basic fields based on action type
    return this.getFallbackDraftFields(actionType, userInput);
  }

  private buildDraftPrompt(
    actionType: string,
    userInput: string,
    context: any[],
    toolSchemaStr: string
  ): { system: string; user: string } {
    const contextStr = context
      .filter((c) => c.type === "classification" || c.type === "tool_result")
      .map((c) => JSON.stringify(humanizeDates(c.params || c.result)))
      .join("\n")
      .slice(0, 2000);

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
          system: `You interpret action requests. Extract all relevant details from the user's message. Output ONLY a JSON object with the appropriate fields for a "${actionType}" action. No explanation, no markdown.`,
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
    // Issue #10: Attempt basic regex extraction so fallback fields are less empty
    const emailMatch = userInput.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const channelMatch = userInput.match(/#([\w-]+)/);
    const repoMatch = userInput.match(/(\w+\/\w+)/) || userInput.match(/(?:repo|repository)\s+(\S+)/i);

    switch (actionType) {
      case "reply_email":
      case "send_email":
      case "forward_email":
        return { to: emailMatch ? emailMatch[0] : "", subject: "", body: userInput };
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

    // For email actions: ensure 'to' is a valid email address
    if (actionType === "reply_email" || actionType === "send_email" || actionType === "forward_email") {
      const emailResult = toolResults.find((c) => c.tool === "search_emails");
      if (emailResult?.result && Array.isArray(emailResult.result) && emailResult.result.length > 0) {
        const email = emailResult.result[0];
        // Extract actual email address from the 'from' field
        const fromField = email.from || "";
        const emailMatch = fromField.match(/<([^>]+)>/) || fromField.match(/([^\s<]+@[^\s>]+)/);
        const actualEmail = emailMatch ? emailMatch[1] : fromField;

        // If 'to' doesn't look like an email, replace it with the extracted one
        if (fields.to && !fields.to.includes("@")) {
          fields.to = actualEmail;
        }
        // If subject is empty or generic, use the original email's subject
        if (!fields.subject || fields.subject === "Re: " || fields.subject.length < 3) {
          const originalSubject = email.subject || "";
          fields.subject = originalSubject.startsWith("Re:") ? originalSubject : `Re: ${originalSubject}`;
        }
        // Store messageId and threadId for reply functionality
        if (email.id) fields.messageId = email.id;
        if (email.threadId) fields.threadId = email.threadId;
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
        try { fields.startTime = new Date(fields.startTime).toISOString(); } catch {}
      }
      if (fields.endTime && !fields.endTime.includes("T")) {
        try { fields.endTime = new Date(fields.endTime).toISOString(); } catch {}
      }
      // If attendees is a string, try to parse as JSON array
      if (typeof fields.attendees === "string" && fields.attendees.startsWith("[")) {
        try {
          const parsed = JSON.parse(fields.attendees);
          fields.attendees = Array.isArray(parsed) ? parsed.join(",") : fields.attendees;
        } catch {}
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

      const pending: PendingApproval = {
        executionId,
        conversationId: state.conversationId,
        state,
        resolve,
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

      this.safeSend(mainWindow, "workflow-tool-executing", {
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

        // Check if the result indicates an error
        if (result && typeof result === 'object' && result.error) {
          console.error(`[Orchestrator] Execute error: ${tool.server}/${tool.tool}: ${result.error}`);
          state.context.push({ type: "tool_error", server: tool.server, tool: tool.tool, error: result.error });
          state.error = result.error;
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
    // If action was drafted, response was already sent during draftNode
    if (state.intent === "action" && state.draft) {
      // DraftCard in UI shows execution status — no need to stream additional text
      return;
    }

    const history = getConversationHistory(state.conversationId, 10);
    const messages = this.buildResponseMessages(state, history);

    let fullResponse = "";
    const abortController = new AbortController();
    this.activeStreams.set(state.conversationId, abortController);

    try {
      let tokenBuffer: string[] = [];
      let lastFlushTime = Date.now();

      for await (const token of streamChat(messages, undefined, abortController.signal)) {
        fullResponse += token;
        tokenBuffer.push(token);

        const now = Date.now();
        if (now - lastFlushTime >= 16) {
          this.safeSend(mainWindow, "workflow-stream", tokenBuffer.join(""));
          tokenBuffer = [];
          lastFlushTime = now;
        }
      }

      if (tokenBuffer.length > 0) {
        this.safeSend(mainWindow, "workflow-stream", tokenBuffer.join(""));
      }

      state.response = fullResponse;
    } catch (error: any) {
      if (error.name === 'AbortError' || abortController.signal.aborted) {
        throw error;
      }
      console.warn("[Orchestrator] Ollama unavailable for response, using fallback");
      state.response = this.generateFallbackResponse(state);
      this.safeSend(mainWindow, "workflow-stream", state.response);
    } finally {
      this.activeStreams.delete(state.conversationId);
    }
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
  ): Array<{ server: string; tool: string; params: Record<string, unknown>; result?: unknown }> {
    const input = state.input.toLowerCase();
    const classificationParams =
      state.context.find((c) => c.type === "classification")?.params || {};

    const tools: Array<{
      server: string;
      tool: string;
      params: Record<string, unknown>;
      result?: unknown;
    }> = [];

    // Issue #5: Optimize keyword matching — split input into a word Set for O(1) single-word
    // lookups; only do substring search for multi-word keys.
    const inputWords = new Set(input.split(/\s+/));
    // Separate single-word and multi-word keys for efficient matching
    const matchedKeywords: string[] = [];

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

          tools.push({
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

  private buildResponseMessages(
    state: WorkflowState,
    history: Message[]
  ): Array<{ role: "system" | "user" | "assistant"; content: string }> {
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
            return str.length > 3000 ? str.slice(0, 3000) + "..." : str;
          }
          return `Error fetching from ${c.server}: ${c.error}`;
        })
        .join("\n\n");

      messages.push({
        role: "system",
        content: `You are Atlas. Answer the user's question using ONLY the data below. Do NOT invent or add any information not present in the data. If the data is empty or has errors, say you couldn't find results. Write in plain text only — no markdown, no asterisks, no bullet points with *, no **bold**. Use plain sentences and line breaks.\n\nDATA:\n${contextStr}`,
      });
      messages.push({ role: "user", content: state.input });

    } else if (state.intent === "search") {
      // Search but no results
      const fallback = state.context.find((c) => c.type === "search_fallback" || c.type === "action_fallback");
      const reason = fallback?.reason || "No data was retrieved.";
      messages.push({
        role: "system",
        content: `You are Atlas. The user asked a question but no data could be fetched. ${reason} Tell them you couldn't find results and suggest checking Settings > Integrations. Do NOT make up any data. Write in plain text only — no markdown formatting.`,
      });
      messages.push({ role: "user", content: state.input });

    } else {
      // Chat or action — include some history for context
      messages.push({
        role: "system",
        content: `You are Atlas, a personal AI assistant. Be concise and helpful. NEVER invent information. If you don't know something, say so. Write in plain text only — no markdown, no asterisks, no **bold**, no bullet points. Use plain sentences.`,
      });

      // Include conversation history so the agent has full context
      const recentHistory = history.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
        }
      }

      messages.push({ role: "user", content: state.input });

      // Add tool results if any (for action intents)
      if (toolResults.length > 0) {
        const contextStr = toolResults
          .map((c) => {
            if (c.type === "tool_result") {
              // Humanize ISO dates so LLM outputs natural phrasing
              const humanized = humanizeDates(c.result);
              return JSON.stringify(humanized, null, 2);
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
    if (fromMatch) return `from:${fromMatch[1]} newer_than:30d`;

    // Time-based queries
    if (lower.includes("today")) return "newer_than:1d";
    if (lower.includes("yesterday")) return "newer_than:2d older_than:1d";
    if (lower.includes("this week")) return "newer_than:7d";
    if (lower.includes("this month")) return "newer_than:30d";
    if (lower.includes("unread")) return "is:unread";
    if (lower.includes("inbox")) return "is:inbox newer_than:1d";

    // Subject/topic queries
    const aboutMatch = lower.match(/(?:about|regarding|re:?)\s+(.+?)(?:\s*$|\s+(?:from|today|this))/);
    if (aboutMatch) return aboutMatch[1];

    // Default: recent inbox
    return "is:inbox newer_than:1d";
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
      const resultSummary = toolResults
        .map(
          (c) =>
            `• ${c.server}/${c.tool}: ${JSON.stringify(humanizeDates(c.result)).slice(0, 200)}`
        )
        .join("\n");
      return `Here's what I found:\n\n${resultSummary}`;
    }

    if (toolErrors.length > 0) {
      return `I wasn't able to complete your request. The following tools encountered errors:\n${toolErrors
        .map((c) => `• ${c.server}/${c.tool}: ${c.error}`)
        .join("\n")}\n\nPlease check that the relevant MCP servers are running.`;
    }

    if (state.intent === "chat") {
      return "I'm Atlas, your personal AI assistant. I can help you search emails, manage GitHub PRs, check your calendar, and more. However, my AI capabilities are currently limited because Ollama is not running. Please start Ollama for full functionality.";
    }

    return "I wasn't able to process your request. Please make sure Ollama is running for full AI features, or check that the relevant MCP servers are connected.";
  }

  // ── Public Approval API ────────────────────────────────────────────────────

  approve(executionId: string): boolean {
    const pending = this.pendingApprovals.get(executionId);
    if (!pending) {
      console.warn(`[Orchestrator] No pending approval found for: ${executionId}`);
      return false;
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

  abort(conversationId: string): void {
    const controller = this.activeStreams.get(conversationId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(conversationId);
    }
  }
}
