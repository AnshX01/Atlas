import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useWebSocketStore } from "../store/useWebSocketStore";

export function useWebSocket() {
  const ws = useRef<WebSocket | null>(null);
  const { user, accessToken } = useAuthStore();
  const dispatch = useWebSocketStore((state) => state.dispatch);

  useEffect(() => {
    if (!user || !user.id || !accessToken) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000";
    const socket = new WebSocket(`${wsUrl}/ws/${user.id}?token=${accessToken}`);

    socket.onopen = () => {
      console.log("WebSocket connected");
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        dispatch(data);
      } catch (e) {
        console.error("Failed to parse WebSocket message", e);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
    };

    ws.current = socket;

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [user, accessToken, dispatch]);

  return ws.current;
}
