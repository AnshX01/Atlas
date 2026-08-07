"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, FileText, Mail, GitPullRequest, Calendar, Zap, Clock, Loader2, X } from "lucide-react";
import { searchAPI, type SearchResult } from "@/lib/api/search";
import { useKeyboardShortcuts } from "@/lib/shortcuts/useKeyboardShortcuts";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const typeIcon: Record<string, React.ReactNode> = {
  email:    <Mail size={15} />,
  pr:       <GitPullRequest size={15} />,
  issue:    <GitPullRequest size={15} />,
  calendar: <Calendar size={15} />,
  document: <FileText size={15} />,
  file:     <FileText size={15} />,
  task:     <Zap size={15} />,
};

const typeColor: Record<string, string> = {
  email:    "text-blue-400 bg-blue-400/10",
  pr:       "text-purple-400 bg-purple-400/10",
  issue:    "text-orange-400 bg-orange-400/10",
  calendar: "text-green-400 bg-green-400/10",
  document: "text-slate-400 bg-slate-400/10",
  file:     "text-slate-400 bg-slate-400/10",
  task:     "text-yellow-400 bg-yellow-400/10",
};

const recentSearches = [
  "quarterly OKRs review",
  "onboarding pull request",
  "design system tokens",
  "team standup notes",
];

const suggestedSearches = [
  { label: "Emails from last 24h", icon: <Mail size={13} /> },
  { label: "Open pull requests", icon: <GitPullRequest size={13} /> },
  { label: "Today's meetings", icon: <Calendar size={13} /> },
  { label: "Unread issues", icon: <Zap size={13} /> },
];

export default function SearchPage() {
  useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [rewrittenQuery, setRewrittenQuery] = useState("");
  const [tookMs, setTookMs] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(false);
    try {
      const data = await searchAPI.omniSearch({ query: q, limit: 10 });
      setResults(data.results ?? []);
      setRewrittenQuery(data.rewritten_query ?? q);
      setTookMs(data.took_ms ?? null);
      setSearched(true);
    } catch {
      setResults([]);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      runSearch(query);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setResults([]);
    setSearched(false);
    inputRef.current?.focus();
  };

  const runQuick = (q: string) => {
    setQuery(q);
    runSearch(q);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Page Header */}
      <motion.div
        className="mb-6"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">OmniSearch</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Semantic search across all your connected sources.
        </p>
      </motion.div>

      {/* Search Input */}
      <motion.div
        className="relative mb-8"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05, type: "spring", stiffness: 400, damping: 30 }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-200"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border-default)",
            boxShadow: query ? "0 0 0 3px rgba(59, 130, 246, 0.08), 0 4px 16px rgba(0,0,0,0.1)" : "none",
          }}
        >
          {loading ? (
            <Loader2 size={16} className="text-[var(--accent)] animate-spin flex-shrink-0" />
          ) : (
            <Search size={16} className="text-[var(--text-muted)] flex-shrink-0" />
          )}
          <input
            ref={inputRef}
            id="search-input"
            type="text"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything… 'emails from Sarah', 'open PRs in atlas repo'"
            className="flex-1 bg-transparent text-[var(--text-primary)] text-sm placeholder-[var(--text-muted)] outline-none"
            autoFocus
            aria-label="Search query"
          />
          {query && (
            <button
              onClick={clearSearch}
              className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:flex items-center text-[10px] font-mono bg-[var(--bg-tertiary)] border border-[var(--border-default)] px-1.5 py-0.5 rounded text-[var(--text-muted)] flex-shrink-0">
            ↵
          </kbd>
        </div>
      </motion.div>

      <AnimatePresence mode="wait">
        {/* Empty state */}
        {!query && !searched && (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-8"
          >
            {/* Recent searches */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Clock size={13} className="text-[var(--text-muted)]" />
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                  Recent
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((s) => (
                  <button
                    key={s}
                    onClick={() => runQuick(s)}
                    className="px-3 py-1.5 rounded-xl text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:border-[var(--accent)]/30 hover:text-[var(--text-primary)] transition-all duration-150"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Suggested */}
            <div>
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
                Suggested
              </p>
              <div className="flex flex-col gap-1.5">
                {suggestedSearches.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => runQuick(s.label)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:border-[var(--accent)]/30 hover:text-[var(--text-primary)] transition-all duration-150 text-left group"
                  >
                    <span className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors">
                      {s.icon}
                    </span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* Results */}
        {searched && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {/* Meta */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <p className="text-xs text-[var(--text-muted)]">
                  {results.length} result{results.length !== 1 ? "s" : ""}
                  {tookMs !== null && (
                    <span className="ml-1">· {tookMs.toFixed(0)}ms</span>
                  )}
                </p>
                {rewrittenQuery && rewrittenQuery !== query && (
                  <span className="text-xs text-[var(--accent)] bg-[var(--accent)]/10 px-2 py-0.5 rounded-full">
                    AI-rewritten
                  </span>
                )}
              </div>
            </div>

            {results.length === 0 ? (
              <motion.div
                className="flex flex-col items-center justify-center py-20 text-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <div className="w-14 h-14 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] flex items-center justify-center mb-4">
                  <Search size={22} className="text-[var(--text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">No results found</p>
                <p className="text-xs text-[var(--text-muted)] max-w-xs">
                  Try different keywords, or connect more data sources in Settings.
                </p>
              </motion.div>
            ) : (
              <div className="flex flex-col gap-2" role="list" aria-label="Search results">
                {results.map((result, i) => (
                  <motion.div
                    key={result.id}
                    role="listitem"
                    className="p-4 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:border-[var(--accent)]/20 transition-all duration-150 cursor-pointer group"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04, type: "spring", stiffness: 400, damping: 30 }}
                    whileHover={{ y: -1, boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}
                    aria-label={`${result.type}: ${result.title}`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={cn(
                        "flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center mt-0.5",
                        typeColor[result.type] ?? "text-slate-400 bg-slate-400/10"
                      )}>
                        {typeIcon[result.type] ?? <FileText size={15} />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
                            {result.source}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            {(() => {
                              try {
                                return formatDistanceToNow(new Date(result.timestamp), { addSuffix: true });
                              } catch {
                                return "";
                              }
                            })()}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] leading-snug mb-1 line-clamp-1">
                          {result.title}
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2">
                          {result.excerpt}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
