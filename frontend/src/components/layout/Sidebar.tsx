"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Settings,
  FolderOpen, Plus, Home, LogOut,
  MessageSquare, X,
} from "lucide-react";
import {
  GoogleLogo,
  GitHubLogo,
  SlackLogo,
  NotionLogo,
  LocalFilesLogo,
  JiraLogo,
  LinearLogo,
} from "@/components/icons/ProviderLogos";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { connectorsAPI, type ConnectorProvider } from "@/lib/api/connectors";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useChatStore } from "@/lib/store/useChatStore";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard",      href: "/dashboard", icon: <Home size={16} /> },
  { id: "briefing",  label: "Daily Briefing", href: "/briefing",  icon: <LayoutDashboard size={16} /> },
];

const providerMeta: Record<ConnectorProvider, { label: string; icon: React.ReactNode }> = {
  google_workspace: { label: "Google Workspace", icon: <GoogleLogo size={14} /> },
  github:           { label: "GitHub",           icon: <GitHubLogo size={14} /> },
  local_fs:         { label: "Local Files",      icon: <LocalFilesLogo size={14} /> },
  slack:            { label: "Slack",            icon: <SlackLogo size={14} /> },
  notion:           { label: "Notion",           icon: <NotionLogo size={14} /> },
  jira:             { label: "Jira",             icon: <JiraLogo size={14} /> },
  linear:           { label: "Linear",           icon: <LinearLogo size={14} /> },
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

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();

  // ── Avatar state ──────────────────────────────────────────────────
  const [avatar, setAvatar] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('atlas-profile-avatar');
    if (stored) setAvatar(stored);
    const handleFocus = () => {
      setAvatar(localStorage.getItem('atlas-profile-avatar'));
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  useEffect(() => {
    const handleAvatarUpdate = () => {
      setAvatar(localStorage.getItem('atlas-profile-avatar'));
    };
    window.addEventListener('atlas-avatar-updated', handleAvatarUpdate);
    return () => window.removeEventListener('atlas-avatar-updated', handleAvatarUpdate);
  }, []);

  const { data: connectors = [], isLoading: connectorsLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
    staleTime: 60000,
  });

  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const removeConversation = useChatStore((s) => s.removeConversation);

  const recentConversations = conversations.slice(0, 10);

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

  const handleNewChat = () => {
    setActiveConversation(null);
    router.push("/chat");
  };

  const handleConversationClick = (id: string) => {
    setActiveConversation(id);
    router.push(`/chat?id=${id}`);
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
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center shadow-sm">
            <img src="/logo.png" alt="Atlas" className="w-6 h-6" />
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
      <div className="px-2 flex flex-col gap-0.5 mb-4">
        <p className="px-2 mb-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          Workspace
        </p>
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.id} href={item.href} prefetch={true} aria-current={isActive ? "page" : undefined}>
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
                    className="absolute left-0 inset-y-0 my-auto w-0.5 h-4 bg-[var(--accent)] rounded-full"
                    layoutId="activeIndicator"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={isActive ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
                  {item.icon}
                </span>
                <span className="flex-1">{item.label}</span>
              </motion.div>
            </Link>
          );
        })}
      </div>

      {/* Connectors */}
      <div className="px-2 flex flex-col gap-0.5 mb-4">
        <div className="px-2 mb-1.5">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            Connectors
          </p>
        </div>

        {connectorsLoading ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">Loading...</div>
        ) : (
          connectorItems.map((c) => (
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
          ))
        )}

        {/* Add connector prompt */}
        <button
          onClick={navigateToIntegrations}
          className="flex items-center gap-2 px-3 py-2 mt-2 rounded-xl text-xs text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors border border-[var(--border-default)] hover:border-[var(--accent)]/30"
          aria-label="Connect a new integration"
        >
          <Plus size={12} />
          <span>Add Integration</span>
        </button>
      </div>

      {/* Conversations */}
      <div className="px-2 flex flex-col gap-0.5 flex-1">
        <p className="px-2 mb-1.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          Conversations
        </p>

        {/* New Chat Button */}
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors border border-[var(--border-default)] hover:border-[var(--accent)]/30 w-full"
          aria-label="Start a new chat conversation"
        >
          <Plus size={12} />
          <span>New Chat</span>
        </button>

        {/* Conversation List */}
        {recentConversations.length > 0 && (
          <div className="mt-1.5 max-h-[200px] overflow-y-auto scrollbar-thin" role="list" aria-label="Recent conversations">
            {recentConversations.map((conv) => {
              const isActive = activeConversationId === conv.id && pathname.startsWith("/chat");
              return (
                <div
                  key={conv.id}
                  onClick={() => handleConversationClick(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleConversationClick(conv.id);
                  }}
                  role="listitem"
                  tabIndex={0}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer transition-colors group",
                    isActive
                      ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                  )}
                  title={conv.title}
                >
                  <span className="flex-1 truncate text-xs">{conv.title}</span>
                  <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 opacity-70">
                    {getRelativeTime(conv.createdAt)}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeConversation(conv.id); }}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-red-400"
                    aria-label="Delete conversation"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom: Profile + Settings */}
      <div className="px-2 pt-4 border-t border-[var(--border-subtle)]">
        {/* Profile card */}
        <Link href="/profile" className="block mb-2">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-[var(--bg-tertiary)] flex items-center justify-center flex-shrink-0">
              {avatar ? (
                <img src={avatar} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-semibold text-[var(--text-secondary)]">
                  {user?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                {user?.full_name || 'User'}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] truncate">
                {user?.email || ''}
              </p>
            </div>
          </div>
        </Link>
        <Link href="/settings" prefetch={true} aria-label="Open settings">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
            <Settings size={16} />
            <span>Settings</span>
          </div>
        </Link>
        <button
          id="logout-btn"
          onClick={() => {
            useAuthStore.getState().logout();
            router.push('/login');
          }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-[var(--text-secondary)] hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer w-full"
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </div>
    </motion.aside>
  );
}
