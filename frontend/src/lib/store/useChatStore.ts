import { create } from "zustand";
import { persist } from "zustand/middleware";
import { conversationSyncAPI } from "../api/conversation-sync";

// ── Shared Types (exported for use in chat page) ────────────────────────────

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  source: string;
  score: number;
  url?: string;
  timestamp: string;
}

export interface ActionSuggestion {
  id: string;
  type: string;
  label: string;
  preview: string;
  status: "pending" | "approved" | "rejected";
}

export interface ToolExecution {
  id: string;
  server: string;
  tool: string;
  status: "executing" | "done" | "failed";
  errorMessage?: string;
}

export interface DraftData {
  executionId: string;
  actionType: string;
  fields: Record<string, string>;
  status: "generating" | "pending" | "approved" | "rejected" | "executing" | "done" | "failed";
  errorMessage?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  results?: SearchResult[];
  actions?: ActionSuggestion[];
  toolExecutions?: ToolExecution[];
  draft?: DraftData;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  lastMessage: string;
}

interface ChatState {
  // ── Conversations ───────────────────────────────────────────────
  conversations: Conversation[];
  activeConversationId: string | null;

  // ── Messages (in-memory, keyed by conversation id) ──────────────
  messages: Record<string, ChatMessage[]>;

  // ── Actions ─────────────────────────────────────────────────────
  addConversation: (title: string) => string;
  removeConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  updateConversationTitle: (id: string, title: string) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  clearMessages: (conversationId: string) => void;
}

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};

/** Fire-and-forget background sync to cloud backend */
function backgroundSync(conversationId: string, getState: () => ChatState): void {
  // Debounce: wait 1s after last change before syncing per conversation
  if (syncTimers[conversationId]) clearTimeout(syncTimers[conversationId]);
  syncTimers[conversationId] = setTimeout(() => {
    const state = getState();
    const conv = state.conversations.find((c) => c.id === conversationId);
    if (!conv) {
      delete syncTimers[conversationId];
      return;
    }
    const messages = (state.messages[conversationId] || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      results: m.results,
      actions: m.actions,
      toolExecutions: m.toolExecutions,
      draft: m.draft,
    }));
    conversationSyncAPI.syncConversation({
      id: conv.id,
      title: conv.title,
      last_message: conv.lastMessage,
      messages,
    }).catch(err => {
      console.error("Background sync error:", err);
    }).finally(() => {
      delete syncTimers[conversationId];
    });
  }, 1000);
}

/** Shallow JSON comparison — safe against circular references */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // ── State ───────────────────────────────────────────────────────
      conversations: [],
      activeConversationId: null,
      messages: {},

      // ── Actions ─────────────────────────────────────────────────────
      addConversation: (title: string) => {
        const id = generateId();
        const conversation: Conversation = {
          id,
          title,
          createdAt: new Date().toISOString(),
          lastMessage: "",
        };
        set((state) => {
          const conversations = [conversation, ...state.conversations].slice(0, 50);
          // Prune orphan message arrays for conversations that were sliced off
          const activeIds = new Set(conversations.map((c) => c.id));
          const messages: Record<string, ChatMessage[]> = { [id]: [] };
          for (const cid of Object.keys(state.messages)) {
            if (activeIds.has(cid)) {
              messages[cid] = state.messages[cid];
            }
          }
          return {
            conversations,
            activeConversationId: id,
            messages,
          };
        });
        backgroundSync(id, get);
        return id;
      },

      removeConversation: (id: string) => {
        // Clean up any pending sync timer for this conversation
        if (syncTimers[id]) {
          clearTimeout(syncTimers[id]);
          delete syncTimers[id];
        }
        set((state) => {
          const { [id]: _, ...restMessages } = state.messages;
          return {
            conversations: state.conversations.filter((c) => c.id !== id),
            activeConversationId:
              state.activeConversationId === id ? null : state.activeConversationId,
            messages: restMessages,
          };
        });
      },

      setActiveConversation: (id: string | null) => {
        set({ activeConversationId: id });
      },

      updateConversationTitle: (id: string, title: string) => {
        set((state) => {
          const conv = state.conversations.find((c) => c.id === id);
          if (conv && conv.title === title) return state;
          
          return {
            conversations: state.conversations.map((c) =>
              c.id === id ? { ...c, title } : c
            ),
          };
        });
      },

      addMessage: (conversationId: string, message: ChatMessage) => {
        set((state) => {
          const existing = state.messages[conversationId] || [];
          const index = existing.findIndex((m) => m.id === message.id);

          if (index !== -1) {
            if (deepEqual(existing[index], message)) {
              return state;
            }
            const updatedMessages = [...existing];
            updatedMessages[index] = message;

            const updatedConversations = state.conversations.map((c) =>
              c.id === conversationId
                ? { ...c, lastMessage: message.content.slice(0, 100) }
                : c
            );
            return {
              messages: { ...state.messages, [conversationId]: updatedMessages },
              conversations: updatedConversations,
            };
          }

          const updatedConversations = state.conversations.map((c) =>
            c.id === conversationId
              ? { ...c, lastMessage: message.content.slice(0, 100) }
              : c
          );
          return {
            messages: { ...state.messages, [conversationId]: [...existing, message] },
            conversations: updatedConversations,
          };
        });
        backgroundSync(conversationId, get);
      },

      clearMessages: (conversationId: string) => {
        set((state) => ({
          messages: { ...state.messages, [conversationId]: [] },
        }));
      },
    }),
    {
      name: "atlas-conversations",
      // Persist conversations list and messages (including card data) to localStorage
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        messages: state.messages,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Rehydration error:", error);
        }
      },
    }
  )
);
