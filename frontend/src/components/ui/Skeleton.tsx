"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
  circle?: boolean;
}

/** Single shimmer skeleton block. Never use blocking spinners — Section 3.4. */
export function Skeleton({ className, circle }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading..."
      className={cn(
        "skeleton",
        circle ? "rounded-full" : "rounded-lg",
        className
      )}
    />
  );
}

/** Multi-line text skeleton (e.g., for briefing card body) */
export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading content...">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "60%" : "100%" } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** Full briefing card skeleton */
export function BriefingCardSkeleton() {
  return (
    <div className="briefing-card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-5 w-3/4" />
      <TextSkeleton lines={2} />
      <div className="flex gap-2 mt-1">
        <Skeleton className="h-7 w-20 rounded-lg" />
        <Skeleton className="h-7 w-16 rounded-lg" />
      </div>
    </div>
  );
}
