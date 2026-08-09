"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Search, MessageSquare, Settings, Mail, Moon, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const actions = [
  { id: "new-chat", label: "New Chat", icon: MessageSquare, route: "/chat" },
  { id: "settings", label: "Open Settings", icon: Settings, route: "/settings" },
  { id: "connect-gmail", label: "Connect Gmail", icon: Mail, route: "/settings/connections" },
  { id: "theme", label: "Theme Toggle", icon: Moon, action: "theme" },
  { id: "exit", label: "Exit", icon: LogOut, action: "exit" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()));

  const handleSelect = (action: typeof actions[0]) => {
    setOpen(false);
    setSearch("");
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

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: "-50%", x: "-50%" }}
            animate={{ opacity: 1, scale: 1, y: "-50%", x: "-50%" }}
            exit={{ opacity: 0, scale: 0.95, y: "-50%", x: "-50%" }}
            className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <Search size={18} className="text-white/40" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a command or search..."
                className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/40"
              />
              <div className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
                <kbd className="font-sans">esc</kbd>
              </div>
            </div>
            <div className="max-h-[300px] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-white/40">No results found.</p>
              ) : (
                filtered.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleSelect(action)}
                    className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] text-white/70 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <action.icon size={16} />
                    {action.label}
                  </button>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
