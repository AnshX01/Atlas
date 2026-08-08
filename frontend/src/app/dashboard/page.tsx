"use client";

import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { Plug, Search, Zap, Calendar, Activity, ArrowRight, Mail, GitPullRequest, FileText } from "lucide-react";
import {
  GoogleLogo,
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
    <motion.button
      onClick={onClick}
      onMouseEnter={() => { if (prefetchHref) cardRouter.prefetch(prefetchHref); }}
      className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-left
                 hover:border-[var(--accent)] hover:bg-[var(--bg-tertiary)] transition-all duration-150 group flex flex-col gap-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: "spring", stiffness: 400, damping: 30 }}
      whileHover={{ y: -1, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
          {icon}
        </div>
        <ArrowRight size={14} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>
      </div>
    </motion.button>
  );
}

// ── Type Icons for Activity Items ─────────────────────────────────────────────
const typeIcons: Record<string, React.ReactNode> = {
  email: <Mail size={13} className="text-blue-400" />,
  pr: <GitPullRequest size={13} className="text-purple-400" />,
  issue: <GitPullRequest size={13} className="text-orange-400" />,
  calendar: <Calendar size={13} className="text-green-400" />,
  document: <FileText size={13} className="text-slate-400" />,
  file: <FileText size={13} className="text-slate-400" />,
  task: <Zap size={13} className="text-yellow-400" />,
};

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
    staleTime: 1000 * 60 * 5,
  });

  const { data: briefing, isLoading: briefingLoading } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: briefingAPI.getDaily,
    staleTime: 1000 * 60 * 5,
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
          Your command center at a glance.
        </p>
      </motion.div>

      {/* Status Row: Integrations */}
      {connectorsLoading ? (
        <div className="mb-6">
          <DashboardStatusSkeleton />
        </div>
      ) : (
        <motion.div
          className="p-5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] mb-6"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center">
              <Plug size={18} className="text-[var(--accent)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {connectedCount} Integration{connectedCount !== 1 ? 's' : ''} Connected
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                {connectedCount === 0 ? 'Connect your first service' : 'All systems operational'}
              </p>
            </div>
          </div>
        </motion.div>
      )}

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
                  className="flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
                >
                  <div className="w-7 h-7 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                    {providerIcons[c.provider] ?? <Plug size={15} className="text-[var(--text-muted)]" />}
                  </div>
                  <span className="text-sm text-[var(--text-primary)] flex-1">
                    {providerDisplayNames[c.provider] ?? c.provider}
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
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
        <div className="grid grid-cols-3 gap-3">
          <QuickActionCard
            icon={<Calendar size={16} className="text-[var(--accent)]" />}
            label="View Briefing"
            description="Today's priorities"
            onClick={() => router.push("/briefing")}
            delay={0.25}
            prefetchHref="/briefing"
          />
          <QuickActionCard
            icon={<Search size={16} className="text-[var(--accent)]" />}
            label="AI Chat"
            description="Ask anything"
            onClick={() => router.push("/chat")}
            delay={0.3}
            prefetchHref="/chat"
          />
          <QuickActionCard
            icon={<Zap size={16} className="text-[var(--accent)]" />}
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
          <div className="p-6 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] text-center">
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
          <div className="flex flex-col gap-2">
            {recentItems.map((item, index) => (
              <motion.div
                key={item.id}
                className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)]
                           flex items-center gap-3 hover:bg-[var(--bg-tertiary)] transition-all duration-150 cursor-pointer group"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.45 + index * 0.06 }}
                onClick={() => router.push("/briefing")}
                whileHover={{ y: -1, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
              >
                <div className="w-7 h-7 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0">
                  {typeIcons[item.type] ?? <Activity size={13} className="text-[var(--text-muted)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {item.title}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {item.source} · Priority {item.priority_score}
                  </p>
                </div>
                <ArrowRight size={12} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors shrink-0" />
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}
