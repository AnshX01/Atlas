import { apiClient, withIdempotencyKey } from "./client";

export type ConnectorProvider = "google_workspace" | "github" | "local_fs" | "slack" | "notion" | "jira" | "linear";

export interface ConnectorResponse {
  id: string;
  provider: ConnectorProvider;
  status: string;
  display_name: string | null;
  external_account_id: string | null;
  created_at: string;
}

export interface SyncTriggerResponse {
  task_id: string;
  connector_id: string;
  provider: ConnectorProvider;
  message: string;
}

export const connectorsAPI = {
  async listConnectors(): Promise<ConnectorResponse[]> {
    const { data } = await apiClient.get<ConnectorResponse[]>("/connectors");
    return data;
  },

  async createConnector(provider: ConnectorProvider, displayName?: string): Promise<ConnectorResponse> {
    const { data } = await apiClient.post<ConnectorResponse>(
      "/connectors",
      { provider, display_name: displayName },
    );
    return data;
  },

  async triggerSync(provider: ConnectorProvider): Promise<SyncTriggerResponse> {
    const { data } = await apiClient.post<SyncTriggerResponse>(
      `/connectors/${provider}/sync`,
      {},
      { headers: withIdempotencyKey() },
    );
    return data;
  },

  async initiateOAuth(provider: "google" | "github"): Promise<void> {
    const { data } = await apiClient.get<{ auth_url: string }>(
      `/auth/oauth/${provider}/initiate`
    );
    if (typeof window !== "undefined") {
      window.location.href = data.auth_url;
    }
  },

  async configureLocalFs(watchPaths: string[]): Promise<ConnectorResponse> {
    const { data } = await apiClient.post<ConnectorResponse>(
      '/connectors/local_fs/configure',
      { watch_paths: watchPaths },
    );
    return data;
  },

  async disconnect(provider: ConnectorProvider): Promise<void> {
    await apiClient.delete(`/connectors/${provider}`);
  },
};
