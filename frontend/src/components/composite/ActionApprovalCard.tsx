"use client";

import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, Check, X, Loader2 } from "lucide-react";
import type { ApprovalData } from "@/lib/hooks/useWorkflow";

interface ActionApprovalCardProps {
  approval: ApprovalData;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  send_email: "Send Email",
  merge_pr: "Merge PR",
  close_issue: "Close Issue",
  post_message: "Post Message",
  create_issue: "Create Issue",
  update_issue: "Update Issue",
  delete_file: "Delete File",
  move_file: "Move File",
  create_pr: "Create Pull Request",
  approve_pr: "Approve PR",
  assign_issue: "Assign Issue",
  add_comment: "Add Comment",
  schedule_event: "Schedule Event",
  delete_event: "Delete Event",
  update_event: "Update Event",
  archive_channel: "Archive Channel",
};

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParams(params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return "";

  const entries = Object.entries(params).slice(0, 3);
  return entries
    .map(([key, value]) => {
      const label = key.replace(/_/g, " ");
      const val = typeof value === "string" ? value : JSON.stringify(value);
      const truncated = val.length > 60 ? val.slice(0, 57) + "…" : val;
      return `${label}: ${truncated}`;
    })
    .join(" · ");
}

export function ActionApprovalCard({ approval, onApprove, onReject }: ActionApprovalCardProps) {
  const { executionId, action, description, params, status } = approval;
  const isPending = status === "pending";
  const isExecuting = status === "executing";
  const isDone = status === "done" || status === "approved";
  const isRejected = status === "rejected";
  const isError = status === "error";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="my-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-tertiary)] overflow-hidden"
      role="alert"
      aria-live="polite"
      aria-label={`Action requiring approval: ${getActionLabel(action)}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-subtle)]">
        <ShieldAlert size={16} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
          Requires Approval
        </span>
      </div>

      {/* Body */}
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
          {getActionLabel(action)}
        </p>
        {description && (
          <p className="text-xs text-[var(--text-secondary)] mb-2">{description}</p>
        )}
        {params && (
          <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">
            {formatParams(params)}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
        <AnimatePresence mode="wait">
          {isPending && (
            <motion.div
              key="actions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              <button
                onClick={() => onApprove(executionId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                aria-label="Approve action"
              >
                <Check size={14} />
                Approve
              </button>
              <button
                onClick={() => onReject(executionId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                aria-label="Reject action"
              >
                <X size={14} />
                Reject
              </button>
            </motion.div>
          )}

          {isExecuting && (
            <motion.div
              key="executing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-center gap-2 py-2"
            >
              <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
              <span className="text-xs text-[var(--text-secondary)]">Executing…</span>
            </motion.div>
          )}

          {isDone && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-2 py-2"
            >
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check size={12} className="text-green-400" />
              </div>
              <span className="text-xs text-green-400 font-medium">Action completed</span>
            </motion.div>
          )}

          {isRejected && (
            <motion.div
              key="rejected"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-2 py-2"
            >
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <X size={12} className="text-red-400" />
              </div>
              <span className="text-xs text-red-400 font-medium">Action rejected</span>
            </motion.div>
          )}

          {isError && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center justify-center gap-2 py-2"
            >
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <X size={12} className="text-red-400" />
              </div>
              <span className="text-xs text-red-400 font-medium">
                Error: {approval.error || "Action failed"}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
