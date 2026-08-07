/**
 * Atlas — Connectors API (local-first).
 * In desktop mode, reads configured status from local token store.
 * Falls back to backend API in dev mode.
 */

import { apiClient } from "./client";

export type ConnectorProvider = "google_workspace" | "github" | "local_fs" | "slack" | "notion" | "jira" | "linear";

export interface ConnectorResponse {
  id: string;
  provider: ConnectorProvider;
  status: string;
  display_name: string | null;
  external_account_id: string | null;
  created_at: string;
}

export const connectorsAPI = {
  async listConnectors(): Promise<ConnectorResponse[]> {
    // Try local Electron token store first
    if (typeof window !== "undefined" && window.atlasElectron?.tokenStore) {
      try {
        const configured = await window.atlasElectron.tokenStore.listConfigured();
        return configured.map((provider) => ({
          id: provider,
          provider: provider as ConnectorProvider,
          status: "active",
          display_name: null,
          external_account_id: null,
          created_at: new Date().toISOString(),
        }));
      } catch {
        // Fall through to API
      }
    }

    // Fallback: try backend API (dev mode)
    try {
      const { data } = await apiClient.get<ConnectorResponse[]>("/connectors");
      return data;
    } catch {
      return [];
    }
  },
};
