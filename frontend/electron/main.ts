import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme,
  shell,
  session,
  Tray,
  Tray,
  Menu,
  dialog,
} from "electron";
import * as path from "path";
import { MCPServerManager } from "./services/mcp-manager";
import { CronEngine } from "./services/background-cron";
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
import { parseFile } from "./services/file-parser";
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
import { startGoogleOAuth, handleOAuthCallback, hasPendingOAuth, setOAuthRedirectPort } from "./services/google-oauth";
import * as http from "http";
import serve from "electron-serve";

const isDev = !app.isPackaged;
const NEXT_URL = "http://localhost:3000";
const loadProd = serve({ directory: path.join(__dirname, "../out") });

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

app.on("before-quit", () => {
  isQuitting = true;
});

// ── MCP Server Manager ─────────────────────────────────────────────────────────
let mcpManager: MCPServerManager | null = null;

// ── Orchestrator (LangGraph-style local state machine) ─────────────────────────
let orchestrator: Orchestrator | null = null;

// ── Background Cron Trigger ────────────────────────────────────────────────────
let cronEngine: CronEngine | null = null;

// ── Window factory ─────────────────────────────────────────────────────────────
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    // titleBarStyle: "hidden",          // macOS native title bar
    frame: true,
    alwaysOnTop: false,               // Do not force always on top for normal app feel
    transparent: false,
    backgroundColor: "#09090b",       // Dark mode match
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
    loadProd(win);
  }

  // Open external links in the default OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
      return false;
    }
    return true;
  });

  return win;
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Automatically grant permissions for media/microphone
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow = createWindow();
  Menu.setApplicationMenu(null);

  // OS Auto-start
  app.setLoginItemSettings({
    openAtLogin: false,
    openAsHidden: true,
  });

  // Force dark mode to sync title bar
  nativeTheme.themeSource = 'dark';

  const iconPath = path.join(__dirname, "../public/icon.png");
  tray = new Tray(iconPath);
  tray.setToolTip("Atlas");
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Atlas",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  // ── Ollama health check on startup ──────────────────────────────────
  const ollamaRunning = await checkOllamaHealth();
  if (ollamaRunning) {
    console.log("[Atlas] Ollama available — local AI features enabled");
  } else {
    console.log("[Atlas] Ollama not found — AI features will use cloud fallback");
  }

  // ── Initialize MCP Server Manager ───────────────────────────────────
  mcpManager = new MCPServerManager();
  // Pre-warm configured servers in the background
  mcpManager.startAll().catch(console.error);

  // ── Background Cron Trigger ─────────────────────────────────────────
  cronEngine = new CronEngine(mcpManager);
  cronEngine.start();

  // ── Initialize Local Store (SQLite) ─────────────────────────────────
  await initDB();
  console.log("[Atlas] Local store (SQLite) initialized");

  // ── Initialize Auth Tables ──────────────────────────────────────────
  await initAuthTables();
  console.log("[Atlas] Local auth tables initialized");

  // ── Initialize Orchestrator ─────────────────────────────────────────
  orchestrator = new Orchestrator(mcpManager);
  console.log("[Atlas] Orchestrator (local LangGraph engine) initialized");

  // ── OAuth Callback Server ───────────────────────────────────────────
  // Listens on localhost for OAuth redirects from the system browser.
  // Tries ports 19876, 19877, 19878 in sequence if port is already in use.
  const oauthServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    
    if (url.pathname === "/oauth-callback" || url.pathname === "/oauth/callback") {
      const accessToken = url.searchParams.get("access_token");
      const refreshToken = url.searchParams.get("refresh_token");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

      // ── Connector OAuth callback (has authorization code + state=connector_oauth) ──
      if (code && state === "connector_oauth" && hasPendingOAuth()) {
        try {
          await handleOAuthCallback(code);
          res.end(`<html><head><meta charset="utf-8"></head><body style="background:#09090b;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connected successfully</h2><p style="color:#aaa">You can safely close this tab or it will close automatically.</p></div><script>setTimeout(()=>window.close(), 2000);</script></body></html>`);
          if (mainWindow) {
            mainWindow.webContents.send("connector-oauth-success", { provider: "google_workspace" });
            mainWindow.show();
            mainWindow.focus();
          }
        } catch (err: any) {
          const errorMsg = err?.message || "OAuth failed";
          res.end(`<html><head><meta charset="utf-8"></head><body style="background:#09090b;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Connection failed</h2><p style="color:#aaa">${errorMsg}</p><p style="color:#666;font-size:12px;margin-top:16px">Close this tab and try again in Atlas.</p></div></body></html>`);
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
        return;
      }

      // ── Login OAuth callback (has access_token + refresh_token from backend) ──
      if (accessToken && refreshToken) {
        res.end(`<html><head><meta charset="utf-8"></head><body style="background:#09090b;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Signed in successfully</h2><p style="color:#aaa">You can safely close this tab or it will close automatically.</p></div><script>setTimeout(()=>window.close(), 2000);</script></body></html>`);
        if (mainWindow) {
          mainWindow.webContents.send("oauth-callback", { access_token: accessToken, refresh_token: refreshToken });
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        // Error case
        const errorMsg = error || "Unknown error";
        console.error("[Atlas OAuth] Failed:", errorMsg);
        res.end(`<html><head><meta charset="utf-8"></head><body style="background:#09090b;color:white;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Sign in failed</h2><p style="color:#aaa">${errorMsg}</p><p style="color:#666;font-size:12px;margin-top:16px">Close this tab and try again in Atlas.</p></div></body></html>`);
        if (mainWindow) {
          mainWindow.webContents.send("oauth-callback", { error: errorMsg });
          mainWindow.show();
          mainWindow.focus();
        }
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  // Try ports 19876, 19877, 19878 with fallback
  const OAUTH_PORTS = [19876, 19877, 19878];
  let activeOAuthPort = OAUTH_PORTS[0];

  function tryListenOAuth(portIndex: number): void {
    if (portIndex >= OAUTH_PORTS.length) {
      console.warn("[Atlas] OAuth callback server failed to bind on any port (19876-19878)");
      return;
    }
    const port = OAUTH_PORTS[portIndex];
    oauthServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[Atlas] OAuth port ${port} in use, trying next...`);
        tryListenOAuth(portIndex + 1);
      } else {
        console.warn("[Atlas] OAuth callback server failed to start:", err.message);
      }
    });
    oauthServer.listen(port, "127.0.0.1", () => {
      activeOAuthPort = port;
      setOAuthRedirectPort(port);
      console.log(`[Atlas] OAuth callback server listening on http://localhost:${port}`);
    });
  }
  tryListenOAuth(0);

  ipcMain.handle("get-oauth-port", () => {
    return activeOAuthPort;
  });

  // ── Global shortcut: Alt+Space → Show and focus app ─────────────────
  const registered = globalShortcut.register("Alt+Space", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });

  if (!registered) {
    console.warn("Could not register global shortcut Alt+Space — may be taken by another app.");
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
  } catch (err) {
    console.error("[Atlas] FATAL: App initialization failed:", err);
  }
});

// keep app running when all windows are closed
app.on("window-all-closed", () => {
  // Prevent default quit, we have a tray icon
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();

  // Close local SQLite database
  closeDB();

  if (cronEngine) cronEngine.stop();

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

ipcMain.handle("open-external", async (_event, url: string) => {
  await shell.openExternal(url);
});

ipcMain.handle("set-theme", (_event, theme: "dark" | "light") => {
  nativeTheme.themeSource = theme;
});

ipcMain.handle("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle("window-maximize", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle("window-close", () => {
  if (mainWindow) mainWindow.close();
});

// Local file system access (for LocalFSConnector path selection)
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"],
    title: "Select directories for Atlas to watch",
  });
  return result.filePaths;
});

// Parse local file (extract text or base64 image)
ipcMain.handle("parse-file", async (_event, filePath: string) => {
  return parseFile(filePath);
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
      try { mainWindow?.webContents.send("chat-stream-end", { error: errorMessage }); } catch {}
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

/**
 * workflow-abort: Signal from renderer that the user wants to stop the current workflow.
 * NOTE: Full backend abort would require orchestrator.ts changes (access to its internal
 * AbortController). This handler acknowledges the abort intent; the renderer is responsible
 * for unsubscribing its own IPC listeners to ignore further events from a still-running workflow.
 */
ipcMain.handle("workflow-abort", async (_event, payload?: { conversationId: string }) => {
  if (orchestrator) {
    if (payload?.conversationId) {
      orchestrator.abortWorkflow(payload.conversationId);
    } else {
      orchestrator.abortAll();
    }
  }
  return { aborted: true };
});

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

// ── Google OAuth IPC Handler ──────────────────────────────────────────────────

ipcMain.handle('google-oauth-start', async (_event, { clientId, clientSecret }: { clientId: string; clientSecret: string }) => {
  try {
    const tokens = await startGoogleOAuth(clientId, clientSecret);
    return { success: true, tokens };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});
