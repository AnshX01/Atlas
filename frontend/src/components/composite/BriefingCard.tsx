"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Mail, GitPullRequest, AlertCircle, Calendar, FileText, Zap,
  ChevronDown, ChevronUp, Check, ExternalLink,
} from "lucide-react";
import { SourceBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export interface BriefingItemData {
  id: string;
  type: "email" | "pr" | "issue" | "calendar" | "document" | "task";
  title: string;
  summary: string;
  source: string;
  priority_score: number;
  action_label?: string;
  action_url?: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

interface BriefingCardProps {
  item: BriefingItemData;
  index: number;
  onAction?: (item: BriefingItemData) => void;
  onExpand?: (item: BriefingItemData) => void;
}

const typeConfig: Record<
  BriefingItemData["type"],
  { icon: React.ReactNode; color: string; bgColor: string }
> = {
  email:    { icon: <Mail size={16} />,           color: "text-blue-400",   bgColor: "bg-blue-400/10" },
  pr:       { icon: <GitPullRequest size={16} />, color: "text-purple-400", bgColor: "bg-purple-400/10" },
  issue:    { icon: <AlertCircle size={16} />,    color: "text-orange-400", bgColor: "bg-orange-400/10" },
  calendar: { icon: <Calendar size={16} />,       color: "text-green-400",  bgColor: "bg-green-400/10" },
  document: { icon: <FileText size={16} />,       color: "text-slate-400",  bgColor: "bg-slate-400/10" },
  task:     { icon: <Zap size={16} />,            color: "text-yellow-400", bgColor: "bg-yellow-400/10" },
};

/** Generate the direct action URL based on item type and metadata */
function getActionUrl(item: BriefingItemData): string | null {
  const meta = item.metadata || {};
  // If action_url is set directly, use it
  if (item.action_url) return item.action_url;

  switch (item.type) {
    case "email": {
      // Link to Gmail message
      const msgId = meta.source_id ?? meta.msg_id;
      if (msgId) return `https://mail.google.com/mail/u/0/#inbox/${String(msgId)}`;
      return "https://mail.google.com";
    }
    case "pr": {
      const url = meta.url;
      if (url) return String(url);
      return null;
    }
    case "issue": {
      const url = meta.url;
      if (url) return String(url);
      return null;
    }
    case "calendar": {
      const eventId = meta.event_id ?? meta.source_id;
      if (eventId) return `https://calendar.google.com/calendar/event?eid=${String(eventId)}`;
      return "https://calendar.google.com";
    }
    case "task": {
      const url = meta.url;
      if (url) return String(url);
      return null;
    }
    default:
      return null;
  }
}

/** Get the action button label for the expanded view */
function getActionLabel(item: BriefingItemData): string {
  switch (item.type) {
    case "email": return "Open in Gmail";
    case "pr": return "View Pull Request";
    case "issue": return "View Issue";
    case "calendar": return "Open in Calendar";
    case "task": return "Open Task";
    case "document": return "Open Document";
    default: return "Open";
  }
}

export function BriefingCard({ item, index, onAction }: BriefingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [completed, setCompleted] = useState(false);
  const config = typeConfig[item.type] ?? typeConfig.task;
  const timeAgo = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });
  const actionUrl = getActionUrl(item);

  if (completed) {
    return (
      <motion.div
        className="p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] opacity-50"
        initial={{ opacity: 1, height: "auto" }}
        animate={{ opacity: 0.4, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
            <Check size={10} className="text-green-500" />
          </div>
          <span className="text-sm text-[var(--text-muted)] line-through">{item.title}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="briefing-card group"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.06,
        type: "spring",
        stiffness: 400,
        damping: 30,
      }}
      role="article"
      aria-label={`${item.type} from ${item.source}: ${item.title}`}
    >
      {/* Header Row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn(
            "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl",
            config.bgColor,
            config.color
          )}>
            {config.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SourceBadge source={item.source} />
              <span className="text-[11px] text-[var(--text-muted)]">
                {timeAgo}
              </span>
            </div>
            {/* Sender/repo info */}
            {item.type === "email" && item.metadata?.sender && (
              <span className="text-[11px] font-medium text-[var(--text-secondary)]">
                from {String(item.metadata.sender)}
              </span>
            )}
            {(item.type === "pr" || item.type === "issue") && item.metadata?.repo && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {String(item.metadata.repo)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1.5 line-clamp-2">
        {item.title}
      </h3>

      {/* Summary (collapsed: 2 lines, expanded: full) */}
      <p className={cn(
        "text-xs text-[var(--text-secondary)] leading-relaxed mb-3",
        !expanded && "line-clamp-2"
      )}>
        {item.summary}
      </p>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="mb-3 overflow-hidden"
          >
            <div className="p-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] space-y-3">
              {/* Email-specific: subject + sender + body preview */}
              {item.type === "email" && (
                <div className="space-y-2">
                  {item.metadata?.subject && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">Subject: </span>
                      <span className="text-[var(--text-primary)] font-medium">{String(item.metadata.subject)}</span>
                    </div>
                  )}
                  {item.metadata?.sender && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">From: </span>
                      <span className="text-[var(--text-secondary)]">
                        {item.metadata.sender_name ? `${String(item.metadata.sender_name)} <${String(item.metadata.sender)}>` : String(item.metadata.sender)}
                      </span>
                    </div>
                  )}
                  {/* Show first ~6 lines of the email body */}
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line border-t border-[var(--border-default)] pt-2 mt-2">
                    {item.summary.split("\n").slice(0, 6).join("\n") || item.title}
                  </div>
                </div>
              )}

              {/* PR/Issue: repo + number + full description */}
              {(item.type === "pr" || item.type === "issue") && (
                <div className="space-y-2">
                  {item.metadata?.repo && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">Repository: </span>
                      <span className="text-[var(--text-secondary)] font-medium">{String(item.metadata.repo)}</span>
                    </div>
                  )}
                  {item.metadata?.pr_number && (
                    <div className="text-xs text-[var(--text-muted)]">Pull Request #{String(item.metadata.pr_number)}</div>
                  )}
                  {item.metadata?.issue_number && (
                    <div className="text-xs text-[var(--text-muted)]">Issue #{String(item.metadata.issue_number)}</div>
                  )}
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line border-t border-[var(--border-default)] pt-2 mt-2">
                    {item.summary}
                  </div>
                </div>
              )}

              {/* Calendar: attendees + time */}
              {item.type === "calendar" && (
                <div className="space-y-2">
                  {item.metadata?.attendees && Array.isArray(item.metadata.attendees) && (item.metadata.attendees as string[]).length > 0 && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">Attendees: </span>
                      <span className="text-[var(--text-secondary)]">{(item.metadata.attendees as string[]).slice(0, 5).join(", ")}</span>
                    </div>
                  )}
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {item.summary}
                  </div>
                </div>
              )}

              {/* Generic fallback for other types */}
              {!["email", "pr", "issue", "calendar"].includes(item.type) && (
                <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {item.summary}
                </div>
              )}

              {/* Direct action link */}
              {actionUrl && (
                <a
                  href={actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium
                             text-[var(--accent)] bg-[var(--bg-secondary)]
                             hover:bg-[var(--accent)]/10 transition-colors"
                >
                  <ExternalLink size={12} />
                  {getActionLabel(item)}
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Buttons: Details + Completed */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          id={`expand-${item.id}`}
          onClick={() => setExpanded(!expanded)}
          rightIcon={expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          aria-label={expanded ? "Collapse details" : "Expand details"}
        >
          {expanded ? "Less" : "Details"}
        </Button>

        <button
          onClick={() => {
            setCompleted(true);
            onAction?.(item);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                     text-[var(--text-secondary)] hover:text-green-400 hover:bg-green-400/10
                     border border-[var(--border-default)] hover:border-green-400/30
                     transition-all duration-150"
          aria-label={`Mark "${item.title}" as completed`}
        >
          <Check size={12} />
          Done
        </button>
      </div>

      {/* Keyboard shortcut hint (shown for top 9 items) */}
      {index < 9 && (
        <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-60 transition-opacity">
          <kbd className="text-[10px] font-mono bg-[var(--bg-tertiary)] border border-[var(--border-default)] px-1.5 py-0.5 rounded text-[var(--text-muted)]">
            ⌘{index + 1}
          </kbd>
        </div>
      )}
    </motion.div>
  );
}
