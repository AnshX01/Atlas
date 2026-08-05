import { create } from "zustand";

export interface SyncEvent {
  type: string;
  payload?: any;
  timestamp?: string;
}

interface WebSocketState {
  events: SyncEvent[];
  dispatch: (event: SyncEvent) => void;
  clearEvents: () => void;
}

export const useWebSocketStore = create<WebSocketState>((set) => ({
  events: [],
  dispatch: (event) =>
    set((state) => ({
      events: [...state.events, { ...event, timestamp: new Date().toISOString() }],
    })),
  clearEvents: () => set({ events: [] }),
}));
