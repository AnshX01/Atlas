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
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: AuthUser) => void;
  setHydrated: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isHydrated: false,

      setTokens: (access, refresh) => {
        set({ accessToken: access, refreshToken: refresh });
      },

      setUser: (user) => set({ user }),

      setHydrated: () => set({ isHydrated: true }),

      logout: () => {
        set({ accessToken: null, refreshToken: null, user: null });
        if (typeof window !== "undefined") {
          window.location.href = "/login";
        }
      },
    }),
    {
      name: "atlas-auth-storage",
      onRehydrateStorage: () => {
        return () => {
          setTimeout(async () => {
            const store = useAuthStore.getState();
            // In Electron, localStorage wipes across restarts on file://
            // We must re-hydrate the session from SQLite localAuth if available
            if (typeof window !== "undefined" && (window as any).atlasElectron?.localAuth) {
              try {
                const localUser = await (window as any).atlasElectron.localAuth.getCurrentUser();
                if (localUser) {
                  store.setUser({ ...localUser, is_active: true, avatar_url: null });
                } else {
                  // Explicitly clear memory if the DB says we aren't logged in
                  store.logout();
                }
              } catch (e) {
                console.warn("[AuthStore] Failed to rehydrate from Electron:", e);
              }
            }
            store.setHydrated();
          }, 0);
        };
      },
    }
  )
);
