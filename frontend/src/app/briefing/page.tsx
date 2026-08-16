"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
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
import toast from "react-hot-toast";

// ── Empty State ────────────────────────────────────────────────────────────────
function EmptyBriefing() {
  const router = useRouter();
  const { data: connectors, isLoading: connectorsLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
  });

  if (connectorsLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <BriefingCardSkeleton key={i} />
        ))}
      </div>
    );
  }

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


// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BriefingPage() {
  const user = useAuthStore.use.user();
  const setBriefing = useBriefingStore.use.setBriefing();
  const setLoading = useBriefingStore.use.setLoading();
  const setError = useBriefingStore.use.setError();
  const items = useBriefingStore.use.items();
  const isDismissed = useBriefingStore.use.isDismissed();
  const dismissItem = useBriefingStore.use.dismissItem();
  const isSummarizing = useBriefingStore.use.isSummarizing();
  const restoreItem = useBriefingStore.use.restoreItem();

  const handleDone = (item: any) => {
    // 1. Optimistic remove (dismiss hides it from view)
    dismissItem(item.id);
    
    // 2. Setup undo timeout
    const timeoutId = setTimeout(() => {
      connectorsAPI.executeAction(item, 'done');
    }, 5000);

    // 3. Show undo toast
    toast(
      (t) => (
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[var(--text-primary)]">Marked as done</span>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => {
              clearTimeout(timeoutId);
              restoreItem(item);
              toast.dismiss(t.id);
            }}
          >
            Undo
          </Button>
        </div>
      ),
      {
        id: item.id, // prevent duplicate toasts for same item
        duration: 5000,
        style: {
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          boxShadow: 'none',
        }
      }
    );
  };

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["briefing", "daily"],
    queryFn: () => briefingAPI.getDaily({
      onFallback: (fallbackData) => setBriefing(fallbackData)
    }),
    staleTime: 1000 * 60 * 60, // 1 hour
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchInterval: 1000 * 60 * 60,
  });

  useEffect(() => {
    setLoading(isLoading);
    if (isError) {
      setError("Failed to load briefing");
      return;
    }
    if (data) {
      setBriefing(data);
    }
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
            isLoading={isLoading || isFetching}
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
        <div className="relative">
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
                      onDone={(item: any) => handleDone(item)}
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
