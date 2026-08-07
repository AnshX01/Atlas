import { create } from "zustand";
import type { BriefingItemData } from "@/components/composite/BriefingCard";

const DISMISSED_STORAGE_KEY = "atlas-dismissed-items";

function loadDismissedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

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
  dismissItem: (id: string) => void;
  isDismissed: (id: string) => boolean;
  clearDismissed: () => void;
  resetBriefing: () => void;
}

export const useBriefingStore = create<BriefingState>()((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────
  items: [],
  focusScore: 0,
  focusScoreLabel: "",
  totalUnread: 0,
  generatedAt: null,
  dismissedIds: loadDismissedIds(),
  loading: false,
  error: null,

  // ── Actions ─────────────────────────────────────────────────────────
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),

  setBriefing: (data) =>
    set((state) => ({
      items: data.items.filter((item) => !state.dismissedIds.includes(item.id)),
      focusScore: data.focus_score,
      focusScoreLabel: data.focus_score_label,
      totalUnread: data.total_unread,
      generatedAt: data.generated_at,
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
      const updated = [...state.dismissedIds, id];
      localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(updated));
      return {
        dismissedIds: updated,
        items: state.items.filter((item) => item.id !== id),
        totalUnread: Math.max(0, state.totalUnread - 1),
      };
    }),

  isDismissed: (id) => get().dismissedIds.includes(id),

  clearDismissed: () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, "[]");
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
    }),
}));
