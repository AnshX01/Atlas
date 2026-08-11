/**
 * Atlas Electron IPC API type declarations.
 * These types are available in the renderer when running inside Electron.
 */

interface AtlasLocalAuthAPI {
  login: (email: string, password: string) => Promise<AtlasLocalUser>;
  register: (email: string, password: string, fullName?: string) => Promise<AtlasLocalUser>;
  loginWithGoogle: (email: string, fullName: string, sub: string) => Promise<AtlasLocalUser>;
  logout: () => Promise<void>;
  getCurrentUser: () => Promise<AtlasLocalUser | null>;
  updateProfile: (data: { full_name?: string; email?: string }) => Promise<AtlasLocalUser>;
}

interface AtlasLocalUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

interface AtlasTokenStoreAPI {
  get: (provider: string) => Promise<Record<string, string> | null>;
  set: (provider: string, credentials: Record<string, string>) => Promise<void>;
  save: (provider: string, credentials: Record<string, string>) => Promise<void>;
  remove: (provider: string) => Promise<void>;
  listConfigured: () => Promise<string[]>;
  testConnection: (provider: string) => Promise<{ success: boolean; error?: string }>;
}

interface AtlasElectronAPI {
  getPlatform: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  setTheme: (theme: "dark" | "light") => Promise<void>;
  selectDirectory: () => Promise<string[]>;
  parseFile: (filePath: string) => Promise<{ type: 'text' | 'image', content: string, mimeType?: string, filename: string }>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  onWindowMaximized: (callback: () => void) => () => void;
  onWindowUnmaximized: (callback: () => void) => () => void;
  onToggleCommandBar: (callback: () => void) => () => void;
  checkOllamaHealth: () => Promise<{ available: boolean; models?: string[] }>;
  sendChatMessage: (messages: Array<{ role: string; content: string }>, model?: string) => Promise<void>;
  onChatStream: (callback: (token: string) => void) => () => void;
  onChatStreamEnd: (callback: () => void) => () => void;
  generateEmbedding: (text: string, model?: string) => Promise<number[]>;
  mcpGetStatus: () => Promise<Array<{ name: string; status: string; restartCount: number; lastError?: string }>>;
  mcpStartServer: (name: string) => Promise<void>;
  mcpStopServer: (name: string) => Promise<void>;
  mcpCallTool: (server: string, tool: string, params: Record<string, unknown>) => Promise<any>;
  mcpListTools: (server: string) => Promise<Array<{ name: string; description: string }>>;

  executeWorkflow: (prompt: string, conversationId?: string) => Promise<void>;
  approveAction: (executionId: string) => Promise<void>;
  rejectAction: (executionId: string) => Promise<void>;
  abortWorkflow: () => Promise<void>;
  onWorkflowStream: (cb: (token: string) => void) => () => void;
  onWorkflowApprovalNeeded: (cb: (data: unknown) => void) => () => void;
  onWorkflowToolExecuting: (cb: (data: unknown) => void) => () => void;
  onWorkflowComplete: (cb: (data: unknown) => void) => () => void;
  onWorkflowDraftReady: (cb: (data: unknown) => void) => () => void;
  listConversations: () => Promise<unknown[]>;
  getConversationHistory: (id: string, limit?: number) => Promise<unknown[]>;
  localAuth: AtlasLocalAuthAPI;
  tokenStore: AtlasTokenStoreAPI;
  startGoogleOAuth: (clientId: string, clientSecret: string) => Promise<{ success: boolean; tokens?: any; error?: string }>;
}

declare global {
  interface Window {
    atlasElectron?: AtlasElectronAPI;
  }
}

export {};
