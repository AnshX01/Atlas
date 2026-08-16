"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { type ButtonHTMLAttributes, forwardRef, useCallback, useRef } from "react";
import { Spinner } from "@/components/ui/Spinner";

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
    hover:bg-[var(--accent-hover)]
  `,
  secondary: `
    bg-[var(--bg-primary)] text-[var(--text-primary)] font-medium
    hover:bg-[var(--bg-secondary)]
  `,
  ghost: `
    bg-transparent text-[var(--text-secondary)] font-medium
    hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]
  `,
  danger: `
    bg-red-500/10 text-red-500 font-medium
    hover:bg-red-500/20
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
        whileTap={disabled || isLoading ? undefined : { scale: 0.97 }}
        transition={{ duration: 0.1 }}
        className={cn(
          "inline-flex items-center justify-center select-none",
          "transition-all duration-150 ease-out cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          variantStyles[variant],
          sizeStyles[size],
          (isLoading || disabled) && "opacity-50 cursor-not-allowed",
          className
        )}
        disabled={disabled || isLoading}
        onClick={handleClick}
        {...(props as any)}
      >
        {isLoading ? (
          <Spinner size="sm" />
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
