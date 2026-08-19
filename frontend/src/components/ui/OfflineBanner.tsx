"use client";

import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Initial state from browser API
    setIsOffline(!navigator.onLine);

    // Standard browser online/offline events (works in browser mode)
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Electron IPC override: subscribe to the more reliable net:online-status event
    // which uses Electron's net module instead of the browser's navigator API.
    let unsubElectron: (() => void) | null = null;
    if ((window as any).atlasElectron?.onNetStatus) {
      unsubElectron = (window as any).atlasElectron.onNetStatus((online: boolean) => {
        setIsOffline(!online);
      });
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      unsubElectron?.();
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 bg-red-950/90 text-red-400 px-4 py-2 rounded-xl z-50 flex items-center gap-2 text-sm font-medium backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4"
    >
      <WifiOff size={16} aria-hidden="true" />
      You are currently offline. Check your connection.
    </div>
  );
}
