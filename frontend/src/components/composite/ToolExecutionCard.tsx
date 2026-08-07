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
} from "@/components/icons/ProviderLogos";
import type { ToolExecution } from "@/lib/hooks/useWorkflow";

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

const SERVER_ICONS: Record<string, React.ReactNode> = {
  google: <GoogleLogo size={14} />,
  google_workspace: <GoogleLogo size={14} />,
  gmail: <GoogleLogo size={14} />,
  calendar: <GoogleLogo size={14} />,
  github: <GitHubLogo size={14} />,
  slack: <SlackLogo size={14} />,
  notion: <NotionLogo size={14} />,
  local_fs: <LocalFilesLogo size={14} />,
  filesystem: <LocalFilesLogo size={14} />,
  jira: <JiraLogo size={14} />,
  linear: <LinearLogo size={14} />,
};

function getServerIcon(server: string): React.ReactNode {
  const normalized = server.toLowerCase().replace(/[-_\s]/g, "_");
  for (const [key, icon] of Object.entries(SERVER_ICONS)) {
    if (normalized.includes(key)) return icon;
  }
  return <Wrench size={14} className="text-[var(--text-muted)]" />;
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
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="flex items-center gap-2.5 px-3 py-2 my-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]"
      role="status"
      aria-label={`Tool execution: ${formatToolName(tool)} — ${status}`}
    >
      {/* Server Icon */}
      <div className="flex-shrink-0 w-6 h-6 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
        {getServerIcon(server)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">
            {formatToolName(tool)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)] truncate">
            {server}
          </span>
        </div>
        {params && Object.keys(params).length > 0 && (
          <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5 font-mono">
            {formatBriefParams(params)}
          </p>
        )}
        {isDone && result && (
          <p className="text-[10px] text-[var(--text-secondary)] truncate mt-0.5">
            {result.length > 80 ? result.slice(0, 77) + "…" : result}
          </p>
        )}
      </div>

      {/* Status Indicator */}
      <div className="flex-shrink-0">
        {isLoading && (
          <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
        )}
        {isDone && (
          <CheckCircle2 size={14} className="text-green-400" />
        )}
        {isError && (
          <AlertCircle size={14} className="text-red-400" />
        )}
      </div>
    </motion.div>
  );
}
