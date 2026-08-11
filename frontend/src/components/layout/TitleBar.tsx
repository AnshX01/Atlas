"use client";

import { Minus, Square, X, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/useAppStore";

export function TitleBar() {
  const [isElectron, setIsElectron] = useState(false);
  const { isMaximized, setIsMaximized } = useAppStore();

  useEffect(() => {
    // Check if we are in Electron
    if (typeof window !== "undefined" && window.atlasElectron) {
      setIsElectron(true);

      const unsubMax = window.atlasElectron.onWindowMaximized(() => setIsMaximized(true));
      const unsubUnmax = window.atlasElectron.onWindowUnmaximized(() => setIsMaximized(false));

      return () => {
        unsubMax();
        unsubUnmax();
      };
    }
  }, [setIsMaximized]);

  if (!isElectron) return null; // Only show custom title bar in Electron

  return (
    <div
      className="h-8 w-full flex items-center justify-between px-3 select-none z-[9999] bg-[var(--bg-primary)]/80 backdrop-blur-md border-b border-[var(--border-subtle)]"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-white/50 tracking-wide pl-2">
        ATLAS
      </div>
      <div className="flex items-center h-full gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          onClick={() => window.atlasElectron?.windowMinimize()}
          className="w-8 h-full flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-colors rounded-sm"
          title="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.atlasElectron?.windowMaximize()}
          className="w-8 h-full flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-colors rounded-sm"
          title={isMaximized ? "Restore Down" : "Maximize"}
        >
          {isMaximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          onClick={() => window.atlasElectron?.windowClose()}
          className="w-8 h-full flex items-center justify-center text-white/50 hover:bg-red-500 hover:text-white transition-colors rounded-sm"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
