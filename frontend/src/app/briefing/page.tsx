"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Zap, TrendingUp, AlertTriangle } from "lucide-react";
import { BriefingCard } from "@/components/composite/BriefingCard";
import { BriefingCardSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useBriefingStore } from "@/lib/store/useBriefingStore";
import { useKeyboardShortcuts } from "@/lib/shortcuts/useKeyboardShortcuts";
import { briefingAPI } from "@/lib/api/briefing";
import { cn } from "@/lib/utils";
import type { BriefingItemData } from "@/components/composite/BriefingCard";

// ── Focus Score Ring ─────────────────────────────────────────────────────────
function FocusScoreRing({ score, label }: { score: number; label: string }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = (score / 100) * circumference;

  const strokeColor =
    score >= 80 ? "#ef4444" :
    score >= 55 ? "#f97316" :
    score >= 30 ? "#eab308" : "#22c55e";

  return (
    <div className="flex items-center gap-5">
      <div className="focus-ring-container" role="img" aria-label={`Focus score: ${score} out of 100`}>
        <svg className="focus-ring-svg" width={120} height={120} viewBox="0 0 120 120">
          <circle className="focus-ring-track" cx={60} cy={60} r={radius} />
          <motion.circle
            className="focus-ring-fill"
            cx={60} cy={60} r={radius}
            stroke={strokeColor}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - strokeDash }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            className="text-2xl font-bold text-[var(--text-primary)] leading-none"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
          >
            {score}
          </motion.span>
          <span className="text-[10px] text-[var(--text-muted)] font-medium mt-0.5">
            FOCUS
          </span>
        </div>
      </div>

      <div>
        <motion.p
          className="text-sm font-semibold text-[var(--text-primary)]"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4 }}
        >
          {label}
        </motion.p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Today's cognitive load index
        </p>
      </div>
    </div>
  );
}

// ── Stats Strip ───────────────────────────────────────────────────────────────
function StatsStrip({ items }: { items: BriefingItemData[] }) {
  const urgent = items.filter((i) => i.priority_score >= 90).length;
  const high = items.filter((i) => i.priority_score >= 70 && i.priority_score < 90).length;

  return (
    <div className="grid grid-cols-3 gap-3">
      {[
        { label: "Total Items", value: items.length, color: "text-[var(--text-primary)]", icon: <TrendingUp size={14} /> },
        { label: "Urgent",      value: urgent,        color: "text-red-400",               icon: <AlertTriangle size={14} /> },
        { label: "High",        value: high,          color: "text-orange-400",            icon: <Zap size={14} /> },
      ].map((stat, i) => (
        <motion.div
          key={stat.label}
          className="p-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-default)] flex flex-col gap-1"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 + i * 0.08, type: "spring", stiffness: 400, damping: 30 }}
        >
          <div className={cn("flex items-center gap-1.5 text-xs font-medium", stat.color)}>
            {stat.icon}
            <span>{stat.label}</span>
          </div>
          <span className={cn("text-2xl font-bold leading-none", stat.color)}>
            {stat.value}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Empty State ────────────────────────────────────────────────────────────────
function EmptyBriefing() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-20 text-center"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mb-4">
        <Zap size={28} className="text-[var(--accent)]" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        You're all caught up ✨
      </h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs leading-relaxed mb-6">
        No high-priority items right now. Connect your first integration to get started.
      </p>
      <Button variant="primary" id="connect-first-integration">
        Connect an Integration
      </Button>
    </motion.div>
  );
}

// ── Error State ────────────────────────────────────────────────────────────────
function BriefingError({ onRetry }: { onRetry: () => void }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-20 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        Atlas encountered an anomaly loading your briefing.
      </p>
      <div className="flex gap-3">
        <Button variant="primary" id="briefing-retry-btn" onClick={onRetry}>
          Retry
        </Button>
        <Button variant="ghost" id="briefing-manual-search-btn">
          Perform Manual Search
        </Button>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BriefingPage() {
  useKeyboardShortcuts();
  const { setBriefing, setLoading, setError, items, focusScore, focusScoreLabel, loading, error } =
    useBriefingStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: briefingAPI.getDaily,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (isLoading) { setLoading(true); return; }
    if (isError)   { setError("Failed to load briefing"); return; }
    if (data)      { setBriefing(data); }
  }, [data, isLoading, isError, setBriefing, setLoading, setError]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
            {today}
          </p>
          <Button
            size="sm"
            variant="ghost"
            id="refresh-briefing-btn"
            onClick={() => refetch()}
            isLoading={isLoading}
            leftIcon={<RefreshCw size={12} />}
            aria-label="Refresh briefing"
          >
            Refresh
          </Button>
        </div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          Good morning, Alex
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Here's what needs your attention today.
        </p>
      </motion.div>

      {/* Focus Score + Stats */}
      {!isLoading && !isError && (
        <motion.div
          className="p-5 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] mb-6 flex flex-col gap-5"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1, type: "spring", stiffness: 400, damping: 30 }}
        >
          <FocusScoreRing score={focusScore} label={focusScoreLabel || "Calculating…"} />
          {items.length > 0 && <StatsStrip items={items} />}
        </motion.div>
      )}

      {/* Loading Skeletons */}
      {isLoading && (
        <div className="flex flex-col gap-3" aria-live="polite" aria-label="Loading briefing...">
          {Array.from({ length: 3 }).map((_, i) => (
            <BriefingCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error State */}
      {isError && <BriefingError onRetry={refetch} />}

      {/* Briefing Items */}
      {!isLoading && !isError && (
        <AnimatePresence mode="popLayout">
          {items.length === 0 ? (
            <EmptyBriefing key="empty" />
          ) : (
            <div
              className="flex flex-col gap-3"
              role="feed"
              aria-label="Today's briefing items"
              aria-live="polite"
            >
              {items.map((item, index) => (
                <BriefingCard
                  key={item.id}
                  item={item}
                  index={index}
                  onAction={(item) => {
                    useBriefingStore.getState().markItemActioned(item.id);
                  }}
                />
              ))}
            </div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
