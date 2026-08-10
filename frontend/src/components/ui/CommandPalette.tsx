"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MessageSquare, Settings, Mail, Moon, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store/useAppStore";

const actions = [
  { id: "new-chat", label: "New Chat", icon: MessageSquare, route: "/chat" },
  { id: "settings", label: "Open Settings", icon: Settings, route: "/settings" },
  { id: "connect-gmail", label: "Connect Gmail", icon: Mail, route: "/settings/connections" },
  { id: "theme", label: "Theme Toggle", icon: Moon, action: "theme" },
  { id: "exit", label: "Exit", icon: LogOut, action: "exit" },
];

export function CommandPalette() {
  const { commandBarOpen: open, setCommandBarOpen: setOpen } = useAppStore();
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    setSelectedIndex(0);
  }, [search, open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [setOpen]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [open, setOpen]);

  const handleSelect = (action: typeof actions[0]) => {
    setOpen(false);
    setSearch("");
    if (inputRef.current) inputRef.current.blur();
    
    if (action.route) {
      router.push(action.route);
    } else if (action.action === "theme") {
      document.documentElement.classList.toggle("dark");
    } else if (action.action === "exit") {
      if (typeof window !== "undefined") {
         window.close();
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => filtered.length > 0 ? (prev + 1) % filtered.length : 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => filtered.length > 0 ? (prev - 1 + filtered.length) % filtered.length : 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        handleSelect(filtered[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      if (inputRef.current) inputRef.current.blur();
    }
  };

  return (
    <div className="relative w-full max-w-2xl mx-auto" ref={containerRef}>
      <div className={cn(
        "flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded-full transition-all duration-200",
        open ? "bg-white/5 border-white/20 shadow-lg" : "hover:bg-white/5 hover:border-white/20"
      )}>
        <Search size={18} className="text-white/40" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search commands, settings, or integrations..."
          className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40"
        />
        {open && (
          <div className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
            <kbd className="font-sans">esc</kbd>
          </div>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 right-0 mt-2 z-50 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] shadow-2xl backdrop-blur-xl"
          >
            <div className="max-h-[300px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/40">No results found.</p>
              ) : (
                filtered.map((action, idx) => (
                  <button
                    key={action.id}
                    onClick={() => handleSelect(action)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] transition-colors",
                      selectedIndex === idx
                        ? "bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <action.icon size={16} className={selectedIndex === idx ? "text-white" : "text-white/50"} />
                    {action.label}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
