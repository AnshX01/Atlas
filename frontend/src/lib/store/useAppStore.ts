import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface AppState {
  // ── Command Bar ─────────────────────────────────────────────────
  commandBarOpen: boolean;
  setCommandBarOpen: (open: boolean) => void;
  toggleCommandBar: () => void;

  // ── Window Layout ────────────────────────────────────────────────
  isMaximized: boolean;
  setIsMaximized: (maximized: boolean) => void;

  // ── Theme ────────────────────────────────────────────────────────
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // ── Sync Progress ────────────────────────────────────────────────
  syncProgress: string | null; // connector name currently syncing, or null
  setSyncProgress: (progress: string | null) => void;

  // ── WebSocket ────────────────────────────────────────────────────
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;
}

import { createSelectors } from "./createSelectors";

export const useAppStoreBase = create<AppState>()(
  persist(
    (set, get) => ({
      // ── Command Bar ───────────────────────────────────────────────
      commandBarOpen: false,
      setCommandBarOpen: (open) => set({ commandBarOpen: open }),
      toggleCommandBar: () => set((s) => ({ commandBarOpen: !s.commandBarOpen })),

      // ── Window Layout ──────────────────────────────────────────────
      isMaximized: false,
      setIsMaximized: (isMaximized) => set({ isMaximized }),

      // ── Theme ──────────────────────────────────────────────────────
      theme: "dark",
      setTheme: (theme) => {
        set({ theme });
        // Sync to DOM for CSS variable switching
        if (typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", theme === "dark");
        }
      },
      toggleTheme: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        get().setTheme(next);
      },

      // ── Sync Progress ──────────────────────────────────────────────
      syncProgress: null,
      setSyncProgress: (progress) => set({ syncProgress: progress }),

      // ── WebSocket ──────────────────────────────────────────────────
      wsConnected: false,
      setWsConnected: (connected) => set({ wsConnected: connected }),
    }),
    {
      name: "atlas-app-store",
      version: 1,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // v0 → v1: ensure theme has a valid default
          return {
            ...persistedState,
            theme: persistedState.theme ?? "dark",
          };
        }
        return persistedState as Pick<AppState, "theme">;
      },
      // Only persist these fields to localStorage
      partialize: (state) => ({
        theme: state.theme,
      }),
      onRehydrateStorage: () => (state) => {
        // Sync DOM dark class on rehydration so CSS variables apply immediately
        if (state && typeof document !== "undefined") {
          document.documentElement.classList.toggle("dark", state.theme === "dark");
        }
      },
    }
  )
);

export const useAppStore = createSelectors(useAppStoreBase);
