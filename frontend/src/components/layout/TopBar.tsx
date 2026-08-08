"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun, RefreshCw } from "lucide-react";
import { useAppStore } from "@/lib/store/useAppStore";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useRouter } from "next/navigation";

const AVATAR_STORAGE_KEY = "atlas-profile-avatar";

export function TopBar() {
  const { theme, toggleTheme, syncProgress } = useAppStore();
  const { user } = useAuthStore();
  const router = useRouter();
  const isSyncing = syncProgress !== null;

  // ── Avatar from localStorage ──────────────────────────────────────
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (stored) setAvatar(stored);

    // Listen for storage changes (e.g. avatar updated on profile page)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === AVATAR_STORAGE_KEY) {
        setAvatar(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Also re-check on focus (catches same-tab localStorage writes)
  useEffect(() => {
    const handleFocus = () => {
      const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
      setAvatar(stored);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const userInitial = (user?.full_name?.[0] ?? user?.email?.[0] ?? "U").toUpperCase();

  return (
    <header
      className="app-topbar flex items-center justify-between px-4 gap-3"
      role="banner"
    >
      {/* Left: breadcrumb / page title */}
      <div id="topbar-title" className="text-sm font-medium text-[var(--text-secondary)]" />

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
          className="w-7 h-7 rounded-full bg-gradient-to-br from-[var(--accent)] to-purple-500 flex items-center justify-center text-white ml-1 overflow-hidden"
          aria-label="Open profile"
        >
          {avatar ? (
            <img
              src={avatar}
              alt="Profile"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-xs font-semibold leading-none">
              {userInitial}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
