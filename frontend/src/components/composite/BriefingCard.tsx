"use client";

import { motion } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { Mail, GitPullRequest, AlertCircle, Calendar, FileText, Zap, ChevronRight } from "lucide-react";
import { PriorityBadge, SourceBadge } from "@/components/ui/Badge";
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
  { icon: React.ReactNode; color: string }
> = {
  email:    { icon: <Mail size={16} />,          color: "text-blue-400" },
  pr:       { icon: <GitPullRequest size={16} />, color: "text-purple-400" },
  issue:    { icon: <AlertCircle size={16} />,    color: "text-orange-400" },
  calendar: { icon: <Calendar size={16} />,       color: "text-green-400" },
  document: { icon: <FileText size={16} />,       color: "text-slate-400" },
  task:     { icon: <Zap size={16} />,            color: "text-yellow-400" },
};

export function BriefingCard({ item, index, onAction, onExpand }: BriefingCardProps) {
  const config = typeConfig[item.type] ?? typeConfig.task;
  const timeAgo = formatDistanceToNow(new Date(item.timestamp), { addSuffix: true });

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
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn(
            "flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl",
            "bg-[var(--bg-tertiary)]",
            config.color
          )}>
            {config.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SourceBadge source={item.source} />
              <span className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
                {timeAgo}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-shrink-0">
          <PriorityBadge score={item.priority_score} />
        </div>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1.5 line-clamp-2">
        {item.title}
      </h3>

      {/* Summary */}
      <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2 mb-3">
        {item.summary}
      </p>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {item.action_label && (
          <Button
            size="sm"
            variant="primary"
            id={`action-${item.id}`}
            onClick={() => onAction?.(item)}
            aria-label={`${item.action_label} for: ${item.title}`}
          >
            {item.action_label}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          id={`expand-${item.id}`}
          onClick={() => onExpand?.(item)}
          rightIcon={<ChevronRight size={12} />}
          aria-label={`Expand details for: ${item.title}`}
        >
          Details
        </Button>
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
