import { contextBridge, ipcRenderer } from "electron";

/**
 * Atlas Electron Preload Script.
 *
 * Exposes a safe, typed API to the renderer process via contextBridge.
 * contextIsolation=true means the renderer cannot access Node.js directly.
 * All Node/Electron APIs must be proxied through this bridge.
 */
contextBridge.exposeInMainWorld("atlasElectron", {
  /** Get the host OS platform string */
  getPlatform: (): Promise<string> =>
    ipcRenderer.invoke("get-platform"),

  /** Get the current app version from package.json */
  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke("get-app-version"),

  /** Open a URL in the default OS browser */
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),

  /** Set the OS-level theme (affects native title bar, etc.) */
  setTheme: (theme: "dark" | "light"): Promise<void> =>
    ipcRenderer.invoke("set-theme", theme),

  /** Open a directory picker dialog (for LocalFS connector) */
  selectDirectory: (): Promise<string[]> =>
    ipcRenderer.invoke("select-directory"),

  /** Parse a local file to extract text or get base64 image */
  parseFile: (filePath: string): Promise<{ type: 'text' | 'image', content: string, mimeType?: string, filename: string }> =>
    ipcRenderer.invoke("parse-file", filePath),

  /**
   * Subscribe to the global Cmd+Space command bar toggle event.
   * Returns an unsubscribe function.
   */
  onToggleCommandBar: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("toggle-command-bar", handler);
    return () => ipcRenderer.removeListener("toggle-command-bar", handler);
  },

  /** Listen for OAuth callback from system browser */
  onOAuthCallback: (callback: (data: { access_token: string; refresh_token: string }) => void): (() => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on("oauth-callback", handler);
    return () => ipcRenderer.removeListener("oauth-callback", handler);
  },

  // ── Ollama AI APIs ──────────────────────────────────────────────────────────

  /** Check if Ollama is running and list available models */
  checkOllamaHealth: (): Promise<{ available: boolean; models?: string[] }> =>
    ipcRenderer.invoke("ollama-health"),

  /**
   * Send a chat message to Ollama for streaming completion.
   * Subscribe to onChatStream/onChatStreamEnd for tokens.
   */
  sendChatMessage: (
    messages: Array<{ role: string; content: string }>,
    model?: string
  ): Promise<void> =>
    ipcRenderer.invoke("chat-send", { messages, model }),

  /**
   * Subscribe to chat stream tokens from Ollama.
   * Returns an unsubscribe function.
   */
  onChatStream: (callback: (token: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string) =>
      callback(token);
    ipcRenderer.on("chat-stream", handler);
    return () => ipcRenderer.removeListener("chat-stream", handler);
  },

  /**
   * Subscribe to chat stream completion event.
   * Returns an unsubscribe function.
   */
  onChatStreamEnd: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("chat-stream-end", handler);
    return () => ipcRenderer.removeListener("chat-stream-end", handler);
  },

  /** Generate an embedding vector for the given text */
  generateEmbedding: (text: string, model?: string): Promise<number[]> =>
    ipcRenderer.invoke("embed-text", { text, model }),

  // ── MCP Server APIs ─────────────────────────────────────────────────────────

  /** Get status of all MCP servers */
  mcpGetStatus: (): Promise<Array<{ name: string; status: string; restartCount: number; lastError?: string }>> =>
    ipcRenderer.invoke("mcp-status"),

  /** Start a specific MCP server by name */
  mcpStartServer: (name: string): Promise<void> =>
    ipcRenderer.invoke("mcp-start", name),

  /** Stop a specific MCP server by name */
  mcpStopServer: (name: string): Promise<void> =>
    ipcRenderer.invoke("mcp-stop", name),

  /** Execute a tool call on a specific MCP server */
  mcpCallTool: (server: string, tool: string, params: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke("mcp-call-tool", { server, tool, params }),

  /** List available tools on a specific MCP server */
  mcpListTools: (server: string): Promise<Array<{ name: string; description: string }>> =>
    ipcRenderer.invoke("mcp-list-tools", server),

  // ── Orchestrator Workflow APIs ──────────────────────────────────────────────

  /**
   * Execute a workflow with a user prompt.
   * Results stream back via onWorkflowStream, onWorkflowComplete, etc.
   */
  executeWorkflow: (prompt: string, conversationId?: string): Promise<void> =>
    ipcRenderer.invoke("workflow-execute", { prompt, conversationId }),

  /** Approve a pending destructive action */
  approveAction: (executionId: string): Promise<void> =>
    ipcRenderer.invoke("workflow-approve", { executionId }),

  /** Reject a pending destructive action */
  rejectAction: (executionId: string): Promise<void> =>
    ipcRenderer.invoke("workflow-reject", { executionId }),

  /**
   * Abort the current workflow.
   * NOTE: This signals abort intent but does not cancel the backend Ollama stream
   * (that would require orchestrator.ts changes). The renderer should unsubscribe
   * its IPC listeners immediately after calling this.
   */
  abortWorkflow: (): Promise<void> =>
    ipcRenderer.invoke("workflow-abort"),

  /**
   * Subscribe to streaming tokens during response generation.
   * Returns an unsubscribe function.
   */
  onWorkflowStream: (callback: (token: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, token: string) =>
      callback(token);
    ipcRenderer.on("workflow-stream", handler);
    return () => ipcRenderer.removeListener("workflow-stream", handler);
  },

  /**
   * Subscribe to approval-needed events for destructive actions.
   * Returns an unsubscribe function.
   */
  onWorkflowApprovalNeeded: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) =>
      callback(data);
    ipcRenderer.on("workflow-approval-needed", handler);
    return () => ipcRenderer.removeListener("workflow-approval-needed", handler);
  },

  /**
   * Subscribe to tool-executing events (when an MCP tool is being called).
   * Returns an unsubscribe function.
   */
  onWorkflowToolExecuting: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) =>
      callback(data);
    ipcRenderer.on("workflow-tool-executing", handler);
    return () => ipcRenderer.removeListener("workflow-tool-executing", handler);
  },

  /**
   * Subscribe to draft-ready events for action drafts.
   * Returns an unsubscribe function.
   */
  onWorkflowDraftReady: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) =>
      callback(data);
    ipcRenderer.on("workflow-draft-ready", handler);
    return () => ipcRenderer.removeListener("workflow-draft-ready", handler);
  },

  /**
   * Subscribe to workflow completion events.
   * Returns an unsubscribe function.
   */
  onWorkflowComplete: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) =>
      callback(data);
    ipcRenderer.on("workflow-complete", handler);
    return () => ipcRenderer.removeListener("workflow-complete", handler);
  },

  // ── Conversation APIs ───────────────────────────────────────────────────────

  /** List all conversations, most recent first */
  listConversations: (): Promise<any[]> =>
    ipcRenderer.invoke("conversations-list"),

  /** Get message history for a conversation */
  getConversationHistory: (id: string, limit?: number): Promise<any[]> =>
    ipcRenderer.invoke("conversation-history", { id, limit }),

  // ── Local Auth APIs ───────────────────────────────────────────────────────────

  localAuth: {
    /** Register a new local user */
    register: (
      email: string,
      password: string,
      fullName: string
    ): Promise<{ id: string; email: string; full_name: string; created_at: string; updated_at: string }> =>
      ipcRenderer.invoke("auth-register", { email, password, fullName }),

    /** Login with email and password */
    login: (
      email: string,
      password: string
    ): Promise<{ id: string; email: string; full_name: string; created_at: string; updated_at: string }> =>
      ipcRenderer.invoke("auth-login", { email, password }),

    /** Logout the current user */
    logout: (): Promise<void> =>
      ipcRenderer.invoke("auth-logout"),

    /** Get the currently authenticated user (or null) */
    getCurrentUser: (): Promise<{
      id: string;
      email: string;
      full_name: string;
      created_at: string;
      updated_at: string;
    } | null> =>
      ipcRenderer.invoke("auth-current-user"),

    /** Update the current user's profile */
    updateProfile: (data: {
      email?: string;
      full_name?: string;
      password?: string;
    }): Promise<{ id: string; email: string; full_name: string; created_at: string; updated_at: string }> =>
      ipcRenderer.invoke("auth-update-profile", data),
  },

  // ── Token Store APIs ──────────────────────────────────────────────────────────

  tokenStore: {
    /** Get stored credentials for a provider */
    get: (provider: string): Promise<Record<string, any> | null> =>
      ipcRenderer.invoke("token-get", provider),

    /** Store credentials for a provider */
    set: (provider: string, credentials: Record<string, any>): Promise<void> =>
      ipcRenderer.invoke("token-set", { provider, credentials }),

    /** Remove credentials for a provider */
    remove: (provider: string): Promise<void> =>
      ipcRenderer.invoke("token-remove", provider),

    /** List all providers that have credentials configured */
    listConfigured: (): Promise<string[]> =>
      ipcRenderer.invoke("token-list-configured"),
  },

  // ── Google OAuth API ────────────────────────────────────────────────────────

  /** Start Google OAuth flow in a popup window */
  startGoogleOAuth: (clientId: string, clientSecret: string): Promise<{ success: boolean; tokens?: any; error?: string }> =>
    ipcRenderer.invoke('google-oauth-start', { clientId, clientSecret }),
});

// TypeScript global declaration (used in renderer)
export type AtlasElectronAPI = {
  getPlatform: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  setTheme: (theme: "dark" | "light") => Promise<void>;
  selectDirectory: () => Promise<string[]>;
  parseFile: (filePath: string) => Promise<{ type: 'text' | 'image', content: string, mimeType?: string, filename: string }>;
  onToggleCommandBar: (callback: () => void) => () => void;
  checkOllamaHealth: () => Promise<{ available: boolean; models?: string[] }>;
  sendChatMessage: (
    messages: Array<{ role: string; content: string }>,
    model?: string
  ) => Promise<void>;
  onChatStream: (callback: (token: string) => void) => () => void;
  onChatStreamEnd: (callback: () => void) => () => void;
  generateEmbedding: (text: string, model?: string) => Promise<number[]>;
  // MCP Server APIs
  mcpGetStatus: () => Promise<Array<{ name: string; status: string; restartCount: number; lastError?: string }>>;
  mcpStartServer: (name: string) => Promise<void>;
  mcpStopServer: (name: string) => Promise<void>;
  mcpCallTool: (server: string, tool: string, params: Record<string, unknown>) => Promise<unknown>;
  mcpListTools: (server: string) => Promise<Array<{ name: string; description: string }>>;
  // Orchestrator Workflow APIs
  executeWorkflow: (prompt: string, conversationId?: string) => Promise<void>;
  approveAction: (executionId: string) => Promise<void>;
  rejectAction: (executionId: string) => Promise<void>;
  abortWorkflow: () => Promise<void>;
  onWorkflowStream: (callback: (token: string) => void) => () => void;
  onWorkflowApprovalNeeded: (callback: (data: any) => void) => () => void;
  onWorkflowToolExecuting: (callback: (data: any) => void) => () => void;
  onWorkflowDraftReady: (callback: (data: any) => void) => () => void;
  onWorkflowComplete: (callback: (data: any) => void) => () => void;
  // Conversation APIs
  listConversations: () => Promise<any[]>;
  getConversationHistory: (id: string, limit?: number) => Promise<any[]>;
  // Local Auth APIs
  localAuth: {
    register: (email: string, password: string, fullName: string) => Promise<{
      id: string;
      email: string;
      full_name: string;
      created_at: string;
      updated_at: string;
    }>;
    login: (email: string, password: string) => Promise<{
      id: string;
      email: string;
      full_name: string;
      created_at: string;
      updated_at: string;
    }>;
    logout: () => Promise<void>;
    getCurrentUser: () => Promise<{
      id: string;
      email: string;
      full_name: string;
      created_at: string;
      updated_at: string;
    } | null>;
    updateProfile: (data: {
      email?: string;
      full_name?: string;
      password?: string;
    }) => Promise<{
      id: string;
      email: string;
      full_name: string;
      created_at: string;
      updated_at: string;
    }>;
  };
  // Token Store APIs
  tokenStore: {
    get: (provider: string) => Promise<Record<string, any> | null>;
    set: (provider: string, credentials: Record<string, any>) => Promise<void>;
    remove: (provider: string) => Promise<void>;
    listConfigured: () => Promise<string[]>;
  };
  // Google OAuth API
  startGoogleOAuth: (clientId: string, clientSecret: string) => Promise<{ success: boolean; tokens?: any; error?: string }>;
};

declare global {
  interface Window {
    atlasElectron?: AtlasElectronAPI;
  }
}
