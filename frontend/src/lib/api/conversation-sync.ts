import { apiClient } from './client';
import { useAuthStore } from '@/lib/store/useAuthStore';

export interface SyncedConversation {
  id: string;
  title: string;
  created_at: string;
  last_message: string;
}

export interface SyncedMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  results?: any[];
  actions?: any[];
  toolExecutions?: any[];
  draft?: any;
}

export const conversationSyncAPI = {
  async listConversations(): Promise<SyncedConversation[]> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return [];
    try {
      const { data } = await apiClient.get('/conversations');
      return data;
    } catch {
      return [];
    }
  },

  async syncConversation(conversation: {
    id: string;
    title: string;
    last_message: string;
    messages: Array<{ id: string; role: string; content: string; timestamp: string; results?: any[]; actions?: any[]; toolExecutions?: any[]; draft?: any }>;
  }): Promise<void> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    try {
      await apiClient.post('/conversations', conversation);
    } catch {
      /* silent — sync is best-effort */
    }
  },

  async getMessages(conversationId: string): Promise<SyncedMessage[]> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return [];
    try {
      const { data } = await apiClient.get(`/conversations/${conversationId}/messages`);
      return data;
    } catch {
      return [];
    }
  },

  async deleteConversation(conversationId: string): Promise<void> {
    const token = useAuthStore.getState().accessToken;
    if (!token) return;
    try {
      await apiClient.delete(`/conversations/${conversationId}`);
    } catch {
      /* silent — deletion on cloud is best-effort */
    }
  },
};
