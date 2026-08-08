/**
 * Atlas — Connectors API (local-first).
 * In desktop mode, reads configured status from local token store or localStorage.
 */

export type ConnectorProvider = "google_workspace" | "github" | "local_fs" | "slack" | "notion" | "jira" | "linear";

export interface ConnectorResponse {
  id: string;
  provider: ConnectorProvider;
  status: string;
  display_name: string | null;
  external_account_id: string | null;
  created_at: string;
}

const CONNECTOR_IDS: ConnectorProvider[] = ["google_workspace", "github", "slack", "notion", "local_fs"];

export const connectorsAPI = {
  async listConnectors(): Promise<ConnectorResponse[]> {
    const configuredSet = new Set<ConnectorProvider>();

    // In Electron: use ONLY the token store (source of truth)
    if (typeof window !== "undefined" && window.atlasElectron?.tokenStore) {
      try {
        const configured = await window.atlasElectron.tokenStore.listConfigured();
        for (const provider of configured) {
          if (CONNECTOR_IDS.includes(provider as ConnectorProvider)) {
            configuredSet.add(provider as ConnectorProvider);
          }
        }
      } catch {
        // Fall through to localStorage check
      }

      // If we successfully checked the token store, return immediately
      // Don't mix in stale localStorage data
      return Array.from(configuredSet).map((id) => ({
        id,
        provider: id,
        status: "active",
        display_name: null,
        external_account_id: null,
        created_at: new Date().toISOString(),
      }));
    }

    // Browser-only fallback: check localStorage
    if (typeof window !== "undefined") {
      for (const id of CONNECTOR_IDS) {
        const stored = localStorage.getItem(`atlas_connector_${id}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            const hasValue = Object.values(parsed).some((v) => v && String(v).trim());
            if (hasValue) {
              configuredSet.add(id);
            }
          } catch {}
        }
      }
    }

    return Array.from(configuredSet).map((id) => ({
      id,
      provider: id,
      status: "active",
      display_name: null,
      external_account_id: null,
      created_at: new Date().toISOString(),
    }));
  },
};
