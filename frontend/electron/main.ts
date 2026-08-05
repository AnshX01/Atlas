import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme,
  shell,
} from "electron";
import * as path from "path";

const isDev = process.env.NODE_ENV === "development";
const NEXT_URL = "http://localhost:3000";
const PROD_INDEX = path.join(__dirname, "../out/index.html");

let mainWindow: BrowserWindow | null = null;

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
app.whenReady().then(() => {
  mainWindow = createWindow();

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
