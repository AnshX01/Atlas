"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCcw, AlertTriangle } from "lucide-react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 m-4 rounded-3xl glass-panel relative overflow-hidden group">
          {/* Subtle animated background glow */}
          <div className="absolute inset-0 bg-gradient-to-b from-red-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
          
          <div className="relative z-10 w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(239,68,68,0.15)]">
            <AlertTriangle className="text-red-400 w-8 h-8 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
          </div>
          
          <h2 className="relative z-10 text-xl font-medium text-[var(--text-primary)] mb-3 tracking-tight">
            Something went wrong
          </h2>
          
          <p className="relative z-10 text-[14px] text-[var(--text-secondary)] text-center mb-8 max-w-[320px] leading-relaxed">
            {this.state.error?.message || "An unexpected error occurred in this component. Please try again."}
          </p>
          
          <button
            onClick={this.handleRetry}
            className="relative z-10 flex items-center gap-2.5 px-6 py-2.5 rounded-2xl bg-[var(--accent)] text-[var(--bg-primary)] font-medium text-[13px] shadow-lg hover:shadow-[0_0_20px_var(--accent)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300"
          >
            <RefreshCcw className="w-4 h-4" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
