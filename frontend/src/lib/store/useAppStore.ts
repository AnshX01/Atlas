import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface AppState {
  // ── Command Bar ─────────────────────────────────────────────────
  commandBarOpen: boolean;
  setCommandBarOpen: (open: boolean) => void;
  toggleCommandBar: () => void;

  // ── Theme ────────────────────────────────────────────────────────
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // ── Sync Progress ────────────────────────────────────────────────
  syncProgress: string | null; // connector name currently syncing, or null
  setSyncProgress: (progress: string | null) => void;

  // ── Auth ─────────────────────────────────────────────────────────
  accessToken: string | null;
  setAccessToken: (token: string | null) => void;

  // ── WebSocket ────────────────────────────────────────────────────
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  // ── User ─────────────────────────────────────────────────────────
  userId: string | null;
  userEmail: string | null;
  setUser: (id: string, email: string) => void;
  clearUser: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ── Command Bar ───────────────────────────────────────────────
      commandBarOpen: false,
      setCommandBarOpen: (open) => set({ commandBarOpen: open }),
      toggleCommandBar: () => set((s) => ({ commandBarOpen: !s.commandBarOpen })),

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

      // ── Auth ───────────────────────────────────────────────────────
      accessToken: null,
      setAccessToken: (token) => set({ accessToken: token }),

      // ── WebSocket ──────────────────────────────────────────────────
      wsConnected: false,
      setWsConnected: (connected) => set({ wsConnected: connected }),

      // ── User ───────────────────────────────────────────────────────
      userId: null,
      userEmail: null,
      setUser: (id, email) => set({ userId: id, userEmail: email }),
      clearUser: () =>
        set({ userId: null, userEmail: null, accessToken: null }),
    }),
    {
      name: "atlas-app-store",
      // Only persist these fields to localStorage
      partialize: (state) => ({
        theme: state.theme,
        accessToken: state.accessToken,
        userId: state.userId,
        userEmail: state.userEmail,
      }),
    }
  )
);
