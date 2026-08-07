"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Zap } from "lucide-react";
import { BriefingCard } from "@/components/composite/BriefingCard";
import { BriefingCardSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useBriefingStore } from "@/lib/store/useBriefingStore";
import { useRouter } from "next/navigation";
import { useKeyboardShortcuts } from "@/lib/shortcuts/useKeyboardShortcuts";
import { briefingAPI } from "@/lib/api/briefing";
import { connectorsAPI } from "@/lib/api/connectors";
import { useAuthStore } from "@/lib/store/useAuthStore";

// ── Empty State ────────────────────────────────────────────────────────────────
function EmptyBriefing() {
  const router = useRouter();
  const { data: connectors } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
  });
  const activeConnectors = connectors?.filter((c) => c.status === "active") ?? [];
  const hasConnectors = activeConnectors.length > 0;

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
        {hasConnectors ? "You're all caught up" : "Get Started with Atlas"}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs leading-relaxed mb-6">
        {hasConnectors
          ? "No high-priority items right now. Your inbox is clear!"
          : "Connect your first integration to get started."}
      </p>
      {!hasConnectors && (
        <Button variant="primary" id="connect-first-integration" onClick={() => router.push("/settings")}>
          Connect an Integration
        </Button>
      )}
    </motion.div>
  );
}

// ── Error State ────────────────────────────────────────────────────────────────
function BriefingError({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
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
        <Button variant="ghost" id="briefing-manual-search-btn" onClick={() => router.push("/search")}>
          Perform Manual Search
        </Button>
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BriefingPage() {
  useKeyboardShortcuts();
  const { user } = useAuthStore();
  const { setBriefing, setLoading, setError, items, isDismissed, dismissItem } =
    useBriefingStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: briefingAPI.getDaily,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });

  useEffect(() => {
    if (isLoading) { setLoading(true); return; }
    if (isError)   { setError("Failed to load briefing"); return; }
    if (data)      { setBriefing(data); }
  }, [data, isLoading, isError, setBriefing, setLoading, setError]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const visibleItems = items.filter((item) => !isDismissed(item.id));

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
          {getGreeting()}, {user?.full_name?.split(' ')[0] || "User"}
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Here's what needs your attention today.
        </p>
      </motion.div>

      {/* Items count */}
      {!isLoading && !isError && visibleItems.length > 0 && (
        <motion.div
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <p className="text-xs text-[var(--text-muted)]">
            {visibleItems.length} item{visibleItems.length !== 1 ? "s" : ""} for today
          </p>
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
          {visibleItems.length === 0 ? (
            <EmptyBriefing key="empty" />
          ) : (
            <div
              className="flex flex-col gap-3"
              role="feed"
              aria-label="Today's briefing items"
              aria-live="polite"
            >
              {visibleItems.map((item, index) => (
                <BriefingCard
                  key={item.id}
                  item={item}
                  index={index}
                  onAction={(item) => {
                    dismissItem(item.id);
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
