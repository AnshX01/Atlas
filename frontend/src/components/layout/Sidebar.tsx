"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Search, Settings, Zap, Github,
  Mail, FolderOpen, Plus, ChevronRight, Wifi, WifiOff
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store/useAppStore";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const navItems: NavItem[] = [
  { id: "briefing",  label: "Daily Briefing", href: "/briefing",  icon: <LayoutDashboard size={16} />, shortcut: "⌘1" },
  { id: "search",    label: "Search",         href: "/search",    icon: <Search size={16} />,          shortcut: "⌘K" },
];

const connectorItems = [
  { id: "gmail",    label: "Gmail",        icon: <Mail size={14} />,      status: "active"   },
  { id: "github",   label: "GitHub",       icon: <Github size={14} />,    status: "active"   },
  { id: "localfs",  label: "Local Files",  icon: <FolderOpen size={14} />,status: "inactive" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { setCommandBarOpen } = useAppStore();

  return (
    <motion.aside
      className="app-sidebar flex flex-col py-4"
      initial={{ x: -8, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 35 }}
      role="navigation"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="px-4 mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-[var(--accent)] to-blue-600 flex items-center justify-center shadow-[var(--shadow-glow)]">
            <Zap size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-[var(--text-primary)] tracking-tight">
            Atlas
          </span>
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium">
            BETA
          </span>
        </div>
      </div>

      {/* Primary Nav */}
      <div className="px-2 flex flex-col gap-0.5 mb-6">
        <p className="px-2 mb-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          Workspace
        </p>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.id} href={item.href} aria-current={isActive ? "page" : undefined}>
              <motion.div
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer",
                  "text-sm transition-all duration-150 group relative",
                  isActive
                    ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                )}
                whileTap={{ scale: 0.98 }}
              >
                {isActive && (
                  <motion.div
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[var(--accent)] rounded-full"
                    layoutId="activeIndicator"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <kbd className="text-[10px] font-mono opacity-0 group-hover:opacity-50 transition-opacity text-[var(--text-muted)]">
                    {item.shortcut}
                  </kbd>
                )}
              </motion.div>
            </Link>
          );
        })}
      </div>

      {/* Connectors */}
      <div className="px-2 flex flex-col gap-0.5 flex-1">
        <div className="flex items-center justify-between px-2 mb-1.5">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            Connectors
          </p>
          <button
            className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors rounded-lg p-0.5"
            aria-label="Add new connector"
            title="Add connector"
          >
            <Plus size={12} />
          </button>
        </div>

        {connectorItems.map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors group"
          >
            <span>{c.icon}</span>
            <span className="flex-1">{c.label}</span>
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                c.status === "active" ? "bg-green-400" : "bg-[var(--text-muted)]/40"
              )}
              aria-label={c.status === "active" ? "Connected" : "Disconnected"}
            />
          </div>
        ))}

        {/* Add connector prompt if empty */}
        <button
          className="flex items-center gap-2 px-3 py-2 mt-2 rounded-xl text-xs text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors border border-dashed border-[var(--accent)]/30"
          aria-label="Connect a new integration"
        >
          <Plus size={12} />
          <span>Add Integration</span>
        </button>
      </div>

      {/* Bottom: Settings */}
      <div className="px-2 pt-4 border-t border-[var(--border-subtle)]">
        <Link href="/settings" aria-label="Open settings (⌘,)">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            <Settings size={16} />
            <span>Settings</span>
            <kbd className="ml-auto text-[10px] font-mono text-[var(--text-muted)] opacity-60">⌘,</kbd>
          </div>
        </Link>
      </div>
    </motion.aside>
  );
}
