"use client";

import { motion } from "framer-motion";
import { Skeleton } from "./Skeleton";

/**
 * Skeleton placeholder that matches a search result card layout.
 * Shows icon + title line + excerpt lines for progressive loading UX.
 */
function SearchResultSkeleton({ index }: { index: number }) {
  return (
    <motion.div
      className="p-4 rounded-2xl bg-[var(--bg-secondary)]"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="flex items-start gap-3">
        {/* Icon placeholder */}
        <Skeleton className="w-8 h-8 rounded-xl flex-shrink-0" />

        <div className="flex-1 min-w-0 space-y-2">
          {/* Source + timestamp line */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-2.5 w-20" />
          </div>

          {/* Title line */}
          <Skeleton
            className="h-4"
            style={{ width: `${70 + (index * 7) % 25}%` }}
          />

          {/* Relevance bar placeholder */}
          <Skeleton className="h-1 w-16 rounded-full" />

          {/* Excerpt lines */}
          <div className="space-y-1.5 pt-0.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton
              className="h-3"
              style={{ width: `${55 + (index * 13) % 35}%` }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Shows 3-4 skeleton cards to indicate search results are loading.
 */
export function SearchSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading search results...">
      {Array.from({ length: count }).map((_, i) => (
        <SearchResultSkeleton key={i} index={i} />
      ))}
    </div>
  );
}
