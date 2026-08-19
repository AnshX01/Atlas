"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import {
  FileText, AlertCircle, ChevronUp, ChevronDown, Check, ExternalLink, MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { AgentDesignSystemShell } from "@/components/ui/AgentDesignSystemShell";
import { 
  GmailLogo, GitHubLogo, GoogleLogo, GoogleTasksLogo, 
  SlackLogo, NotionLogo, LocalFilesLogo, JiraLogo, LinearLogo 
} from "@/components/icons/ProviderLogos";

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
  onDone?: (item: BriefingItemData) => void;
  onExpand?: (item: BriefingItemData) => void;
}

function getProviderLogo(source: string, type: string) {
  const s = source.toLowerCase();
  if (s.includes("gmail") || type === "email") return <GmailLogo size={16} />;
  if (s.includes("github") || type === "pr" || type === "issue") return <GitHubLogo size={16} className="text-[#181717] dark:text-white" />;
  if (s.includes("slack")) return <SlackLogo size={16} />;
  if (s.includes("notion")) return <NotionLogo size={16} className="text-[#000000] dark:text-white" />;
  if (s.includes("calendar")) return <GoogleLogo size={16} />;
  if (s.includes("tasks") || type === "task") return <GoogleTasksLogo size={16} />;
  if (s.includes("filesystem") || s.includes("local")) return <LocalFilesLogo size={16} className="text-amber-400" />;
  if (s.includes("jira")) return <JiraLogo size={16} />;
  if (s.includes("linear")) return <LinearLogo size={16} />;
  
  if (type === "document") return <FileText size={16} className="text-[var(--text-secondary)]" />;
  return <AlertCircle size={16} className="text-[var(--text-secondary)]" />;
}

function getActionUrl(item: BriefingItemData): string | null {
  const meta = item.metadata || {};
  if (item.action_url) return item.action_url;

  switch (item.type) {
    case "email": {
      const msgId = meta.source_id ?? meta.msg_id;
      if (msgId) return `https://mail.google.com/mail/u/0/#inbox/${String(msgId)}`;
      return "https://mail.google.com";
    }
    case "pr":
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

export function BriefingCard({ item, index, onDone }: BriefingCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const timeAgo = (() => {
    if (!isMounted) return "";
    try {
      return formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });
    } catch {
      return "";
    }
  })();
  const actionUrl = getActionUrl(item);

  return (
    <AgentDesignSystemShell
      className="p-5"
      initial={{ opacity: 0, scale: 0.98, y: 15 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: index * 0.05, type: "spring", stiffness: 400, damping: 30 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      layout
      role="article"
      aria-label={`${item.type} from ${item.source}: ${item.title}`}
    >
      {/* Header: icon + source + time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center shrink-0">
            {getProviderLogo(item.source, item.type)}
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
            {item.source === "gmail" ? "Google Workspace" : item.source === "github" ? "GitHub" : item.source === "calendar" ? "Google Workspace" : item.source === "tasks" ? "Google Workspace" : item.source === "slack" ? "Slack" : item.source === "notion" ? "Notion" : item.source === "filesystem" ? "Local Files" : (item.source ? item.source.charAt(0).toUpperCase() + item.source.slice(1) : "Unknown")}
          </span>
        </div>
        <span className="text-xs text-[var(--text-muted)] font-medium">{timeAgo}</span>
      </div>

      <h3 className="text-base font-semibold text-[var(--text-primary)] leading-snug line-clamp-2 mb-2">
        {item.title}
      </h3>

      {/* Meta context (e.g. sender, repo) */}
      {(item.type === "email" && !!item.metadata?.sender) || ((item.type === "pr" || item.type === "issue") && !!item.metadata?.repo) ? (
        <div className="flex items-center gap-2 mb-2">
            {item.type === "email" && !!item.metadata?.sender && (
              <span className="text-[12px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md">
                From: {String(item.metadata.sender).split('<')[0].trim()}
              </span>
            )}
            {(item.type === "pr" || item.type === "issue") && !!item.metadata?.repo && (
              <span className="text-[12px] font-medium text-[var(--text-secondary)] bg-[var(--bg-tertiary)] px-2 py-0.5 rounded-md">
                Repo: {String(item.metadata.repo)}
              </span>
            )}
          </div>
        ) : null}

      {/* Summary */}
      <p className={cn(
        "text-[14px] text-[var(--text-secondary)] leading-relaxed mb-4",
          !expanded && "line-clamp-2"
        )}>
          {item.summary}
        </p>

        <AnimatePresence>
          {expanded && (
            <motion.div key="expanded-briefing"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="mb-4 overflow-hidden"
            >
            <div className="p-4 rounded-xl bg-[var(--bg-tertiary)]/50 space-y-3 backdrop-blur-sm">
                {item.type === "email" && (
                  <div className="space-y-2">
                    {!!item.metadata?.subject && (
                      <div className="text-sm">
                        <span className="text-[var(--text-muted)]">Subject: </span>
                        <span className="text-[var(--text-primary)] font-medium">{String(item.metadata.subject)}</span>
                      </div>
                    )}
                    {!!item.metadata?.sender && (
                      <div className="text-sm">
                        <span className="text-[var(--text-muted)]">From: </span>
                        <span className="text-[var(--text-secondary)]">
                          {item.metadata.sender_name ? `${String(item.metadata.sender_name)} <${String(item.metadata.sender)}>` : String(item.metadata.sender)}
                        </span>
                      </div>
                    )}
                    <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line pt-3 mt-3">
                      {item.summary.split("\n").slice(0, 8).join("\n") || item.title}
                    </div>
                  </div>
                )}

                {(item.type === "pr" || item.type === "issue") && (
                  <div className="space-y-2">
                    {!!item.metadata?.repo && (
                      <div className="text-sm">
                        <span className="text-[var(--text-muted)]">Repository: </span>
                        <span className="text-[var(--text-secondary)] font-medium">{String(item.metadata.repo)}</span>
                      </div>
                    )}
                    {!!item.metadata?.pr_number && (
                      <div className="text-sm text-[var(--text-muted)]">Pull Request #{String(item.metadata.pr_number)}</div>
                    )}
                    {!!item.metadata?.issue_number && (
                      <div className="text-sm text-[var(--text-muted)]">Issue #{String(item.metadata.issue_number)}</div>
                    )}
                    <div className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line pt-3 mt-3">
                      {item.summary}
                    </div>
                  </div>
                )}

                {item.type === "calendar" && (
                  <div className="space-y-2">
                    {!!item.metadata?.attendees && Array.isArray(item.metadata.attendees) && (item.metadata.attendees as string[]).length > 0 && (
                      <div className="text-sm">
                        <span className="text-[var(--text-muted)]">Attendees: </span>
                        <span className="text-[var(--text-secondary)]">{(item.metadata.attendees as string[]).slice(0, 5).join(", ")}</span>
                      </div>
                    )}
                    <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      {item.summary}
                    </div>
                  </div>
                )}

                {!["email", "pr", "issue", "calendar"].includes(item.type) && (
                  <div className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {item.summary}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              onDone?.(item);
            }}
            leftIcon={<Check size={14} />}
            className="hover:-translate-y-0.5 transition-all"
            aria-label={`Mark "${item.title}" as completed`}
          >
            Done
          </Button>

          {item.type === "email" && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<MessageSquare size={14} />}
              onClick={() => {
                const subject = item.metadata?.subject || item.title;
                const sender = item.metadata?.sender_name || item.metadata?.sender || item.source;
                const msg = `Draft a reply to the email "${subject}" from ${sender}`;
                router.push(`/chat?q=${encodeURIComponent(msg)}`);
              }}
              className="hover:-translate-y-0.5 transition-all"
            >
              Reply
            </Button>
          )}

          {actionUrl && item.type !== "email" && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<ExternalLink size={14} />}
              onClick={() => window.open(actionUrl, "_blank")}
              className="hover:-translate-y-0.5 transition-all"
            >
              {getActionLabel(item)}
            </Button>
          )}

          <div className="flex-1" />

          <Button
            size="sm"
            variant="ghost"
            id={`expand-${item.id}`}
            onClick={() => setExpanded(!expanded)}
            rightIcon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            aria-label={expanded ? "Collapse details" : "Expand details"}
          >
            {expanded ? "Less" : "Details"}
          </Button>
        </div>
    </AgentDesignSystemShell>
  );
}
