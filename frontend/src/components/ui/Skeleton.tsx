"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  lines?: number;
  circle?: boolean;
  style?: React.CSSProperties;
}

/** Single shimmer skeleton block. Never use blocking spinners — Section 3.4. */
export function Skeleton({ className, circle, style }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading..."
      className={cn(
        "skeleton",
        circle ? "rounded-full" : "rounded-lg",
        className
      )}
      style={style}
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
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-8 w-8 rounded-xl" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-2.5 w-14" />
          </div>
        </div>
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

/** Dashboard status card skeleton */
export function DashboardStatusSkeleton() {
  return (
    <div className="p-5 rounded-2xl bg-[var(--bg-secondary)]">
      <div className="flex items-center gap-4">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>
    </div>
  );
}

/** Quick action card skeleton */
export function QuickActionSkeleton() {
  return (
    <div className="p-4 rounded-2xl bg-[var(--bg-secondary)] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <Skeleton className="w-4 h-4 rounded" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  );
}

/** Activity item skeleton */
export function ActivityItemSkeleton() {
  return (
    <div className="p-3 rounded-xl bg-[var(--bg-secondary)] flex items-center gap-3">
      <Skeleton className="w-7 h-7 rounded-lg flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="w-3 h-3 rounded flex-shrink-0" />
    </div>
  );
}
