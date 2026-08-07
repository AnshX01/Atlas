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

// Re-export as UserResponse for backward compatibility with existing imports
export type UserResponse = AuthUser;

interface AuthState {
  /** @deprecated Kept for API client fallback in dev mode. Null in Electron. */
  accessToken: string | null;
  /** @deprecated Kept for API client fallback in dev mode. Null in Electron. */
  refreshToken: string | null;
  user: AuthUser | null;
  isHydrated: boolean;
  /** @deprecated Use setUser directly. Kept for API client compatibility. */
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: AuthUser) => void;
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
        return (state) => {
          if (state) {
            state.isHydrated = true;
          }
        };
      },
    }
  )
);
