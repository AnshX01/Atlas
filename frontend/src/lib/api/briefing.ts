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
  /** GET /v1/briefing/daily */
  async getDaily(): Promise<DailyBriefingResponse> {
    const { data } = await apiClient.get<DailyBriefingResponse>("/briefing/daily");
    return data;
  },
};
