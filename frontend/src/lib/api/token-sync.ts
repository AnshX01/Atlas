import { apiClient } from './client';
import { useAuthStore } from '@/lib/store/useAuthStore';

export const tokenSyncAPI = {
  /** Download all connector tokens from the server (for device sync) */
  async downloadTokens(): Promise<Record<string, Record<string, string>>> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return {};
    try {
      const { data } = await apiClient.get('/connectors/tokens');
      return data.tokens || {};
    } catch {
      return {};
    }
  },

  /** Upload a connector's credentials to the server */
  async uploadToken(provider: string, credentials: Record<string, string>): Promise<void> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    try {
      await apiClient.put(`/connectors/tokens/${provider}`, { credentials });
    } catch {
      // Silent fail - local tokens still work
    }
  },
};
