"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef, useCallback, useRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-[var(--accent)] text-[var(--bg-primary)] font-medium
    hover:bg-[var(--accent-hover)] active:scale-[0.98]
    shadow-[0_0_12px_var(--accent-glow)]
    hover:shadow-[0_0_20px_var(--accent-glow)]
  `,
  secondary: `
    bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium
    border border-[var(--border-default)]
    hover:bg-[var(--bg-secondary)] active:scale-[0.98]
  `,
  ghost: `
    bg-transparent text-[var(--text-secondary)] font-medium
    hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]
    active:scale-[0.98]
  `,
  danger: `
    bg-red-500/10 text-red-400 font-medium
    border border-red-500/20
    hover:bg-red-500/20 active:scale-[0.98]
  `,
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs rounded-lg gap-1.5",
  md: "h-9 px-4 text-sm rounded-xl gap-2",
  lg: "h-11 px-6 text-base rounded-xl gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      onClick,
      ...props
    },
    ref
  ) => {
    const isClicking = useRef(false);

    const handleClick = useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isClicking.current || disabled || isLoading) return;
        isClicking.current = true;
        if (onClick) {
          onClick(e);
        }
        setTimeout(() => {
          isClicking.current = false;
        }, 300);
      },
      [onClick, disabled, isLoading]
    );

    return (
      <motion.button
        ref={ref}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: 0.1 }}
        className={cn(
          "inline-flex items-center justify-center select-none",
          "transition-all duration-150 ease-out cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          (isLoading || disabled) && "pointer-events-none opacity-50",
          className
        )}
        disabled={disabled || isLoading}
        onClick={handleClick}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {...(props as any)}
      >
        {isLoading ? (
          <span className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </motion.button>
    );
  }
);

Button.displayName = "Button";
