import axios, { type AxiosInstance, type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "@/lib/store/useAuthStore";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Max number of retries for network errors */
const MAX_RETRIES = 2;
/** Base delay in ms for exponential backoff */
const RETRY_BASE_DELAY = 500;

function shouldRetry(error: AxiosError): boolean {
  if (error.response) return false;
  if (error.code === "ECONNABORTED") return true;
  if (error.code === "ERR_NETWORK") return true;
  if (!error.response && error.request) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Axios client pre-configured for the Atlas API.
 * - Injects JWT Bearer token from Zustand store.
 * - On 401, attempts token refresh before logging out.
 * - Retries network errors up to 2 times with exponential backoff.
 * - Timeout: 10s (reduced for desktop app connecting to potentially-down backend).
 */
export const apiClient: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/v1`,
  headers: { "Content-Type": "application/json" },
  timeout: 10_000,
});

// ── Token Refresh Queue ─────────────────────────────────────────────────────
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
}

// ── Request Interceptor: inject auth token ──────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  if (!config.__retryCount) {
    config.__retryCount = 0;
  }
  return config;
});

// ── Response Interceptor: handle 401 + refresh + retry ──────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // ── Network error (backend unreachable): don't logout, just reject ──
    if (!error.response && originalRequest) {
      // Retry network errors with backoff before giving up
      if (shouldRetry(error) && (originalRequest.__retryCount ?? 0) < MAX_RETRIES) {
        originalRequest.__retryCount = (originalRequest.__retryCount ?? 0) + 1;
        const delay = RETRY_BASE_DELAY * Math.pow(2, originalRequest.__retryCount - 1);
        await sleep(delay);
        return apiClient(originalRequest);
      }
      // After retries exhausted, reject without logging out so caller can handle
      return Promise.reject(error);
    }

    // ── Handle 401: attempt token refresh ───────────────────────────
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      const isElectron = typeof window !== "undefined" && Boolean((window as any).atlasElectron);

      // Don't try to refresh if the refresh endpoint itself failed
      if (originalRequest.url?.includes("/auth/refresh")) {
        if (!isElectron) {
          useAuthStore.getState().logout();
        }
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return apiClient(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) {
        isRefreshing = false;
        processQueue(error, null);
        // Only log out in web-only mode if the user was supposedly logged in via backend
        if (!isElectron && useAuthStore.getState().accessToken) {
          useAuthStore.getState().logout();
        }
        return Promise.reject(error);
      }

      try {
        // Use a raw axios call to bypass our interceptors
        const { data } = await axios.post(`${BASE_URL}/v1/auth/refresh`, {
          refresh_token: refreshToken,
        });

        const newAccessToken = data.access_token;
        const newRefreshToken = data.refresh_token ?? refreshToken;

        useAuthStore.getState().setTokens(newAccessToken, newRefreshToken);
        isRefreshing = false;
        processQueue(null, newAccessToken);

        // Retry the original request with new token
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        processQueue(refreshError, null);
        if (!isElectron) {
          useAuthStore.getState().logout();
        }
        return Promise.reject(refreshError);
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

// ── Augment AxiosRequestConfig to include retry metadata ────────────────────
declare module "axios" {
  interface InternalAxiosRequestConfig {
    __retryCount?: number;
  }
}
