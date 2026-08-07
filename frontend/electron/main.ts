import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import * as path from "path";
import { MCPServerManager } from "./services/mcp-manager";
import {
  checkOllamaHealth,
  getHealthStatus,
  getAvailableModels,
  streamChat,
  generateEmbedding,
} from "./services/ollama";
import { Orchestrator } from "./services/orchestrator";
import {
  initDB,
  closeDB,
  listConversations,
  getConversationHistory,
} from "./services/local-store";
import {
  initAuthTables,
  register as authRegister,
  login as authLogin,
  logout as authLogout,
  getCurrentUser as authGetCurrentUser,
  updateProfile as authUpdateProfile,
} from "./services/local-auth";
import {
  getToken,
  setToken,
  removeToken,
  listConfigured,
  ProviderName,
  ProviderCredentials,
} from "./services/token-store";

const isDev = process.env.NODE_ENV === "development";
const NEXT_URL = "http://localhost:3000";
const PROD_INDEX = path.join(__dirname, "../out/index.html");

let mainWindow: BrowserWindow | null = null;

// ── MCP Server Manager ─────────────────────────────────────────────────────────
let mcpManager: MCPServerManager | null = null;

// ── Orchestrator (LangGraph-style local state machine) ─────────────────────────
let orchestrator: Orchestrator | null = null;

// ── Window factory ─────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",     // macOS native title bar
    vibrancy: "under-window",         // macOS vibrancy / blur effect
    visualEffectState: "active",
    backgroundColor: "#09090b",       // Match --bg-primary dark
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load Next.js dev server or production export
  if (isDev) {
    win.loadURL(NEXT_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(PROD_INDEX);
  }

  // Open external links in the default OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  mainWindow = createWindow();

  // ── Ollama health check on startup ──────────────────────────────────
  const ollamaRunning = await checkOllamaHealth();
  if (ollamaRunning) {
    console.log("[Atlas] Ollama available — local AI features enabled");
  } else {
    console.log("[Atlas] Ollama not found — AI features will use cloud fallback");
  }

  // ── Initialize MCP Server Manager ───────────────────────────────────
  // Don't auto-start servers — user configures which ones to enable via settings.
  mcpManager = new MCPServerManager();
  console.log("[Atlas] MCP Server Manager initialized (servers will start on user request)");

  // ── Initialize Local Store (SQLite) ─────────────────────────────────
  initDB();
  console.log("[Atlas] Local store (SQLite) initialized");

  // ── Initialize Auth Tables ──────────────────────────────────────────
  initAuthTables();
  console.log("[Atlas] Local auth tables initialized");

  // ── Initialize Orchestrator ─────────────────────────────────────────
  orchestrator = new Orchestrator(mcpManager);
  console.log("[Atlas] Orchestrator (local LangGraph engine) initialized");

  // ── Global shortcut: Cmd+Space → Toggle command bar ─────────────────
  // Sent to the renderer via IPC so the React store handles it.
  const registered = globalShortcut.register("CommandOrControl+Space", () => {
    if (!mainWindow) return;

    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      // Window is focused — toggle command bar inside the app
      mainWindow.webContents.send("toggle-command-bar");
    } else {
      // Window not visible — bring it to front
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("toggle-command-bar");
    }
  });

  if (!registered) {
    console.warn("Could not register global shortcut Cmd+Space — may be taken by another app.");
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

// macOS: keep app running when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();

  // Close local SQLite database
  closeDB();

  // Gracefully stop all MCP server subprocesses
  if (mcpManager) {
    mcpManager.stopAll().catch((err) => {
      console.error("[Atlas] Error stopping MCP servers on quit:", err);
    });
  }
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────
ipcMain.handle("get-platform", () => process.platform);

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("open-external", (_event, url: string) => {
  shell.openExternal(url);
});

ipcMain.handle("set-theme", (_event, theme: "dark" | "light") => {
  nativeTheme.themeSource = theme;
});

// Local file system access (for LocalFSConnector path selection)
ipcMain.handle("select-directory", async () => {
  const { dialog } = await import("electron");
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"],
    title: "Select directories for Atlas to watch",
  });
  return result.filePaths;
});

// ── Ollama AI IPC Handlers ────────────────────────────────────────────────────

ipcMain.handle("ollama-health", async () => {
  return getHealthStatus();
});

ipcMain.handle("ollama-models", async () => {
  return getAvailableModels();
});

ipcMain.handle(
  "chat-send",
  async (_event, { messages, model }: { messages: Array<{ role: string; content: string }>; model?: string }) => {
    if (!mainWindow) {
      throw new Error("No main window available");
    }

    try {
      for await (const token of streamChat(messages, model)) {
        mainWindow.webContents.send("chat-stream", token);
      }
      mainWindow.webContents.send("chat-stream-end");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown streaming error";
      mainWindow.webContents.send("chat-stream-end", { error: errorMessage });
      throw error;
    }
  }
);

ipcMain.handle(
  "embed-text",
  async (_event, { text, model }: { text: string; model?: string }) => {
    return generateEmbedding(text, model);
  }
);


// ── MCP Server IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle("mcp-status", () => {
  if (!mcpManager) {
    return [];
  }
  return mcpManager.getStatus();
});

ipcMain.handle("mcp-start", async (_event, serverName: string) => {
  if (!mcpManager) {
    throw new Error("MCP Manager not initialized");
  }
  await mcpManager.startServer(serverName);
});

ipcMain.handle("mcp-stop", async (_event, serverName: string) => {
  if (!mcpManager) {
    throw new Error("MCP Manager not initialized");
  }
  await mcpManager.stopServer(serverName);
});

ipcMain.handle(
  "mcp-call-tool",
  async (
    _event,
    { server, tool, params }: { server: string; tool: string; params: Record<string, unknown> }
  ) => {
    if (!mcpManager) {
      throw new Error("MCP Manager not initialized");
    }
    return mcpManager.sendToolCall(server, tool, params);
  }
);

ipcMain.handle("mcp-list-tools", async (_event, serverName: string) => {
  if (!mcpManager) {
    throw new Error("MCP Manager not initialized");
  }
  return mcpManager.listTools(serverName);
});

// ── Orchestrator Workflow IPC Handlers ────────────────────────────────────────

ipcMain.handle(
  "workflow-execute",
  async (
    _event,
    { prompt, conversationId }: { prompt: string; conversationId?: string }
  ) => {
    if (!orchestrator) {
      throw new Error("Orchestrator not initialized");
    }
    if (!mainWindow) {
      throw new Error("No main window available");
    }

    // Run asynchronously — events stream back via webContents.send
    orchestrator.execute(prompt, mainWindow, conversationId).catch((err) => {
      console.error("[Atlas] Orchestrator execution error:", err);
      mainWindow?.webContents.send("workflow-complete", {
        error: err instanceof Error ? err.message : "Unknown error",
      });
    });

    // Return immediately — results come via events
    return { status: "started" };
  }
);

ipcMain.handle(
  "workflow-approve",
  async (_event, { executionId }: { executionId: string }) => {
    if (!orchestrator) {
      throw new Error("Orchestrator not initialized");
    }
    const success = orchestrator.approve(executionId);
    if (!success) {
      throw new Error(`No pending approval found for execution: ${executionId}`);
    }
    return { approved: true };
  }
);

ipcMain.handle(
  "workflow-reject",
  async (_event, { executionId }: { executionId: string }) => {
    if (!orchestrator) {
      throw new Error("Orchestrator not initialized");
    }
    const success = orchestrator.reject(executionId);
    if (!success) {
      throw new Error(`No pending approval found for execution: ${executionId}`);
    }
    return { rejected: true };
  }
);

// ── Conversation IPC Handlers ─────────────────────────────────────────────────

ipcMain.handle("conversations-list", async () => {
  return listConversations();
});

ipcMain.handle(
  "conversation-history",
  async (_event, { id, limit }: { id: string; limit?: number }) => {
    return getConversationHistory(id, limit);
  }
);

// ── Local Auth IPC Handlers ───────────────────────────────────────────────────

ipcMain.handle(
  "auth-register",
  async (
    _event,
    { email, password, fullName }: { email: string; password: string; fullName: string }
  ) => {
    return authRegister(email, password, fullName);
  }
);

ipcMain.handle(
  "auth-login",
  async (_event, { email, password }: { email: string; password: string }) => {
    return authLogin(email, password);
  }
);

ipcMain.handle("auth-logout", async () => {
  authLogout();
});

ipcMain.handle("auth-current-user", async () => {
  return authGetCurrentUser();
});

ipcMain.handle(
  "auth-update-profile",
  async (
    _event,
    data: { email?: string; full_name?: string; password?: string }
  ) => {
    return authUpdateProfile(data);
  }
);

// ── Token Store IPC Handlers ──────────────────────────────────────────────────

ipcMain.handle("token-get", async (_event, provider: ProviderName) => {
  return getToken(provider);
});

ipcMain.handle(
  "token-set",
  async (
    _event,
    { provider, credentials }: { provider: ProviderName; credentials: ProviderCredentials }
  ) => {
    setToken(provider, credentials);
  }
);

ipcMain.handle("token-remove", async (_event, provider: ProviderName) => {
  removeToken(provider);
});

ipcMain.handle("token-list-configured", async () => {
  return listConfigured();
});
