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
  executionId?: string;
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
  streaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  lastMessage: string;
}

export interface ChatState {
  // ── Conversations ───────────────────────────────────────────────
  conversations: Conversation[];
  activeConversationId: string | null;

  // ── Messages (keyed by conversation id) ─────────────────────────
  messages: Record<string, ChatMessage[]>;

  // ── Background streaming state ──────────────────────────────────
  streamingConversationId: string | null;
  streamingAssistantId: string | null;
  status: "idle" | "streaming" | "stopped";

  // ── Actions ─────────────────────────────────────────────────────
  addConversation: (title: string) => string;
  removeConversation: (id: string) => void;
  setActiveConversation: (id: string | null) => void;
  updateConversationTitle: (id: string, title: string) => void;
  addMessage: (conversationId: string, message: ChatMessage) => void;
  clearMessages: (conversationId: string) => void;
  clearAllConversations: () => void;

  // ── SQLite & Background Workflow Actions ─────────────────────────
  hydrateFromSQLite: () => Promise<void>;
  loadConversationMessages: (conversationId: string) => Promise<void>;
  startWorkflowStreaming: (conversationId: string, assistantId: string) => void;
  stopWorkflowStreaming: () => void;
  appendStreamingToken: (token: string) => void;
  addWorkflowToolExecution: (data: any) => void;
  addWorkflowAction: (data: any) => void;
  setWorkflowDraft: (data: any) => void;
  completeWorkflow: (data: any) => void;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const deletedConversationIds = new Set<string>();
const syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};

// Circuit breaker state per conversation: tracks consecutive failures.
const syncFailureCounts: Record<string, number> = {};
const syncBackoffDelays: Record<string, number> = {};
const MAX_SYNC_FAILURES = 5;
const SYNC_BASE_DELAY_MS = 1000;
const SYNC_MAX_DELAY_MS = 30_000;

/** Fire-and-forget background sync to cloud backend with circuit breaker + exponential backoff */
function backgroundSync(conversationId: string, getState: () => ChatState): void {
  if ((syncFailureCounts[conversationId] ?? 0) >= MAX_SYNC_FAILURES) return;

  const delay = syncBackoffDelays[conversationId] ?? SYNC_BASE_DELAY_MS;

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
      delete syncFailureCounts[conversationId];
      delete syncBackoffDelays[conversationId];
    }).catch(err => {
      console.error("Background sync error:", err);
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
      streamingConversationId: null,
      streamingAssistantId: null,
      status: "idle",

      addConversation: (title: string) => {
        const id = generateId();
        const conversation: Conversation = {
          id,
          title,
          createdAt: new Date().toISOString(),
          lastMessage: "",
        };
        set((state) => {
          // Remove duplicate empty conversations with same title created recently
          const filtered = state.conversations.filter(
            (c) => c.id !== id && !(c.title === title && c.lastMessage === "" && (Date.now() - new Date(c.createdAt).getTime() < 5000))
          );
          const conversations = [conversation, ...filtered].slice(0, 300);
          const activeIds = new Set(conversations.map((c) => c.id));
          const messages: Record<string, ChatMessage[]> = { ...state.messages, [id]: state.messages[id] || [] };
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
        deletedConversationIds.add(id);
        if (syncTimers[id]) {
          clearTimeout(syncTimers[id]);
          delete syncTimers[id];
        }
        delete syncFailureCounts[id];
        delete syncBackoffDelays[id];

        // Delete from Electron SQLite
        if (typeof window !== "undefined" && (window as any).atlasElectron?.deleteConversation) {
          (window as any).atlasElectron.deleteConversation(id).catch((err: any) => {
            console.warn("[ChatStore] Failed to delete conversation from SQLite:", err);
          });
        }

        // Delete from Cloud Sync
        conversationSyncAPI.deleteConversation(id).catch(() => {});

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
          const idx = existing.findIndex((m) => m.id === message.id);
          const messages =
            idx >= 0
              ? existing.map((m) => (m.id === message.id ? message : m))
              : [...existing, message];

          const updatedConvs = state.conversations.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  lastMessage: (message.content || "").slice(0, 100),
                }
              : c
          );

          return {
            messages: {
              ...state.messages,
              [conversationId]: messages,
            },
            conversations: updatedConvs,
          };
        });
        backgroundSync(conversationId, get);
      },

      clearMessages: (conversationId: string) => {
        set((state) => ({
          messages: {
            ...state.messages,
            [conversationId]: [],
          },
        }));
      },

      clearAllConversations: () => {
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

        if (typeof window !== "undefined" && (window as any).atlasElectron?.clearAllConversations) {
          (window as any).atlasElectron.clearAllConversations().catch((err: any) => {
            console.warn("[ChatStore] Failed to clear all conversations from SQLite:", err);
          });
        }

        set({ conversations: [], activeConversationId: null, messages: {}, streamingConversationId: null, streamingAssistantId: null, status: "idle" });
      },

      hydrateFromSQLite: async () => {
        if (typeof window === "undefined" || !(window as any).atlasElectron?.listConversations) {
          return;
        }
        try {
          const list = await (window as any).atlasElectron.listConversations();
          if (Array.isArray(list)) {
            set((state) => {
              const existingMap = new Map(state.conversations.map((c) => [c.id, c]));
              const merged: Conversation[] = [];

              for (const c of list) {
                if (deletedConversationIds.has(c.id)) continue;
                const existing = existingMap.get(c.id);
                merged.push({
                  id: c.id,
                  title: c.title || existing?.title || "New Conversation",
                  createdAt: c.created_at || existing?.createdAt || new Date().toISOString(),
                  lastMessage: c.last_message || existing?.lastMessage || "",
                });
              }

              for (const c of state.conversations) {
                if (deletedConversationIds.has(c.id)) continue;
                const isDuplicate = merged.some(
                  (m) => m.id === c.id || (m.title.slice(0, 30) === c.title.slice(0, 30) && Math.abs(new Date(m.createdAt).getTime() - new Date(c.createdAt).getTime()) < 60000)
                );
                if (!isDuplicate) {
                  merged.push(c);
                }
              }

              const finalMerged: Conversation[] = [];
              const seenIds = new Set<string>();
              merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

              for (const c of merged) {
                if (!seenIds.has(c.id) && !deletedConversationIds.has(c.id)) {
                  seenIds.add(c.id);
                  finalMerged.push(c);
                }
              }

              return { conversations: finalMerged };
            });
          }
        } catch (err) {
          console.warn("[ChatStore] Failed to hydrate conversations from SQLite:", err);
        }
      },

      loadConversationMessages: async (conversationId: string) => {
        if (typeof window === "undefined" || !(window as any).atlasElectron?.getConversationHistory) {
          return;
        }
        try {
          const history = await (window as any).atlasElectron.getConversationHistory(conversationId, 100);
          if (Array.isArray(history) && history.length > 0) {
            const msgs: ChatMessage[] = history.map((m: any) => ({
              id: m.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              role: m.role as "user" | "assistant",
              content: m.content || "",
              results: m.results,
              actions: m.actions,
              toolExecutions: m.toolExecutions,
              draft: m.draft,
              timestamp: m.timestamp || m.created_at || new Date().toISOString(),
            }));
            set((state) => ({
              messages: { ...state.messages, [conversationId]: msgs },
            }));
          }
        } catch (err) {
          console.warn("[ChatStore] Failed to load messages from SQLite:", err);
        }
      },

      startWorkflowStreaming: (conversationId: string, assistantId: string) => {
        set({
          streamingConversationId: conversationId,
          streamingAssistantId: assistantId,
          status: "streaming",
        });
      },

      stopWorkflowStreaming: () => {
        const { streamingConversationId, streamingAssistantId, messages } = get();
        if (streamingConversationId && streamingAssistantId) {
          const convMessages = messages[streamingConversationId] || [];
          const updated = convMessages.map((m) =>
            m.id === streamingAssistantId ? { ...m, streaming: false } : m
          );
          set({
            messages: {
              ...messages,
              [streamingConversationId]: updated,
            },
            streamingConversationId: null,
            streamingAssistantId: null,
            status: "idle",
          });
        } else {
          set({
            streamingConversationId: null,
            streamingAssistantId: null,
            status: "idle",
          });
        }
      },

      appendStreamingToken: (token: string) => {
        const { streamingConversationId, streamingAssistantId, activeConversationId, messages } = get();
        const targetConvId = streamingConversationId || activeConversationId;
        if (!targetConvId) return;

        const convMessages = messages[targetConvId] || [];
        if (convMessages.length === 0) return;

        const targetAssistantId =
          streamingAssistantId ||
          [...convMessages].reverse().find((m) => m.role === "assistant")?.id;

        if (!targetAssistantId) return;

        const updated = convMessages.map((m) =>
          m.id === targetAssistantId
            ? { ...m, content: (m.content || "") + token, streaming: true }
            : m
        );
        set({
          messages: {
            ...messages,
            [targetConvId]: updated,
          },
        });
      },

      addWorkflowToolExecution: (data: any) => {
        const { streamingConversationId, streamingAssistantId, messages } = get();
        if (!streamingConversationId || !streamingAssistantId) return;

        const toolExecId = data.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const convMessages = messages[streamingConversationId] || [];

        const updated = convMessages.map((m) => {
          if (m.id !== streamingAssistantId) return m;

          const existingList = m.toolExecutions ?? [];
          const exists = existingList.some((t) => t.id === toolExecId);

          if (exists) {
            return {
              ...m,
              toolExecutions: existingList.map((t) =>
                t.id === toolExecId
                  ? {
                      ...t,
                      status: data.status || t.status,
                      server: data.server || t.server,
                      tool: data.tool || t.tool,
                      errorMessage: data.errorMessage || t.errorMessage,
                    }
                  : t
              ),
            };
          }

          const newToolExec: ToolExecution = {
            id: toolExecId,
            server: data.server || "mcp",
            tool: data.tool || "unknown",
            status: data.status || "executing",
            errorMessage: data.errorMessage,
          };

          return {
            ...m,
            toolExecutions: [...existingList, newToolExec],
          };
        });

        set({
          messages: {
            ...messages,
            [streamingConversationId]: updated,
          },
        });
      },

      addWorkflowAction: (data: any) => {
        const { streamingConversationId, streamingAssistantId, messages } = get();
        if (!streamingConversationId || !streamingAssistantId) return;

        const action: ActionSuggestion = {
          id: data.id || data.executionId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          executionId: data.executionId || data.id,
          type: data.actionType || data.tool || "action",
          label: data.actionType || "Action",
          preview: data.description || "Requires your approval",
          status: "pending",
        };

        const convMessages = messages[streamingConversationId] || [];
        const updated = convMessages.map((m) =>
          m.id === streamingAssistantId
            ? { ...m, actions: [...(m.actions ?? []), action] }
            : m
        );
        set({
          messages: {
            ...messages,
            [streamingConversationId]: updated,
          },
        });
      },

      setWorkflowDraft: (data: any) => {
        const { streamingConversationId, streamingAssistantId, messages } = get();
        if (!streamingConversationId || !streamingAssistantId) return;

        const draft: DraftData = {
          executionId: data.executionId,
          actionType: data.actionType,
          fields: data.fields ?? {},
          status: "pending",
        };

        const convMessages = messages[streamingConversationId] || [];
        const updated = convMessages.map((m) =>
          m.id === streamingAssistantId ? { ...m, draft } : m
        );
        set({
          messages: {
            ...messages,
            [streamingConversationId]: updated,
          },
        });
      },

      completeWorkflow: (data: any) => {
        const { streamingConversationId, streamingAssistantId, messages, conversations } = get();
        const targetConvId = data?.conversationId || streamingConversationId;
        const targetAssistantId = streamingAssistantId;

        if (targetConvId) {
          const convMessages = messages[targetConvId] || [];
          const finalContent = data?.response || "";

          const updated = convMessages.map((m) => {
            if (targetAssistantId && m.id !== targetAssistantId) return m;
            if (!targetAssistantId && m.role !== "assistant") return m;

            let msgContent = m.content || finalContent;
            if (data?.error) {
              msgContent += `\n\n> **System Notice:** ${data.error}`;
            }
            if (!msgContent.trim()) {
              msgContent = "I couldn't generate a response. Please check your Ollama connection.";
            }

            let updatedDraft = m.draft;
            if (data?.error && updatedDraft && updatedDraft.status !== "rejected" && updatedDraft.status !== "done") {
              updatedDraft = { ...updatedDraft, status: "failed", errorMessage: data.error };
            } else if (updatedDraft && updatedDraft.status !== "rejected") {
              updatedDraft = { ...updatedDraft, status: "done" };
            }

            return {
              ...m,
              streaming: false,
              content: msgContent,
              results: data?.results ?? m.results,
              draft: updatedDraft,
              toolExecutions: m.toolExecutions?.map((t) => {
                const bt = data?.toolCalls?.find((b: any) => b.id === t.id);
                const hasError = bt?.result?.error != null || bt?.error != null;
                return {
                  ...t,
                  status: (hasError ? "failed" : "done") as any,
                  errorMessage: hasError ? (bt?.result?.error || bt?.error) : undefined,
                };
              }),
            };
          });

          const updatedConvs = conversations.map((c) =>
            c.id === targetConvId
              ? { ...c, lastMessage: (finalContent || convMessages[convMessages.length - 1]?.content || "").slice(0, 100) }
              : c
          );

          set({
            messages: {
              ...messages,
              [targetConvId]: updated,
            },
            conversations: updatedConvs,
            streamingConversationId: null,
            streamingAssistantId: null,
            status: "idle",
          });
        } else {
          set({
            streamingConversationId: null,
            streamingAssistantId: null,
            status: "idle",
          });
        }
      },
    }),
    {
      name: "atlas-conversations",
      version: 1,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          return {
            ...persistedState,
            conversations: persistedState.conversations ?? [],
            activeConversationId: persistedState.activeConversationId ?? null,
            messages: persistedState.messages ?? {},
          };
        }
        return persistedState as ChatState;
      },
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Rehydration error:", error);
        }
        // Immediately hydrate conversations from SQLite on boot
        setTimeout(() => {
          useChatStoreBase.getState().hydrateFromSQLite();
        }, 100);
      },
    }
  )
);

export const useChatStore = createSelectors(useChatStoreBase);
