import { motion, HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import React from "react";

export interface AgentDesignSystemShellProps extends HTMLMotionProps<"div"> {
  className?: string;
  children: React.ReactNode;
  contentClassName?: string;
}

export function AgentDesignSystemShell({ className, children, contentClassName, ...props }: AgentDesignSystemShellProps) {
  return (
    <motion.div
      className={cn(
        "rounded-2xl bg-[var(--bg-secondary)]/50 backdrop-blur-xl relative overflow-hidden transition-colors duration-200 group",
        className
      )}
      {...props}
    >
      <div className={cn("relative z-10 flex flex-col w-full h-full", contentClassName)}>
        {children}
      </div>
    </motion.div>
  );
}
