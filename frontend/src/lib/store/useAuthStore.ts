import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthUser {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
}

export type UserResponse = AuthUser;

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  isHydrated: boolean;
  isLoading: boolean;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: AuthUser) => void;
  setHydrated: () => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

import { createSelectors } from "./createSelectors";

export const useAuthStoreBase = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isHydrated: false,
      isLoading: false,

      setTokens: (access: string, refresh: string) => {
        set({ accessToken: access, refreshToken: refresh });
      },

      setUser: (user: AuthUser) => set({ user }),

      setHydrated: () => set({ isHydrated: true }),

      setLoading: (loading: boolean) => set({ isLoading: loading }),

      logout: () => {
        // Clear React state FIRST so the UI reflects logged-out immediately.
        // The IPC call is best-effort â€” if it fails, the local session key
        // in SQLite remains, but the renderer is already cleared.
        // On next app start, getCurrentUser() will validate the session token
        // from SQLite and re-hydrate correctly.
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { useChatStoreBase } = require("./useChatStore");
          useChatStoreBase.getState().clearAllConversations();
        } catch {
          // Safe to ignore â€” store may not be initialized in SSR or test environments
        }
        set({ accessToken: null, refreshToken: null, user: null, isLoading: false });
        // Fire IPC best-effort after state is cleared
        if (typeof window !== "undefined" && (window as any).atlasElectron?.localAuth) {
          (window as any).atlasElectron.localAuth.logout().catch((e: unknown) => {
            console.error("[AuthStore] IPC logout failed (session may persist until next launch):", e);
          });
        }
      },
    }),
    {
      name: "atlas-auth-storage",
      version: 1,
      // C-03: Exclude accessToken and refreshToken from localStorage persistence.
      // OAuth tokens in localStorage are accessible to any JS in the page context.
      // Tokens are kept in memory only and re-obtained via Electron localAuth on
      // app restart (the onRehydrateStorage handler re-hydrates the user profile).
      partialize: (state) => ({
        user: state.user,
        // accessToken and refreshToken are intentionally NOT persisted
      }),
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // v0 -> v1: ensure all required fields have defaults
          return {
            ...persistedState,
            accessToken: persistedState.accessToken ?? null,
            refreshToken: persistedState.refreshToken ?? null,
            user: persistedState.user ?? null,
            isHydrated: false,
          };
        }
        return persistedState as AuthState;
      },
            onRehydrateStorage: () => {
        return (_state: any, error: any) => {
          if (error) {
            console.error("[AuthStore] Rehydration error:", error);
          }
          let cancelled = false;
          // Hard deadline: always call setHydrated within 5s even if IPC hangs
          const hardDeadline = setTimeout(() => {
            if (cancelled) return;
            console.warn("[AuthStore] Hard deadline triggered — forcing hydrated state");
            useAuthStoreBase.getState().setHydrated();
          }, 5000);

          setTimeout(async () => {
            if (cancelled) return;
            const store = useAuthStoreBase.getState();
            // In Electron, localStorage wipes across restarts on file://
            // We must re-hydrate the session from SQLite localAuth if available
            if (typeof window !== "undefined" && (window as any).atlasElectron?.localAuth) {
              try {
                // Add per-call timeout so slow IPC doesn't hang forever
                const localUser = await Promise.race([
                  (window as any).atlasElectron.localAuth.getCurrentUser(),
                  new Promise<null>((_, reject) => setTimeout(() => reject(new Error("IPC timeout")), 4000)),
                ]) as any;
                if (cancelled) return; // guard against late arrival after logout
                if (localUser) {
                  store.setUser({ ...localUser, is_active: true, avatar_url: null });
                } else {
                  // Explicitly clear memory if the DB says we are not logged in
                  store.logout();
                }
              } catch (e) {
                console.warn("[AuthStore] Failed to rehydrate from Electron:", e);
              }
            }
            if (!cancelled) {
              clearTimeout(hardDeadline);
              store.setHydrated();
            }
          }, 0);
          // NOTE: Zustand ignores the return value of this inner subscriber.
          // The cancelled flag is a best-effort guard against stale closures.
          return () => {
            cancelled = true;
            clearTimeout(hardDeadline);
          };
        };
      },
    }
  )
);

export const useAuthStore = createSelectors(useAuthStoreBase);


