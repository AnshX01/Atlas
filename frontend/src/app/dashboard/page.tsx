"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Plug, Calendar, Activity, ArrowRight, Mail, GitPullRequest, FileText, LayoutDashboard, Settings, MessageSquare, AlertCircle } from "lucide-react";
import {
  GmailLogo,
  GoogleLogo,
  GoogleTasksLogo,
  GitHubLogo,
  SlackLogo,
  NotionLogo,
  LocalFilesLogo,
  JiraLogo,
  LinearLogo,
} from "@/components/icons/ProviderLogos";
import { useRouter } from "next/navigation";
import { connectorsAPI } from "@/lib/api/connectors";
import { briefingAPI } from "@/lib/api/briefing";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { DashboardStatusSkeleton, ActivityItemSkeleton } from "@/components/ui/Skeleton";
import { AgentDesignSystemShell } from "@/components/ui/AgentDesignSystemShell";

// ── Quick Action Card ─────────────────────────────────────────────────────────
function QuickActionCard({
  icon,
  label,
  description,
  onClick,
  delay,
  prefetchHref,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
  delay: number;
  prefetchHref?: string;
}) {
  const cardRouter = useRouter();
  return (
    <AgentDesignSystemShell
      onClick={onClick}
      onMouseEnter={() => { if (prefetchHref) cardRouter.prefetch(prefetchHref); }}
      className="p-4 cursor-pointer text-left"
      contentClassName="flex flex-col gap-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 400, damping: 30 }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      role="button"
    >
      <span className="text-[var(--accent)]">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
    </AgentDesignSystemShell>
  );
}

function getActivityLogo(source?: string, type?: string) {
  const s = (source || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (s.includes("gmail") || t === "email") return <GmailLogo size={16} />;
  if (s.includes("github") || t === "pr" || t === "issue") return <GitHubLogo size={16} className="text-[#181717] dark:text-white" />;
  if (s.includes("slack")) return <SlackLogo size={16} />;
  if (s.includes("notion")) return <NotionLogo size={16} className="text-[#000000] dark:text-white" />;
  if (s.includes("calendar")) return <GoogleLogo size={16} />;
  if (s.includes("tasks") || t === "task") return <GoogleTasksLogo size={16} />;
  if (s.includes("filesystem") || s.includes("local")) return <LocalFilesLogo size={16} className="text-amber-400" />;
  if (s.includes("jira")) return <JiraLogo size={16} />;
  if (s.includes("linear")) return <LinearLogo size={16} />;
  if (t === "document" || t === "file") return <FileText size={16} className="text-[var(--text-secondary)]" />;
  return <Activity size={16} className="text-[var(--text-secondary)]" />;
}

function getSourceDisplayName(source?: string, type?: string) {
  const s = (source || "").toLowerCase();
  const t = (type || "").toLowerCase();
  if (s.includes("gmail") || s.includes("calendar") || s.includes("tasks") || s.includes("google") || t === "email") return "Google Workspace";
  if (s.includes("github") || t === "pr" || t === "issue") return "GitHub";
  if (s.includes("slack")) return "Slack";
  if (s.includes("notion")) return "Notion";
  if (s.includes("filesystem") || s.includes("local")) return "Local Files";
  if (s.includes("jira")) return "Jira";
  if (s.includes("linear")) return "Linear";
  return source ? source.charAt(0).toUpperCase() + source.slice(1) : "Integration";
}

// ── Provider Display Names ────────────────────────────────────────────────────
const providerDisplayNames: Record<string, string> = {
  google_workspace: "Google Workspace",
  github: "GitHub",
  local_fs: "Local Files",
  slack: "Slack",
  notion: "Notion",
  jira: "Jira",
  linear: "Linear",
};

// ── Provider Icons ────────────────────────────────────────────────────────────
const providerIcons: Record<string, React.ReactNode> = {
  google_workspace: <GoogleLogo size={15} />,
  github: <GitHubLogo size={15} />,
  local_fs: <LocalFilesLogo size={15} />,
  slack: <SlackLogo size={15} />,
  notion: <NotionLogo size={15} />,
  jira: <JiraLogo size={15} />,
  linear: <LinearLogo size={15} />,
};

// ── Time-aware Greeting ───────────────────────────────────────────────────────
const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

// ── Main Dashboard Page ───────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: connectors, isLoading: connectorsLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const { data: briefing, isLoading: briefingLoading } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: () => briefingAPI.getDaily(),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const firstName = user?.full_name?.split(" ")[0] || "User";
  const connectedCount = connectors?.filter((c) => c.status === "active").length ?? 0;
  const recentItems = briefing?.items?.slice(0, 4) ?? [];

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">
          {today}
        </p>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          {getGreeting()}, {firstName}
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Your workspace at a glance.
        </p>
      </motion.div>

      {/* Sync Status */}
      {connectors && connectors.filter((c) => c.status === "active").length > 0 && (
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 30 }}
        >
          <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
            Sync Status
          </h2>
          <div className="flex flex-col gap-1.5">
            {connectors
              .filter((c) => c.status === "active")
              .map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
                >
                  <div className="w-7 h-7 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                    {providerIcons[c.provider] ?? <Plug size={15} className="text-[var(--text-muted)]" />}
                  </div>
                  <span className="text-sm text-[var(--text-primary)] flex-1">
                    {providerDisplayNames[c.provider] ?? c.provider}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-primary)]" />
                  <span className="text-xs text-[var(--text-muted)]">Active</span>
                </div>
              ))}
          </div>
        </motion.div>
      )}

      {/* Quick Actions */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
      >
        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
          Quick Actions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <QuickActionCard
            icon={<LayoutDashboard size={16} className="text-[var(--accent)]" />}
            label="View Briefing"
            description="Today's priorities"
            onClick={() => router.push("/briefing")}
            delay={0.25}
            prefetchHref="/briefing"
          />
          <QuickActionCard
            icon={<MessageSquare size={16} className="text-[var(--accent)]" />}
            label="AI Chat"
            description="Ask anything"
            onClick={() => router.push("/chat")}
            delay={0.3}
            prefetchHref="/chat"
          />
          <QuickActionCard
            icon={<Settings size={16} className="text-[var(--accent)]" />}
            label="Settings"
            description="Integrations & prefs"
            onClick={() => router.push("/settings")}
            delay={0.35}
            prefetchHref="/settings"
          />
        </div>
      </motion.div>

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, type: "spring", stiffness: 400, damping: 30 }}
      >
        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">
          Recent Activity
        </h2>

        {briefingLoading ? (
          <div className="flex flex-col gap-2" aria-live="polite" aria-label="Loading activity...">
            {Array.from({ length: 4 }).map((_, i) => (
              <ActivityItemSkeleton key={i} />
            ))}
          </div>
        ) : recentItems.length === 0 ? (
          <div className="p-6 rounded-2xl bg-[var(--bg-secondary)] text-center">
            <Activity size={20} className="text-[var(--text-muted)] mx-auto mb-2" />
            {connectedCount > 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">
                No recent activity. Try asking Atlas in the AI Chat.
              </p>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                No recent activity yet. Connect an integration to get started.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {recentItems.map((item, index) => {
              const timeAgo = item.timestamp
                ? (() => {
                    try {
                      return formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });
                    } catch {
                      return "";
                    }
                  })()
                : "";

              return (
                <AgentDesignSystemShell
                  key={item.id}
                  className="p-4 cursor-pointer group hover:border-[var(--accent)]/40 transition-all text-left"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.45 + index * 0.05 }}
                  onClick={() => item.action_url ? window.open(item.action_url, '_blank') : router.push("/briefing")}
                  whileHover={{ y: -1 }}
                  role="article"
                >
                  {/* Top: Source Icon, Source Name, Time Ago */}
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex items-center justify-center shrink-0">
                        {getActivityLogo(item.source, item.type)}
                      </div>
                      <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">
                        {getSourceDisplayName(item.source, item.type)}
                      </span>
                    </div>
                    {timeAgo && (
                      <span className="text-[11px] text-[var(--text-muted)] shrink-0 font-medium">
                        {timeAgo}
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug line-clamp-1 group-hover:text-[var(--accent)] transition-colors">
                    {item.title}
                  </p>

                  {/* Summary / Snippet */}
                  {item.summary && (
                    <p className="text-xs text-[var(--text-muted)] line-clamp-1 mt-0.5 leading-relaxed">
                      {item.summary}
                    </p>
                  )}
                </AgentDesignSystemShell>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
