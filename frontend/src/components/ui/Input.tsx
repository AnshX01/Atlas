"use client";

import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef, useState } from "react";
import { Search } from "lucide-react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  rightElement?: React.ReactNode;
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ icon, rightElement, error, label, className, id, ...props }, ref) => {
    const [focused, setFocused] = useState(false);
    const inputId = id || `input-${Math.random().toString(36).slice(2)}`;

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-xs font-medium text-[var(--text-secondary)] tracking-wide uppercase"
          >
            {label}
          </label>
        )}
        <div
          className={cn(
            "relative flex items-center",
            "rounded-xl transition-all duration-150",
            focused
              ? ""
              : "",
            error && ""
          )}
        >
          {icon && (
            <span className="absolute left-3 text-[var(--text-muted)] pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-muted)]",
              "py-2.5 text-sm outline-none",
              icon ? "pl-9 pr-4" : "px-4",
              rightElement && "pr-10",
              className
            )}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            {...props}
          />
          {rightElement && (
            <span className="absolute right-3 text-[var(--text-muted)]">{rightElement}</span>
          )}
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

/** Specialized search input with icon and keyboard hint */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <Input
      ref={ref}
      icon={<Search size={16} />}
      rightElement={
        <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[10px] font-mono text-[var(--text-muted)]">
          ⌘K
        </kbd>
      }
      placeholder="Search everything..."
      className={className}
      {...props}
    />
  )
);

SearchInput.displayName = "SearchInput";
