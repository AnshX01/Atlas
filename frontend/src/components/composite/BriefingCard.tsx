"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import {
  Mail, GitPullRequest, AlertCircle, Calendar, FileText, Zap,
  ChevronDown, ChevronUp, Check, ExternalLink,
} from "lucide-react";
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
  email:    { icon: <Mail size={16} />,           color: "text-white/70",   bgColor: "bg-white/[0.06]" },
  pr:       { icon: <GitPullRequest size={16} />, color: "text-white/70", bgColor: "bg-white/[0.06]" },
  issue:    { icon: <AlertCircle size={16} />,    color: "text-white/70", bgColor: "bg-white/[0.06]" },
  calendar: { icon: <Calendar size={16} />,       color: "text-white/70",  bgColor: "bg-white/[0.06]" },
  document: { icon: <FileText size={16} />,       color: "text-white/70",  bgColor: "bg-white/[0.06]" },
  task:     { icon: <Zap size={16} />,            color: "text-white/70", bgColor: "bg-white/[0.06]" },
};

function getActionUrl(item: BriefingItemData): string | null {
  const meta = item.metadata || {};
  if (item.action_url) return item.action_url;

  switch (item.type) {
    case "email": {
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
  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });
    } catch {
      return "";
    }
  })();
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
          <div className="w-5 h-5 rounded-full bg-white/10 border-2 border-white/40 flex items-center justify-center">
            <Check size={10} className="text-white/70" />
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
      {/* Header: icon + source + time */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-white/40">
          {config.icon}
        </span>
        <span className="text-[12px] font-medium text-white/50">
          {item.source === "gmail" ? "Google Workspace" : item.source === "github" ? "GitHub" : item.source === "calendar" ? "Google Workspace" : item.source === "tasks" ? "Google Workspace" : item.source === "slack" ? "Slack" : item.source === "notion" ? "Notion" : item.source === "filesystem" ? "Local Files" : item.source?.charAt(0).toUpperCase() + item.source?.slice(1)}
        </span>
        {item.type === "email" && !!item.metadata?.sender && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-[12px] text-white/40">{String(item.metadata.sender).split('<')[0].trim()}</span>
          </>
        )}
        {(item.type === "pr" || item.type === "issue") && !!item.metadata?.repo && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-[12px] text-white/40">{String(item.metadata.repo)}</span>
          </>
        )}
        <span className="text-[11px] text-white/25 ml-auto">{timeAgo}</span>
      </div>

      {/* Title */}
      <h3 className="text-[14px] font-medium text-white/90 leading-snug mb-1.5 line-clamp-2">
        {item.title}
      </h3>

      {/* Summary */}
      <p className={cn(
        "text-[12px] text-white/45 leading-relaxed mb-3",
        !expanded && "line-clamp-2"
      )}>
        {item.summary}
      </p>

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
              {item.type === "email" && (
                <div className="space-y-2">
                  {!!item.metadata?.subject && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">Subject: </span>
                      <span className="text-[var(--text-primary)] font-medium">{String(item.metadata.subject)}</span>
                    </div>
                  )}
                  {!!item.metadata?.sender && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">From: </span>
                      <span className="text-[var(--text-secondary)]">
                        {item.metadata.sender_name ? `${String(item.metadata.sender_name)} <${String(item.metadata.sender)}>` : String(item.metadata.sender)}
                      </span>
                    </div>
                  )}
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line border-t border-[var(--border-default)] pt-2 mt-2">
                    {item.summary.split("\n").slice(0, 6).join("\n") || item.title}
                  </div>
                </div>
              )}

              {(item.type === "pr" || item.type === "issue") && (
                <div className="space-y-2">
                  {!!item.metadata?.repo && (
                    <div className="text-xs">
                      <span className="text-[var(--text-muted)]">Repository: </span>
                      <span className="text-[var(--text-secondary)] font-medium">{String(item.metadata.repo)}</span>
                    </div>
                  )}
                  {!!item.metadata?.pr_number && (
                    <div className="text-xs text-[var(--text-muted)]">Pull Request #{String(item.metadata.pr_number)}</div>
                  )}
                  {!!item.metadata?.issue_number && (
                    <div className="text-xs text-[var(--text-muted)]">Issue #{String(item.metadata.issue_number)}</div>
                  )}
                  <div className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-line border-t border-[var(--border-default)] pt-2 mt-2">
                    {item.summary}
                  </div>
                </div>
              )}

              {item.type === "calendar" && (
                <div className="space-y-2">
                  {!!item.metadata?.attendees && Array.isArray(item.metadata.attendees) && (item.metadata.attendees as string[]).length > 0 && (
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

              {!["email", "pr", "issue", "calendar"].includes(item.type) && (
                <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  {item.summary}
                </div>
              )}

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
                     text-[var(--text-secondary)] hover:text-white hover:bg-white/10
                     border border-[var(--border-default)] hover:border-white/30
                     transition-all duration-150"
          aria-label={`Mark "${item.title}" as completed`}
        >
          <Check size={12} />
          Done
        </button>
      </div>
    </motion.div>
  );
}
