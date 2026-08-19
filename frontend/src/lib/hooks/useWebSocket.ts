import { useEffect, useRef } from "react";
import { useAuthStore } from "../store/useAuthStore";
import { useWebSocketStore } from "../store/useWebSocketStore";
import { useAppStore } from "../store/useAppStore";

export function useWebSocket() {
  const { user, accessToken } = useAuthStore();
  const dispatch = useWebSocketStore((state) => state.dispatch);
  const setWsConnected = useAppStore((state) => state.setWsConnected);
  const setSyncProgress = useAppStore((state) => state.setSyncProgress);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user || !accessToken) return;

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
    if (!wsUrl) return; // Do not connect to WebSocket if no URL is provided

    const ws = new WebSocket(`${wsUrl}/ws/${user.id}?token=${accessToken}`);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      console.log("[WebSocket] Connected");
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const data = JSON.parse(event.data);
        dispatch(data);

        // Update global sync progress
        if (data.event === "sync_started") {
          setSyncProgress(data.provider);
        } else if (data.event === "sync_complete" || data.event === "sync_error") {
          setSyncProgress(null);
        }
      } catch (err) {
        console.error("[WebSocket] Failed to parse message:", err);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      console.log("[WebSocket] Disconnected");
      setWsConnected(false);
    };

    ws.onerror = (err) => {
      if (wsRef.current !== ws) return;
      console.debug("[WebSocket] Connection attempt failed (will retry):", err);
    };

    wsRef.current = ws;

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [user, accessToken, dispatch, setWsConnected, setSyncProgress]);
}
