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
  clearAllConversations: () => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `conv_${crypto.randomUUID()}`;
  }
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

const syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// Circuit breaker state per conversation: tracks consecutive failures.
// After MAX_SYNC_FAILURES the circuit trips open and sync is suspended.
const syncFailureCounts: Record<string, number> = {};
const syncBackoffDelays: Record<string, number> = {};
const MAX_SYNC_FAILURES = 5;
const SYNC_BASE_DELAY_MS = 1000;
const SYNC_MAX_DELAY_MS = 30_000;

/** Fire-and-forget background sync to cloud backend with circuit breaker + exponential backoff */
function backgroundSync(conversationId: string, getState: () => ChatState): void {
  // Circuit breaker: if this conversation has failed too many times, stop trying
  if ((syncFailureCounts[conversationId] ?? 0) >= MAX_SYNC_FAILURES) return;

  const delay = syncBackoffDelays[conversationId] ?? SYNC_BASE_DELAY_MS;

  // Debounce: wait for `delay` after last change before syncing per conversation
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
    }).then(() => {
      // Success: reset circuit breaker for this conversation
      delete syncFailureCounts[conversationId];
      delete syncBackoffDelays[conversationId];
    }).catch(err => {
      console.error("Background sync error:", err);
      // Increment failure count and apply exponential backoff
      const failures = (syncFailureCounts[conversationId] ?? 0) + 1;
      syncFailureCounts[conversationId] = failures;
      syncBackoffDelays[conversationId] = Math.min(delay * 2, SYNC_MAX_DELAY_MS);
      if (failures >= MAX_SYNC_FAILURES) {
        console.warn(`[SyncManager] Circuit breaker tripped for conversation ${conversationId} after ${failures} failures. Sync suspended.`);
      }
    }).finally(() => {
      delete syncTimers[conversationId];
    });
  }, delay);
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

import { createSelectors } from "./createSelectors";

export const useChatStoreBase = create<ChatState>()(
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
        // Clean up circuit breaker state
        delete syncFailureCounts[id];
        delete syncBackoffDelays[id];
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

      clearAllConversations: () => {
        // Cancel all pending sync timers and reset circuit breaker state
        for (const id of Object.keys(syncTimers)) {
          clearTimeout(syncTimers[id]);
          delete syncTimers[id];
        }
        for (const id of Object.keys(syncFailureCounts)) {
          delete syncFailureCounts[id];
        }
        for (const id of Object.keys(syncBackoffDelays)) {
          delete syncBackoffDelays[id];
        }
        set({ conversations: [], activeConversationId: null, messages: {} });
      },
    }),
    {
      name: "atlas-conversations",
      version: 1,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // v0 → v1: ensure all required fields have defaults
          return {
            ...persistedState,
            conversations: persistedState.conversations ?? [],
            activeConversationId: persistedState.activeConversationId ?? null,
            messages: persistedState.messages ?? {},
          };
        }
        return persistedState as ChatState;
      },
      // Persist conversations list only — messages are kept in-memory.
      // Including messages in persist caused a write storm: every addMessage()
      // call serialized the full message history (potentially megabytes) to
      // localStorage synchronously. Messages survive navigation because the
      // Zustand store is module-level (not unmounted between page navigations).
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Rehydration error:", error);
        }
      },
    }
  )
);

export const useChatStore = createSelectors(useChatStoreBase);
