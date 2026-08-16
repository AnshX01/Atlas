/**
 * @jest-environment node
 */

/**
 * IPC Handler Input Validation Tests
 *
 * These tests verify that IPC handlers properly validate their inputs
 * and return error objects instead of throwing when given invalid data.
 */

// Mock electron modules before imports
jest.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: jest.fn(() => "/tmp/atlas-test"),
    getVersion: jest.fn(() => "0.1.0"),
    whenReady: jest.fn(() => Promise.resolve()),
    on: jest.fn(),
    setLoginItemSettings: jest.fn(),
    quit: jest.fn(),
  },
  BrowserWindow: jest.fn(),
  globalShortcut: { register: jest.fn(), unregisterAll: jest.fn() },
  ipcMain: {
    handle: jest.fn(),
  },
  nativeTheme: { themeSource: "dark" },
  shell: { openExternal: jest.fn() },
  session: { defaultSession: { setPermissionRequestHandler: jest.fn() } },
  Tray: jest.fn(),
  Menu: { setApplicationMenu: jest.fn(), buildFromTemplate: jest.fn() },
  dialog: { showOpenDialog: jest.fn() },
}));

jest.mock("electron-serve", () => jest.fn(() => jest.fn()));

// Capture IPC handlers as they're registered
type IpcHandler = (event: any, ...args: any[]) => any;
const ipcHandlers: Record<string, IpcHandler> = {};

const { ipcMain } = require("electron");
(ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: IpcHandler) => {
  ipcHandlers[channel] = handler;
});

// Mock all service dependencies
jest.mock("../../electron/services/mcp-manager", () => ({
  MCPServerManager: jest.fn().mockImplementation(() => ({
    startAll: jest.fn().mockResolvedValue(undefined),
    stopAll: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockReturnValue([]),
    startServer: jest.fn(),
    stopServer: jest.fn(),
    sendToolCall: jest.fn(),
    listTools: jest.fn(),
  })),
}));

jest.mock("../../electron/services/background-cron", () => ({
  CronEngine: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

jest.mock("../../electron/services/ollama", () => ({
  checkOllamaHealth: jest.fn().mockResolvedValue(true),
  getHealthStatus: jest.fn(),
  getAvailableModels: jest.fn(),
  streamChat: jest.fn(),
  generateEmbedding: jest.fn(),
  verifyInference: jest.fn(),
  isOllamaInstalled: jest.fn(),
  startOllamaDaemon: jest.fn(),
  installOllama: jest.fn(),
}));

jest.mock("../../electron/services/orchestrator", () => ({
  Orchestrator: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockReturnValue(true),
    reject: jest.fn().mockReturnValue(true),
    abortWorkflow: jest.fn(),
    abortAll: jest.fn(),
  })),
}));

jest.mock("../../electron/services/local-store", () => ({
  initDB: jest.fn().mockResolvedValue(undefined),
  closeDB: jest.fn(),
  listConversations: jest.fn().mockReturnValue([]),
  getConversationHistory: jest.fn().mockReturnValue([]),
}));

jest.mock("../../electron/services/file-parser", () => ({
  parseFile: jest.fn().mockReturnValue({ text: "hello" }),
}));

jest.mock("../../electron/services/local-auth", () => ({
  initAuthTables: jest.fn().mockResolvedValue(undefined),
  register: jest.fn(),
  login: jest.fn(),
  loginWithGoogle: jest.fn(),
  logout: jest.fn(),
  getCurrentUser: jest.fn(),
  updateProfile: jest.fn(),
}));

jest.mock("../../electron/services/token-store", () => ({
  getToken: jest.fn(),
  setToken: jest.fn(),
  removeToken: jest.fn(),
  listConfigured: jest.fn().mockReturnValue([]),
}));

jest.mock("../../electron/services/google-oauth", () => ({
  startGoogleOAuth: jest.fn(),
  handleOAuthCallback: jest.fn(),
  hasPendingOAuth: jest.fn(),
  setOAuthRedirectPort: jest.fn(),
}));

jest.mock("../../electron/services/cloud-sync", () => ({
  syncManager: {
    getState: jest.fn(),
    handleOnlineStatus: jest.fn(),
    forceSync: jest.fn(),
    queueDelta: jest.fn(),
    pullFromCloud: jest.fn(),
    pullSecret: jest.fn(),
  },
}));

// We need to require main.ts AFTER all mocks are in place
// This will register all ipcMain.handle calls
beforeAll(() => {
  // Suppress console during require
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  require("../../electron/main");
});

afterAll(() => {
  jest.restoreAllMocks();
});

const mockEvent = { sender: { send: jest.fn() } };

describe("IPC Input Validation", () => {
  describe("chat-send", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["chat-send"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/[Ii]nvalid/);
    });

    it("returns error object when passed undefined", async () => {
      const handler = ipcHandlers["chat-send"];
      const result = await handler(mockEvent, undefined);
      expect(result).toHaveProperty("error");
    });

    it("returns error when messages is not an array", async () => {
      const handler = ipcHandlers["chat-send"];
      const result = await handler(mockEvent, { messages: "not-an-array" });
      expect(result).toHaveProperty("error");
    });
  });

  describe("embed-text", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["embed-text"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects oversized string payload (>10000 chars)", async () => {
      const handler = ipcHandlers["embed-text"];
      const oversizedText = "x".repeat(10001);
      const result = await handler(mockEvent, { text: oversizedText });
      expect(result).toHaveProperty("error");
      expect(result.error).toMatch(/10000/);
    });
  });

  describe("workflow-execute", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["workflow-execute"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects oversized prompt (>10000 chars)", async () => {
      const handler = ipcHandlers["workflow-execute"];
      const oversizedPrompt = "x".repeat(10001);
      const result = await handler(mockEvent, { prompt: oversizedPrompt });
      expect(result).toHaveProperty("error");
    });
  });

  describe("workflow-approve", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["workflow-approve"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });
  });

  describe("workflow-reject", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["workflow-reject"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });
  });

  describe("conversation-history", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["conversation-history"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });
  });

  describe("auth-register", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["auth-register"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects non-string fields", async () => {
      const handler = ipcHandlers["auth-register"];
      const result = await handler(mockEvent, { email: 123, password: "test", fullName: "name" });
      expect(result).toHaveProperty("error");
    });
  });

  describe("auth-login", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["auth-login"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects oversized email (>10000 chars)", async () => {
      const handler = ipcHandlers["auth-login"];
      const result = await handler(mockEvent, { email: "x".repeat(10001), password: "pass" });
      expect(result).toHaveProperty("error");
    });
  });

  describe("token-set", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["token-set"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects non-object credentials", async () => {
      const handler = ipcHandlers["token-set"];
      const result = await handler(mockEvent, { provider: "github", credentials: "not-an-object" });
      expect(result).toHaveProperty("error");
    });
  });

  describe("mcp-call-tool", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["mcp-call-tool"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
    });

    it("rejects non-string server/tool", async () => {
      const handler = ipcHandlers["mcp-call-tool"];
      const result = await handler(mockEvent, { server: 123, tool: "test", params: {} });
      expect(result).toHaveProperty("error");
    });
  });

  describe("google-oauth-start", () => {
    it("returns error object when passed null", async () => {
      const handler = ipcHandlers["google-oauth-start"];
      expect(handler).toBeDefined();
      const result = await handler(mockEvent, null);
      expect(result).toHaveProperty("error");
      expect(result.success).toBe(false);
    });
  });

  describe("open-external", () => {
    it("throws when passed non-string (hardened handler rejects invalid input)", async () => {
      const handler = ipcHandlers["open-external"];
      expect(handler).toBeDefined();
      // Hardened handler throws on invalid input — callers must catch
      await expect(handler(mockEvent, 12345)).rejects.toThrow();
    });

    it("throws on oversized URL (>10000 chars)", async () => {
      const handler = ipcHandlers["open-external"];
      await expect(handler(mockEvent, "https://" + "x".repeat(10000))).rejects.toThrow();
    });

    it("throws on disallowed protocol file://", async () => {
      const handler = ipcHandlers["open-external"];
      await expect(handler(mockEvent, "file:///etc/passwd")).rejects.toThrow("disallowed protocol");
    });

    it("accepts https:// URLs without throwing", async () => {
      const handler = ipcHandlers["open-external"];
      const { shell } = require("electron");
      await expect(handler(mockEvent, "https://github.com")).resolves.not.toThrow();
    });
  });

  describe("set-theme", () => {
    it("rejects invalid theme value", () => {
      const handler = ipcHandlers["set-theme"];
      expect(handler).toBeDefined();
      const result = handler(mockEvent, "invalid-theme");
      expect(result).toHaveProperty("error");
    });
  });

  describe("sync-set-online", () => {
    it("returns error when passed non-boolean", () => {
      const handler = ipcHandlers["sync-set-online"];
      expect(handler).toBeDefined();
      const result = handler(mockEvent, "true");
      expect(result).toHaveProperty("error");
    });
  });
});
