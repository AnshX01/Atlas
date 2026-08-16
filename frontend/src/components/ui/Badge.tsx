"use client";

import { cn } from "@/lib/utils";

export type BadgeVariant = "default" | "urgent" | "high" | "medium" | "low" | "blue" | "outline";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
  urgent:  "bg-red-500/15 text-red-400",
  high:    "bg-orange-500/15 text-orange-400",
  medium:  "bg-yellow-500/15 text-yellow-500",
  low:     "bg-green-500/15 text-green-400",
  blue:    "bg-blue-500/15 text-blue-400",
  outline: "bg-transparent text-[var(--text-muted)]",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-[var(--text-muted)]",
  urgent:  "bg-red-400",
  high:    "bg-orange-400",
  medium:  "bg-yellow-400",
  low:     "bg-green-400",
  blue:    "bg-blue-400",
  outline: "bg-[var(--text-muted)]",
};

export function Badge({ children, variant = "default", className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5",
        "rounded-full text-[11px] font-medium tracking-wide",
        "select-none whitespace-nowrap",
        variantStyles[variant],
        className
      )}
    >
      {dot && (
        <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", dotColors[variant])} />
      )}
      {children}
    </span>
  );
}

/** Priority badge that maps numeric score to urgency level */
export function PriorityBadge({ score }: { score: number }) {
  const variant: BadgeVariant =
    score >= 90 ? "urgent" :
    score >= 70 ? "high" :
    score >= 40 ? "medium" : "low";

  const label =
    score >= 90 ? "URGENT" :
    score >= 70 ? "HIGH" :
    score >= 40 ? "MEDIUM" : "LOW";

  return <Badge variant={variant} dot>{label} {score}</Badge>;
}

/** Source badge (Gmail, GitHub, etc.) */
export function SourceBadge({ source }: { source: string }) {
  return <Badge variant="outline">{source}</Badge>;
}
