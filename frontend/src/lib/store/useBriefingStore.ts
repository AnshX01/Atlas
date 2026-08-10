import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BriefingItemData } from "@/components/composite/BriefingCard";

interface BriefingState {
  // ── Data ─────────────────────────────────────────────────────────
  items: BriefingItemData[];
  focusScore: number;
  focusScoreLabel: string;
  totalUnread: number;
  generatedAt: string | null;
  dismissedIds: string[];

  // ── UI State ──────────────────────────────────────────────────────
  loading: boolean;
  error: string | null;
  isSummarizing: boolean;

  // ── Actions ────────────────────────────────────────────────────────
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBriefing: (data: {
    items: BriefingItemData[];
    focus_score: number;
    focus_score_label: string;
    total_unread: number;
    generated_at: string;
    is_summarizing?: boolean;
  }) => void;
  markItemActioned: (itemId: string) => void;
  dismissItem: (id: string) => void;
  isDismissed: (id: string) => boolean;
  clearDismissed: () => void;
  resetBriefing: () => void;
}

export const useBriefingStore = create<BriefingState>()(
  persist(
    (set, get) => ({
      // ── Initial State ──────────────────────────────────────────────────
      items: [],
      focusScore: 0,
      focusScoreLabel: "",
      totalUnread: 0,
      generatedAt: null,
      dismissedIds: [],
      loading: false,
      error: null,
      isSummarizing: false,

  // ── Actions ─────────────────────────────────────────────────────────
  setLoading: (loading) => set(loading ? { loading, error: null } : { loading }),
  setError: (error) => set({ error, loading: false, isSummarizing: false }),

  setBriefing: (data) =>
    set((state) => ({
      items: (data.items || []).filter((item) => !state.dismissedIds.includes(item.id)),
      focusScore: data.focus_score,
      focusScoreLabel: data.focus_score_label,
      totalUnread: data.total_unread,
      generatedAt: data.generated_at,
      isSummarizing: data.is_summarizing ?? false,
      loading: false,
      error: null,
    })),

  markItemActioned: (itemId) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
      totalUnread: Math.max(0, state.totalUnread - 1),
    })),

  dismissItem: (id) =>
    set((state) => {
      if (state.dismissedIds.includes(id)) return state;
      const updated = [...state.dismissedIds, id];
      return {
        dismissedIds: updated,
        items: state.items.filter((item) => item.id !== id),
        totalUnread: Math.max(0, state.totalUnread - 1),
      };
    }),

  isDismissed: (id) => get().dismissedIds.includes(id),

  clearDismissed: () => {
    set({ dismissedIds: [] });
  },

  resetBriefing: () =>
    set({
      items: [],
      focusScore: 0,
      focusScoreLabel: "",
      totalUnread: 0,
      generatedAt: null,
      error: null,
      isSummarizing: false,
    }),
  }),
    {
      name: "atlas-briefing-store",
      partialize: (state) => ({ dismissedIds: state.dismissedIds }),
    }
  )
);
