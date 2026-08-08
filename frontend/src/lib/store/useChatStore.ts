import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
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

export const useChatStore = create<ChatState>()(
  persist(
    (set, _get) => ({
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
        set((state) => ({
          conversations: [conversation, ...state.conversations].slice(0, 50),
          activeConversationId: id,
          messages: { ...state.messages, [id]: [] },
        }));
        return id;
      },

      removeConversation: (id: string) => {
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
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, title } : c
          ),
        }));
      },

      addMessage: (conversationId: string, message: ChatMessage) => {
        set((state) => {
          const existing = state.messages[conversationId] || [];
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
      },

      clearMessages: (conversationId: string) => {
        set((state) => ({
          messages: { ...state.messages, [conversationId]: [] },
        }));
      },
    }),
    {
      name: "atlas-conversations",
      // Persist conversations list and messages to localStorage
      partialize: (state) => ({
        conversations: state.conversations,
        activeConversationId: state.activeConversationId,
        messages: state.messages,
      }),
    }
  )
);
