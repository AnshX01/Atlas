"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Search, Moon, Sun, RefreshCw, User } from "lucide-react";
import { useAppStore } from "@/lib/store/useAppStore";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export function TopBar() {
  const { theme, toggleTheme, syncProgress, setCommandBarOpen } = useAppStore();
  const router = useRouter();
  const isSyncing = syncProgress !== null;

  return (
    <header
      className="app-topbar flex items-center justify-between px-4 gap-3"
      role="banner"
    >
      {/* Left: breadcrumb / page title */}
      <div id="topbar-title" className="text-sm font-medium text-[var(--text-secondary)]" />

      {/* Center: AI Search trigger (opens CommandBar) */}
      <button
        id="global-search-trigger"
        onClick={() => setCommandBarOpen(true)}
        className={cn(
          "hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl",
          "border border-[var(--border-default)] bg-[var(--bg-tertiary)]",
          "text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]",
          "hover:border-[var(--accent)]/40 hover:bg-[var(--bg-secondary)]",
          "transition-all duration-150 cursor-pointer select-none",
          "w-64"
        )}
        aria-label="Open AI Search (⌘Space)"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Search size={13} />
        <span className="flex-1 text-left text-xs">AI Search...</span>
        <kbd className="text-[10px] font-mono bg-[var(--bg-primary)] border border-[var(--border-default)] px-1.5 py-0.5 rounded-md text-[var(--text-muted)]">
          ⌘Space
        </kbd>
      </button>

      {/* Right: Actions */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {/* Sync indicator */}
        <AnimatePresence>
          {isSyncing && (
            <motion.div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] text-xs"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              aria-live="polite"
              aria-label="Sync in progress"
            >
              <RefreshCw size={12} className="animate-spin" />
              <span className="font-medium">Syncing</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Theme toggle */}
        <button
          id="theme-toggle-btn"
          onClick={toggleTheme}
          className="w-8 h-8 flex items-center justify-center rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* User avatar */}
        <button
          id="user-avatar-btn"
          onClick={() => router.push('/profile')}
          className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center text-white ml-1"
          aria-label="Open profile"
        >
          <User size={13} />
        </button>
      </div>
    </header>
  );
}
