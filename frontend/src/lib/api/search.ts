import { apiClient } from "./client";

export interface OmniSearchRequest {
  query: string;
  limit?: number;
  sources?: string[];
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  source: string;
  score: number;
  url?: string;
  timestamp: string;
  source_ids: string[];
}

export interface OmniSearchResponse {
  original_query: string;
  rewritten_query: string;
  results: SearchResult[];
  took_ms: number;
}

export const searchAPI = {
  /** POST /v1/search/omni */
  async omniSearch(payload: OmniSearchRequest): Promise<OmniSearchResponse> {
    const { data } = await apiClient.post<OmniSearchResponse>("/search/omni", payload);
    return data;
  },
};
