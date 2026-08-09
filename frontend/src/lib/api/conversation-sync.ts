import { apiClient } from './client';

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
    try {
      await apiClient.post('/conversations', conversation);
    } catch {
      /* silent — sync is best-effort */
    }
  },

  async getMessages(conversationId: string): Promise<SyncedMessage[]> {
    try {
      const { data } = await apiClient.get(`/conversations/${conversationId}/messages`);
      return data;
    } catch {
      return [];
    }
  },
};
