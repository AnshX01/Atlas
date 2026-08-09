"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, CheckSquare } from "lucide-react";
import { BriefingCard } from "@/components/composite/BriefingCard";
import { BriefingCardSkeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { useBriefingStore } from "@/lib/store/useBriefingStore";
import { useRouter } from "next/navigation";
import { briefingAPI } from "@/lib/api/briefing";
import { connectorsAPI } from "@/lib/api/connectors";
import { useAuthStore } from "@/lib/store/useAuthStore";

// ── Empty State ────────────────────────────────────────────────────────────────
function EmptyBriefing() {
  const router = useRouter();
  const { data: connectors, isLoading: connectorsLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
  });

  if (connectorsLoading) return null;

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
        <CheckSquare size={28} className="text-[var(--accent)]" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        {hasConnectors ? "Briefing Unavailable" : "Get Started with Atlas"}
      </h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs leading-relaxed mb-6">
        {hasConnectors
          ? "Use AI Chat to query your connected data. Briefing generation requires the backend services."
          : "Connect your first integration to get started."}
      </p>
      {hasConnectors ? (
        <Button variant="primary" id="go-to-chat-btn" onClick={() => router.push("/chat")}>
          Open AI Chat
        </Button>
      ) : (
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

// ── Proactive Actions ──────────────────────────────────────────────────────────
function ProactiveActions({ items }: { items: any[] }) {
  if (items.length === 0) return null;
  const topItem = items[0];
  if ((topItem.priority_score || 0) < 60) return null; // Only show for important items
  
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, position: "absolute" }}
      transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 25 }}
      className="mb-8 p-5 rounded-2xl border border-white/10 bg-gradient-to-br from-[var(--bg-secondary)]/80 to-[var(--bg-primary)]/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] relative overflow-hidden"
      layout
    >
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--accent)]/10 to-transparent opacity-50" />
      <div className="relative z-10">
        <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent)] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[var(--accent)]"></span>
          </span>
          Proactive Suggestion
        </h3>
        <p className="text-sm text-[var(--text-secondary)] mb-4 leading-relaxed">
          Highly prioritized item: <strong className="text-[var(--text-primary)]">{topItem.title}</strong>. 
          <br className="hidden sm:block" />
          {topItem.summary.slice(0, 120)}{topItem.summary.length > 120 ? '...' : ''}
        </p>
        {topItem.action_label && topItem.action_url && (
          <Button 
            variant="primary" 
            size="sm" 
            onClick={() => window.open(topItem.action_url, '_blank')}
            className="shadow-lg shadow-[var(--accent)]/20 transition-all hover:scale-105"
          >
            {topItem.action_label}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BriefingPage() {
  const { user } = useAuthStore();
  const { setBriefing, setLoading, setError, items, isDismissed, dismissItem, isSummarizing } =
    useBriefingStore();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: () => briefingAPI.getDaily({
      onFallback: (fallbackData) => setBriefing(fallbackData)
    }),
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

  const visibleItems = items
    .filter((item) => !isDismissed(item.id))
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

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
          className="mb-4 flex items-center justify-between"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
        >
          <p className="text-xs text-[var(--text-muted)]">
            {visibleItems.length} item{visibleItems.length !== 1 ? "s" : ""} for today
          </p>
          {isSummarizing && (
            <p className="text-xs text-[var(--accent)] animate-pulse flex items-center gap-2">
              <RefreshCw size={12} className="animate-spin" />
              AI is summarizing...
            </p>
          )}
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

      {/* Proactive Actions */}
      <AnimatePresence>
        {!isLoading && !isError && visibleItems.length > 0 && visibleItems[0] && (visibleItems[0].priority_score || 0) >= 60 && (
          <ProactiveActions key="proactive" items={visibleItems} />
        )}
      </AnimatePresence>

      {/* Briefing Items */}
      {!isLoading && !isError && (
        <div className="relative">
          {isSummarizing && visibleItems.length > 0 && (
            <div className="absolute inset-0 z-10 bg-[var(--bg-primary)]/50 backdrop-blur-[1px] flex flex-col items-center justify-center rounded-xl border border-[var(--border)]">
              <div className="bg-[var(--bg-secondary)] p-4 rounded-xl shadow-lg flex items-center gap-3">
                <RefreshCw size={16} className="animate-spin text-[var(--accent)]" />
                <p className="text-sm font-medium text-[var(--text-primary)]">AI is summarizing...</p>
              </div>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {visibleItems.length === 0 ? (
              <EmptyBriefing key="empty" />
            ) : (
              <motion.div
                className="flex flex-col gap-4"
                role="feed"
                aria-label="Today's briefing items"
                aria-live="polite"
                variants={{
                  hidden: { opacity: 0 },
                  visible: {
                    opacity: 1,
                    transition: {
                      staggerChildren: 0.1
                    }
                  }
                }}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence>
                  {visibleItems.map((item, index) => (
                    <motion.div 
                      key={item.id}
                      variants={{
                        hidden: { opacity: 0, y: 20 },
                        visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
                        exit: { opacity: 0, scale: 0.95, position: "absolute" }
                      }}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      layout
                    >
                      <BriefingCard
                      item={item}
                      index={index}
                      onAction={(item) => {
                        dismissItem(item.id);
                      }}
                    />
                  </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
