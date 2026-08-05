"use client";

import { useEffect, useCallback } from "react";
import Mousetrap from "mousetrap";
import { useAppStore } from "@/lib/store/useAppStore";
import { useBriefingStore } from "@/lib/store/useBriefingStore";

/**
 * Registers all Atlas keyboard shortcuts per Section 3.3.
 *
 * Shortcut table:
 *   Cmd+Space  → Toggle Command Bar (global, via Electron)
 *   Cmd+1-9    → Execute action for briefing item at index
 *   Tab        → Accept AI suggestion (context-dependent)
 *   Escape     → Dismiss / reject
 *   Cmd+,      → Open settings
 */
export function useKeyboardShortcuts() {
  const { toggleCommandBar, setCommandBarOpen } = useAppStore();
  const { items, markItemActioned } = useBriefingStore();

  const executeItemAction = useCallback(
    (index: number) => {
      const item = items[index];
      if (!item) return;
      // TODO: dispatch action to action agent
      markItemActioned(item.id);
    },
    [items, markItemActioned]
  );

  useEffect(() => {
    // ── Toggle command bar (web fallback; Electron registers the OS-level shortcut) ──
    Mousetrap.bind(["command+space", "ctrl+space"], (e) => {
      e.preventDefault();
      toggleCommandBar();
    });

    // ── Execute action for item 1-9 ────────────────────────────────
    for (let i = 1; i <= 9; i++) {
      const idx = i - 1;
      Mousetrap.bind([`command+${i}`, `ctrl+${i}`], (e) => {
        e.preventDefault();
        executeItemAction(idx);
      });
    }

    // ── Escape: close command bar ──────────────────────────────────
    Mousetrap.bind("escape", () => {
      setCommandBarOpen(false);
    });

    // ── Cmd+, → settings ──────────────────────────────────────────
    Mousetrap.bind(["command+,", "ctrl+,"], (e) => {
      e.preventDefault();
      window.location.href = "/settings";
    });

    return () => {
      Mousetrap.unbind(["command+space", "ctrl+space"]);
      Mousetrap.unbind("escape");
      Mousetrap.unbind(["command+,", "ctrl+,"]);
      for (let i = 1; i <= 9; i++) {
        Mousetrap.unbind([`command+${i}`, `ctrl+${i}`]);
      }
    };
  }, [toggleCommandBar, setCommandBarOpen, executeItemAction]);
}
