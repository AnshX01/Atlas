import { create } from "zustand";
import type { BriefingItemData } from "@/components/composite/BriefingCard";

interface BriefingState {
  // ── Data ─────────────────────────────────────────────────────────
  items: BriefingItemData[];
  focusScore: number;
  focusScoreLabel: string;
  totalUnread: number;
  generatedAt: string | null;

  // ── UI State ──────────────────────────────────────────────────────
  loading: boolean;
  error: string | null;

  // ── Actions ────────────────────────────────────────────────────────
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setBriefing: (data: {
    items: BriefingItemData[];
    focus_score: number;
    focus_score_label: string;
    total_unread: number;
    generated_at: string;
  }) => void;
  markItemActioned: (itemId: string) => void;
  resetBriefing: () => void;
}

export const useBriefingStore = create<BriefingState>()((set) => ({
  // ── Initial State ──────────────────────────────────────────────────
  items: [],
  focusScore: 0,
  focusScoreLabel: "",
  totalUnread: 0,
  generatedAt: null,
  loading: false,
  error: null,

  // ── Actions ─────────────────────────────────────────────────────────
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),

  setBriefing: (data) =>
    set({
      items: data.items,
      focusScore: data.focus_score,
      focusScoreLabel: data.focus_score_label,
      totalUnread: data.total_unread,
      generatedAt: data.generated_at,
      loading: false,
      error: null,
    }),

  markItemActioned: (itemId) =>
    set((state) => ({
      items: state.items.filter((item) => item.id !== itemId),
      totalUnread: Math.max(0, state.totalUnread - 1),
    })),

  resetBriefing: () =>
    set({
      items: [],
      focusScore: 0,
      focusScoreLabel: "",
      totalUnread: 0,
      generatedAt: null,
      error: null,
    }),
}));
