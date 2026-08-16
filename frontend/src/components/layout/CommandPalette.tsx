"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Home, LayoutDashboard, Plus, Settings, User, LogOut, Github } from "lucide-react";
import Fuse from "fuse.js";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useChatStore } from "@/lib/store/useChatStore";

interface Command {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleNewChat = useCallback(() => {
    useChatStore.getState().setActiveConversation(null);
    router.push(`/chat?t=${Date.now()}`);
  }, [router]);

  const commands: Command[] = useMemo(() => [
    {
      id: "github-pr",
      label: "Open a GitHub PR",
      icon: <Github size={16} />,
      onSelect: () => {
        const msg = "Open a GitHub PR";
        if (window.location.pathname.startsWith("/chat")) {
          window.dispatchEvent(new CustomEvent("atlas:inject_chat", { detail: { message: msg } }));
        } else {
          router.push(`/chat?q=${encodeURIComponent(msg)}`);
        }
      },
    },
    {
      id: "dashboard",
      label: "Go to Dashboard",
      icon: <Home size={16} />,
      onSelect: () => router.push("/dashboard"),
    },
    {
      id: "briefing",
      label: "Go to Daily Briefing",
      icon: <LayoutDashboard size={16} />,
      onSelect: () => router.push("/briefing"),
    },
    {
      id: "new-chat",
      label: "Start New Chat",
      icon: <Plus size={16} />,
      onSelect: handleNewChat,
    },
    {
      id: "settings",
      label: "Open Settings",
      icon: <Settings size={16} />,
      onSelect: () => router.push("/settings"),
    },
    {
      id: "profile",
      label: "View Profile",
      icon: <User size={16} />,
      onSelect: () => router.push("/profile"),
    },
    {
      id: "logout",
      label: "Logout",
      icon: <LogOut size={16} />,
      onSelect: () => useAuthStore.getState().logout(),
    },
  ], [router, handleNewChat]);

  const fuse = useMemo(
    () =>
      new Fuse(commands, {
        keys: ["label"],
        threshold: 0.4,
      }),
    [commands]
  );

  const filteredCommands = query
    ? fuse.search(query).map((res) => res.item)
    : commands;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev - 1 < 0 ? filteredCommands.length - 1 : prev - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].onSelect();
        setQuery("");
        setIsOpen(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Listen for Cmd+K or Ctrl+K to focus
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div 
        className="w-full max-w-lg bg-[var(--bg-primary)] rounded-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center px-4 py-3 gap-3">
          <Search size={18} className="text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands... (Cmd+K)"
            className="flex-1 bg-transparent outline-none text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            autoFocus
          />
        </div>

        {filteredCommands.length > 0 && (
          <div className="overflow-y-auto max-h-[300px]">
            {filteredCommands.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => {
                  cmd.onSelect();
                  setQuery("");
                  setIsOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  selectedIndex === i
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                }`}
              >
                <span className={selectedIndex === i ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
                  {cmd.icon}
                </span>
                <span className="text-sm font-medium">{cmd.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
