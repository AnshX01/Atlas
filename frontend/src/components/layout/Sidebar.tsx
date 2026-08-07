"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Settings, Zap, Github,
  Chrome, Mail, FolderOpen, Plus, Home
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { connectorsAPI, type ConnectorProvider } from "@/lib/api/connectors";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard",      href: "/dashboard", icon: <Home size={16} />,            shortcut: "⌘D" },
  { id: "briefing",  label: "Daily Briefing", href: "/briefing",  icon: <LayoutDashboard size={16} />, shortcut: "⌘1" },
];

const providerMeta: Record<ConnectorProvider, { label: string; icon: React.ReactNode }> = {
  google_workspace: { label: "Google Workspace", icon: <Chrome size={14} /> },
  github:           { label: "GitHub",           icon: <Github size={14} /> },
  local_fs:         { label: "Local Files",      icon: <FolderOpen size={14} /> },
  slack:            { label: "Slack",            icon: <Mail size={14} /> },
  notion:           { label: "Notion",           icon: <FolderOpen size={14} /> },
  jira:             { label: "Jira",             icon: <FolderOpen size={14} /> },
  linear:           { label: "Linear",           icon: <FolderOpen size={14} /> },
};

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-400";
    case "error":
    case "requires_reauth":
      return "bg-red-400";
    default:
      return "bg-[var(--text-muted)]/40";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Connected";
    case "error":
      return "Error";
    case "requires_reauth":
      return "Requires re-authentication";
    default:
      return "Disconnected";
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
    staleTime: 60000,
  });

  const connectorItems = connectors.map((c) => ({
    id: c.id,
    provider: c.provider,
    label: providerMeta[c.provider]?.label || c.provider,
    icon: providerMeta[c.provider]?.icon || <FolderOpen size={14} />,
    status: c.status,
  }));

  const navigateToIntegrations = () => {
    router.push("/settings");
  };

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
        <div className="px-2 mb-1.5">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            Connectors
          </p>
        </div>

        {connectorItems.map((c) => (
          <div
            key={c.id}
            onClick={() => router.push(`/settings?connector=${c.id}`)}
            className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] cursor-pointer transition-colors group"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push(`/settings?connector=${c.id}`); }}
            title={`Manage ${c.label}`}
          >
            <span>{c.icon}</span>
            <span className="flex-1 truncate">{c.label}</span>
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full flex-shrink-0",
                getStatusColor(c.status)
              )}
              aria-label={getStatusLabel(c.status)}
            />
          </div>
        ))}

        {/* Add connector prompt if empty */}
        <button
          onClick={navigateToIntegrations}
          className="flex items-center gap-2 px-3 py-2 mt-2 rounded-xl text-xs text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors border border-[var(--border-default)] hover:border-[var(--accent)]/30"
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
