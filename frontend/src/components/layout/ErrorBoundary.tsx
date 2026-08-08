"use client";

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React class component Error Boundary for Atlas.
 * Catches rendering errors in child components and displays a clean error UI.
 * Styled consistently with the Atlas design system.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log errors in development
    if (process.env.NODE_ENV === "development") {
      console.error("[Atlas ErrorBoundary] Caught error:", error);
      console.error("[Atlas ErrorBoundary] Component stack:", errorInfo.componentStack);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] px-6 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
            <AlertCircle size={28} className="text-red-400" />
          </div>

          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            Something went wrong
          </h2>

          <p className="text-sm text-[var(--text-secondary)] max-w-sm leading-relaxed mb-6">
            An unexpected error occurred while rendering this page. Please try again or contact support if the issue persists.
          </p>

          {process.env.NODE_ENV === "development" && this.state.error && (
            <pre className="mb-6 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-xs text-red-400 font-mono max-w-md overflow-auto text-left whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          )}

          <button
            onClick={this.handleRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium
                       bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent)]/90
                       transition-colors duration-150 shadow-[var(--shadow-glow)]"
          >
            <RefreshCw size={14} />
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
