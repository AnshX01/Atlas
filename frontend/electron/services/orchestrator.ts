/**
 * Atlas Orchestrator — LangGraph-style Local State Machine
 *
 * Replaces the cloud-based supervisor agent with a local routing engine
 * running in the Electron main process. Implements a directed graph of nodes:
 *
 *   Input → Router → [Search | Action | Chat]
 *                          ↓         ↓
 *                      Execute   Approval → Execute
 *                          ↓         ↓         ↓
 *                       Response ← ← ← ← ← ← ←
 *
 * Destructive actions pause at the Approval node and require user confirmation
 * before proceeding to Execute.
 */

import { BrowserWindow } from "electron";
import { randomUUID } from "crypto";
import { streamChat } from "./ollama";
import { classifyIntent, Intent } from "./intent-classifier";
import { MCPServerManager } from "./mcp-manager";
import {
  initDB,
  createConversation,
  saveMessage,
  getConversationHistory,
  saveToolExecution,
  Message,
} from "./local-store";
import { GitHubConnector } from './connectors/github';
import { GmailConnector } from './connectors/gmail';
import { SlackConnector } from './connectors/slack';
import { NotionConnector } from './connectors/notion';

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
  error?: string;
}

export interface PendingApproval {
  executionId: string;
  conversationId: string;
  state: WorkflowState;
  resolve: (approved: boolean) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Tools that modify external state and ALWAYS require user approval.
 */
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
]);

/**
 * Read-only tools that execute immediately without approval.
 */
const READONLY_TOOLS = new Set([
  "read_emails",
  "search_emails",
  "list_emails",
  "list_calendar",
  "get_calendar_event",
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

/**
 * Map of intent keywords to likely MCP servers and tools.
 */
const TOOL_ROUTING: Record<string, { server: string; tool: string }[]> = {
  email: [
    { server: "google_workspace", tool: "search_emails" },
    { server: "google_workspace", tool: "read_emails" },
  ],
  calendar: [
    { server: "google_workspace", tool: "list_calendar" },
  ],
  pr: [
    { server: "github", tool: "list_prs" },
    { server: "github", tool: "get_pr" },
  ],
  issue: [
    { server: "github", tool: "list_issues" },
    { server: "github", tool: "get_issue" },
  ],
  merge: [
    { server: "github", tool: "merge_pr" },
  ],
  slack: [
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
  file: [
    { server: "filesystem", tool: "read_file" },
    { server: "filesystem", tool: "search_files" },
    { server: "filesystem", tool: "list_directory" },
  ],
};

// ── Real Tool Execution via Direct API Connectors ──────────────────────────────

async function executeRealToolCall(server: string, tool: string, params: Record<string, any>): Promise<any> {
  switch (server) {
    case 'github': {
      const gh = new GitHubConnector();
      if (!(await gh.init())) return { error: 'GitHub not configured. Add your Personal Access Token in Settings.' };
      switch (tool) {
        case 'list_prs': return await gh.listPRs(params.state || 'open');
        case 'get_pr': return await gh.getPR(params.owner, params.repo, params.number);
        case 'list_issues': return await gh.listIssues();
        case 'list_repos': return await gh.listRepos();
        case 'merge_pr': return await gh.mergePR(params.owner, params.repo, params.number);
        case 'search_code': return await gh.searchCode(params.query);
        default: return { error: `Unknown GitHub tool: ${tool}` };
      }
    }
    case 'google_workspace': {
      const gmail = new GmailConnector();
      if (!(await gmail.init())) return { error: 'Google Workspace not configured. Complete OAuth in Settings > Test Connection.' };
      switch (tool) {
        case 'list_emails':
        case 'search_emails':
        case 'read_emails': return await gmail.listEmails(params.maxResults || 10, params.query || '');
        case 'get_email': return await gmail.getEmail(params.messageId);
        case 'send_email': return await gmail.sendEmail(params.to, params.subject, params.body);
        case 'list_calendar':
        case 'list_events': return await gmail.listCalendarEvents();
        default: return { error: `Unknown Google tool: ${tool}` };
      }
    }
    case 'slack': {
      const slack = new SlackConnector();
      if (!(await slack.init())) return { error: 'Slack not configured. Add your Bot Token in Settings.' };
      switch (tool) {
        case 'list_channels': return await slack.listChannels();
        case 'list_messages': return await slack.listMessages(params.channel, params.limit);
        case 'list_unread': return await slack.listUnread();
        case 'post_message': return await slack.postMessage(params.channel, params.text);
        default: return { error: `Unknown Slack tool: ${tool}` };
      }
    }
    case 'notion': {
      const notion = new NotionConnector();
      if (!(await notion.init())) return { error: 'Notion not configured. Add your Integration Token in Settings.' };
      switch (tool) {
        case 'search_pages':
        case 'search': return await notion.searchPages(params.query || '');
        case 'get_page': return await notion.getPage(params.pageId);
        case 'list_databases': return await notion.listDatabases();
        case 'create_page': return await notion.createPage(params.parentId, params.title, params.content);
        default: return { error: `Unknown Notion tool: ${tool}` };
      }
    }
    default:
      return { error: `Unknown connector: ${server}` };
  }
}

// ── Orchestrator Class ─────────────────────────────────────────────────────────

export class Orchestrator {
  private mcpManager: MCPServerManager;
  private pendingApprovals: Map<string, PendingApproval> = new Map();

  constructor(mcpManager: MCPServerManager) {
    this.mcpManager = mcpManager;
  }

  /**
   * Execute a full workflow for a user prompt.
   * Routes through the state graph and emits events to the renderer.
   */
  async execute(
    prompt: string,
    mainWindow: BrowserWindow,
    conversationId?: string
  ): Promise<void> {
    // Ensure DB is ready
    initDB();

    // Create or resume conversation
    if (!conversationId) {
      const title = prompt.slice(0, 60) + (prompt.length > 60 ? "..." : "");
      const conversation = createConversation(title);
      conversationId = conversation.id;
    }

    // Save user message
    saveMessage(conversationId, "user", prompt);

    // Initialize workflow state
    const state: WorkflowState = {
      input: prompt,
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
      // ── Node 1: Router ──────────────────────────────────────────────────
      await this.routerNode(state);

      // ── Node 2-5: Route based on intent ─────────────────────────────────
      switch (state.intent) {
        case "search":
          await this.searchNode(state, mainWindow);
          break;

        case "action":
          await this.actionNode(state, mainWindow);
          if (state.requiresApproval) {
            // Pause — wait for user approval
            const approved = await this.approvalNode(state, mainWindow);
            if (approved) {
              await this.executeNode(state, mainWindow);
            } else {
              state.response = "Action cancelled by user.";
              saveMessage(conversationId, "assistant", state.response);
              mainWindow.webContents.send("workflow-complete", {
                conversationId,
                response: state.response,
                cancelled: true,
              });
              return;
            }
          } else {
            // Read-only action — execute immediately
            await this.executeNode(state, mainWindow);
          }
          break;

        case "chat":
        default:
          // Skip tool execution for chat
          break;
      }

      // ── Node 6: Response Generation ────────────────────────────────────
      await this.responseNode(state, mainWindow);

      // Save assistant response
      saveMessage(conversationId, "assistant", state.response);

      // Emit completion
      mainWindow.webContents.send("workflow-complete", {
        conversationId,
        response: state.response,
        intent: state.intent,
        toolCalls: state.toolCalls,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      state.error = errorMsg;
      console.error("[Orchestrator] Workflow error:", errorMsg);

      // Save error as assistant message
      const errorResponse = `I encountered an error while processing your request: ${errorMsg}`;
      saveMessage(conversationId, "assistant", errorResponse);

      mainWindow.webContents.send("workflow-complete", {
        conversationId,
        response: errorResponse,
        error: errorMsg,
      });
    }
  }

  // ── Node Implementations ───────────────────────────────────────────────────

  /**
   * Router Node: Classifies user intent using Ollama or keyword fallback.
   */
  private async routerNode(state: WorkflowState): Promise<void> {
    const result = await classifyIntent(state.input);
    state.intent = result.intent;

    // Store classification params as context
    if (Object.keys(result.extractedParams).length > 0) {
      state.context.push({
        type: "classification",
        intent: result.intent,
        confidence: result.confidence,
        params: result.extractedParams,
      });
    }

    console.log(
      `[Orchestrator] Router classified intent as "${state.intent}" (confidence: ${result.confidence})`
    );
  }

  /**
   * Search Node: Determines which tools to call for information retrieval.
   * Queries available MCP servers based on the search context.
   */
  private async searchNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    const toolsToCall = this.resolveTools(state, "search");

    if (toolsToCall.length === 0) {
      // No tools available — will respond with chat
      state.context.push({
        type: "search_fallback",
        reason: "No relevant MCP tools available for this search",
      });
      return;
    }

    // Execute read-only tools immediately
    for (const tool of toolsToCall) {
      mainWindow.webContents.send("workflow-tool-executing", {
        server: tool.server,
        tool: tool.tool,
        params: tool.params,
      });

      try {
        const result = await executeRealToolCall(
          tool.server,
          tool.tool,
          tool.params as Record<string, any>
        );
        tool.result = result;
        state.toolCalls.push(tool);

        // Log the tool execution
        saveToolExecution(
          state.conversationId,
          tool.server,
          tool.tool,
          tool.params,
          result
        );

        // Add result to context for response generation
        state.context.push({
          type: "tool_result",
          server: tool.server,
          tool: tool.tool,
          result,
        });
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

  /**
   * Action Node: Determines which tool to call for a mutating action.
   * Sets requiresApproval if the tool is destructive.
   */
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

    // Take the first (most relevant) tool
    const primaryTool = toolsToCall[0];
    state.toolCalls.push(primaryTool);

    // Check if this tool requires approval
    if (DESTRUCTIVE_TOOLS.has(primaryTool.tool)) {
      state.requiresApproval = true;
    }
  }

  /**
   * Approval Node: Pauses execution and asks the user to approve.
   * Returns a Promise that resolves when the user responds.
   */
  private approvalNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const executionId = randomUUID();
      const pendingTool = state.toolCalls[state.toolCalls.length - 1];

      const pending: PendingApproval = {
        executionId,
        conversationId: state.conversationId,
        state,
        resolve,
      };

      this.pendingApprovals.set(executionId, pending);

      // Emit event to renderer asking for approval
      mainWindow.webContents.send("workflow-approval-needed", {
        executionId,
        conversationId: state.conversationId,
        tool: pendingTool.tool,
        server: pendingTool.server,
        params: pendingTool.params,
        description: `Execute "${pendingTool.tool}" on ${pendingTool.server}`,
      });

      console.log(
        `[Orchestrator] Awaiting approval for ${pendingTool.server}/${pendingTool.tool} (id: ${executionId})`
      );
    });
  }

  /**
   * Execute Node: Calls the MCP tool after approval (or for read-only tools).
   */
  private async executeNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    // Execute all pending tool calls that don't have results yet
    for (const tool of state.toolCalls) {
      if (tool.result !== undefined) continue;

      mainWindow.webContents.send("workflow-tool-executing", {
        server: tool.server,
        tool: tool.tool,
        params: tool.params,
      });

      try {
        const result = await executeRealToolCall(
          tool.server,
          tool.tool,
          tool.params as Record<string, any>
        );
        tool.result = result;

        // Log the tool execution
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
   * Falls back to a simple text response if Ollama is unavailable.
   */
  private async responseNode(
    state: WorkflowState,
    mainWindow: BrowserWindow
  ): Promise<void> {
    // Build conversation context for the LLM
    const history = getConversationHistory(state.conversationId, 20);
    const messages = this.buildResponseMessages(state, history);

    let fullResponse = "";

    try {
      for await (const token of streamChat(messages)) {
        fullResponse += token;
        mainWindow.webContents.send("workflow-stream", token);
      }
      state.response = fullResponse;
    } catch (error) {
      // Ollama unavailable — generate a simple response
      console.warn("[Orchestrator] Ollama unavailable for response, using fallback");
      state.response = this.generateFallbackResponse(state);
      mainWindow.webContents.send("workflow-stream", state.response);
    }
  }

  // ── Helper Methods ─────────────────────────────────────────────────────────

  /**
   * Resolve which MCP tools to call based on intent and input context.
   */
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

    // Match keywords in input to TOOL_ROUTING
    for (const [keyword, routes] of Object.entries(TOOL_ROUTING)) {
      if (input.includes(keyword)) {
        for (const route of routes) {
          // For search intents, only pick read-only tools
          if (intentType === "search" && !READONLY_TOOLS.has(route.tool)) {
            continue;
          }
          // For action intents, prefer mutating tools
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

    // Deduplicate by server+tool
    const seen = new Set<string>();
    return tools.filter((t) => {
      const key = `${t.server}:${t.tool}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Build parameters for a tool call based on user input and classification.
   */
  private buildToolParams(
    toolName: string,
    input: string,
    classParams: Record<string, unknown>
  ): Record<string, unknown> {
    // Use extracted params from classification if available
    const query = (classParams.query as string) || input;

    switch (toolName) {
      case "search_emails":
      case "list_emails":
      case "read_emails":
        return { query, maxResults: 10 };

      case "list_calendar":
      case "get_calendar_event":
        return { query, timeMin: new Date().toISOString() };

      case "list_prs":
      case "search_repo":
        return { query, state: "open" };

      case "get_pr":
      case "merge_pr":
      case "close_pr": {
        const prMatch = input.match(/#(\d+)/);
        return { pull_number: prMatch ? parseInt(prMatch[1]) : undefined, query };
      }

      case "list_issues":
        return { query, state: "open" };

      case "get_issue":
      case "close_issue": {
        const issueMatch = input.match(/#(\d+)/);
        return { issue_number: issueMatch ? parseInt(issueMatch[1]) : undefined, query };
      }

      case "search_messages":
      case "read_messages":
      case "post_message":
      case "send_message": {
        const channelMatch = input.match(/#([\w-]+)/);
        return {
          query,
          channel: channelMatch ? channelMatch[1] : undefined,
          text: (classParams.details as string) || input,
        };
      }

      case "search_pages":
      case "get_page":
        return { query };

      case "read_file":
      case "list_directory":
      case "search_files":
        return { path: (classParams.target as string) || ".", query };

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

  /**
   * Build the messages array for the response generation LLM call.
   */
  private buildResponseMessages(
    state: WorkflowState,
    history: Message[]
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // System message
    messages.push({
      role: "system",
      content: `You are Atlas, a personal AI assistant. You help the user manage their digital workspace including emails, calendar, GitHub, Slack, Notion, and local files.

You have access to tool results from various integrations. When presenting tool results:
- Summarize information clearly and concisely
- Format data in an easy-to-read way
- If a tool call failed, explain what went wrong and suggest alternatives
- Be conversational but efficient

Current context: The user's intent was classified as "${state.intent}".`,
    });

    // Include recent conversation history (excluding the latest user message)
    const recentHistory = history.slice(-10); // Last 10 messages for context
    for (const msg of recentHistory) {
      if (msg.role === "user" || msg.role === "assistant") {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Current user input
    messages.push({ role: "user", content: state.input });

    // Add tool context if available
    const toolResults = state.context.filter(
      (c) => c.type === "tool_result" || c.type === "tool_error"
    );
    if (toolResults.length > 0) {
      const contextStr = toolResults
        .map((c) => {
          if (c.type === "tool_result") {
            return `[Tool: ${c.server}/${c.tool}]\nResult: ${JSON.stringify(c.result, null, 2)}`;
          }
          return `[Tool: ${c.server}/${c.tool}]\nError: ${c.error}`;
        })
        .join("\n\n");

      messages.push({
        role: "system",
        content: `Here are the results from tool calls:\n\n${contextStr}\n\nPlease synthesize this information into a helpful response.`,
      });
    }

    return messages;
  }

  /**
   * Generate a simple fallback response when Ollama is unavailable.
   */
  private generateFallbackResponse(state: WorkflowState): string {
    const toolResults = state.context.filter((c) => c.type === "tool_result");
    const toolErrors = state.context.filter((c) => c.type === "tool_error");

    if (toolResults.length > 0) {
      const resultSummary = toolResults
        .map(
          (c) =>
            `• ${c.server}/${c.tool}: ${JSON.stringify(c.result).slice(0, 200)}`
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

  /**
   * Approve a pending action by execution ID.
   */
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

  /**
   * Reject a pending action by execution ID.
   */
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

  /**
   * Get list of all pending approvals.
   */
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
