import axios, { type AxiosInstance, type AxiosError } from "axios";
import { useAppStore } from "@/lib/store/useAppStore";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * Axios client pre-configured for the Atlas API.
 * - Automatically injects JWT Bearer token from Zustand store.
 * - Handles 401 → clears auth and redirects to login.
 * - All requests are JSON.
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/v1`,
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 30_000,
});

// ── Request Interceptor: inject auth token ──────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAppStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Response Interceptor: handle 401 ───────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      // Token expired — clear auth state
      useAppStore.getState().clearUser();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

/** Helper to add an Idempotency-Key header (required on all POST mutations) */
export function withIdempotencyKey(headers?: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    "Idempotency-Key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}
