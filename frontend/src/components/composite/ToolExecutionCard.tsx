"use client";

import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Wrench } from "lucide-react";
import {
  GoogleLogo,
  GitHubLogo,
  SlackLogo,
  NotionLogo,
  LocalFilesLogo,
  JiraLogo,
  LinearLogo,
  GmailLogo,
  GoogleTasksLogo,
} from "@/components/icons/ProviderLogos";
import type { ToolExecution } from "@/lib/hooks/useWorkflow";

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

const SERVER_ICONS: Record<string, React.ReactNode> = {
  google: <GoogleLogo size={16} />,
  google_workspace: <GoogleLogo size={16} />,
  gmail: <GmailLogo size={16} />,
  tasks: <GoogleTasksLogo size={16} />,
  calendar: <GoogleLogo size={16} />,
  github: <GitHubLogo size={16} className="text-[#181717] dark:text-white" />,
  slack: <SlackLogo size={16} />,
  notion: <NotionLogo size={16} className="text-[#000000] dark:text-white" />,
  local_fs: <LocalFilesLogo size={16} className="text-amber-400" />,
  filesystem: <LocalFilesLogo size={16} className="text-amber-400" />,
  jira: <JiraLogo size={16} />,
  linear: <LinearLogo size={16} />,
};

function getServerIcon(server: string): React.ReactNode {
  const normalized = server.toLowerCase().replace(/[-_\s]/g, "_");
  for (const [key, icon] of Object.entries(SERVER_ICONS)) {
    if (normalized.includes(key)) return icon;
  }
  return <Wrench size={16} className="text-[var(--text-muted)]" />;
}

function formatToolName(tool: string): string {
  return tool
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBriefParams(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";

  const entries = Object.entries(params).slice(0, 2);
  return entries
    .map(([, value]) => {
      const val = typeof value === "string" ? value : JSON.stringify(value);
      return val.length > 30 ? val.slice(0, 27) + "…" : val;
    })
    .join(", ");
}

export function ToolExecutionCard({ execution }: ToolExecutionCardProps) {
  const { server, tool, params, status, result } = execution;
  const isLoading = status === "loading";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="flex items-center gap-3 p-4 my-2 rounded-2xl border border-white/5 bg-gradient-to-br from-[var(--bg-secondary)]/80 to-[var(--bg-primary)]/40 backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] relative overflow-hidden transition-all duration-300 group hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] hover:border-[var(--accent)]/30"
      role="status"
      aria-label={`Tool execution: ${formatToolName(tool)} — ${status}`}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/0 to-transparent opacity-0 group-hover:from-[var(--accent)]/5 group-hover:opacity-100 transition-opacity duration-300" />
      
      {/* Server Icon */}
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow relative z-10">
        {getServerIcon(server)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 relative z-10 pt-0.5">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
            {formatToolName(tool)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] font-medium bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-full truncate">
            {server}
          </span>
        </div>
        {params && Object.keys(params).length > 0 && (
          <p className="text-[11px] text-[var(--text-muted)] truncate mt-1 font-mono">
            {formatBriefParams(params)}
          </p>
        )}
        {isDone && result && (
          <p className="text-[12px] text-[var(--text-secondary)] truncate mt-1">
            {result.length > 80 ? result.slice(0, 77) + "…" : result}
          </p>
        )}
      </div>

      {/* Status Indicator */}
      <div className="flex-shrink-0 relative z-10 ml-2">
        {isLoading && (
          <div className="w-5 h-5 rounded-full border-2 border-[var(--accent)]/20 border-t-[var(--accent)] animate-spin" />
        )}
        {isDone && (
          <CheckCircle2 size={18} className="text-green-400" />
        )}
        {isError && (
          <AlertCircle size={18} className="text-red-400" />
        )}
      </div>
    </motion.div>
  );
}
