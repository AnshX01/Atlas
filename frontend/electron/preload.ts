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

  /**
   * Subscribe to the global Cmd+Space command bar toggle event.
   * Returns an unsubscribe function.
   */
  onToggleCommandBar: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("toggle-command-bar", handler);
    return () => ipcRenderer.removeListener("toggle-command-bar", handler);
  },
});

// TypeScript global declaration (used in renderer)
export type AtlasElectronAPI = {
  getPlatform: () => Promise<string>;
  getAppVersion: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  setTheme: (theme: "dark" | "light") => Promise<void>;
  selectDirectory: () => Promise<string[]>;
  onToggleCommandBar: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    atlasElectron?: AtlasElectronAPI;
  }
}
