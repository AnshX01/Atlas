/**
 * Atlas — Briefing API (local-first).
 * When running in Electron, data comes from MCP servers via the orchestrator.
 * In dev mode, falls back to the backend API.
 */

import { apiClient } from "./client";
import type { BriefingItemData } from "@/components/composite/BriefingCard";

export interface DailyBriefingResponse {
  date: string;
  focus_score: number;
  focus_score_label: string;
  items: BriefingItemData[];
  total_unread: number;
  generated_at: string;
}

export const briefingAPI = {
  async getDaily(): Promise<DailyBriefingResponse> {
    try {
      const { data } = await apiClient.get<DailyBriefingResponse>("/briefing/daily");
      return data;
    } catch {
      // Return empty briefing if backend is not available (desktop-only mode)
      return {
        date: new Date().toISOString(),
        focus_score: 0,
        focus_score_label: "No Data",
        items: [],
        total_unread: 0,
        generated_at: new Date().toISOString(),
      };
    }
  },
};
