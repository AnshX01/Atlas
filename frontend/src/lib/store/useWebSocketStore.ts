import { create } from "zustand";

export interface SyncEvent {
  event: string;
  connector_id?: string;
  provider?: string;
  timestamp?: string;
  synced?: number;
  failed?: number;
  error?: string;
}

interface WebSocketState {
  events: SyncEvent[];
  dispatch: (event: SyncEvent) => void;
  clearEvents: () => void;
}

import { createSelectors } from "./createSelectors";

export const useWebSocketStoreBase = create<WebSocketState>((set) => ({
  events: [],
  dispatch: (event) =>
    set((state) => ({
      events: [...state.events, event],
    })),
  clearEvents: () => set({ events: [] }),
}));

export const useWebSocketStore = createSelectors(useWebSocketStoreBase);
