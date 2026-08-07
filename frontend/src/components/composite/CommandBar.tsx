"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search, FileText, Mail, GitPullRequest, Calendar, Zap,
  ArrowRight, X, Clock, Sparkles
} from "lucide-react";
import { useAppStore } from "@/lib/store/useAppStore";
import { searchAPI } from "@/lib/api/search";
import { cn } from "@/lib/utils";

interface SearchResult {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  source: string;
  score: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
  action_url?: string;
}

const sourceIcon: Record<string, React.ReactNode> = {
  email:    <Mail size={14} />,
  pr:       <GitPullRequest size={14} />,
  issue:    <GitPullRequest size={14} />,
  doc:      <FileText size={14} />,
  document: <FileText size={14} />,
  calendar: <Calendar size={14} />,
  file:     <FileText size={14} />,
  default:  <Zap size={14} />,
};

const suggestedQueries = [
  { label: "What meetings do I have today?", icon: <Calendar size={13} /> },
  { label: "Show my open pull requests", icon: <GitPullRequest size={13} /> },
  { label: "Unread important emails", icon: <Mail size={13} /> },
  { label: "What should I focus on today?", icon: <Zap size={13} /> },
];

const placeholders = [
  "Where is the design spec from Sarah?",
  "Find the investor update email...",
  "What PRs are blocking the release?",
  "Show me Q3 planning docs...",
];

/** Generate the action URL for a search result (mirrors BriefingCard logic) */
function getResultUrl(result: SearchResult): string | null {
  const meta = result.metadata || {};

  if (result.action_url) return result.action_url;

  switch (result.type) {
    case "email": {
      const msgId = meta.source_id ?? meta.msg_id;
      if (msgId) return `https://mail.google.com/mail/u/0/#inbox/${String(msgId)}`;
      return "https://mail.google.com";
    }
    case "pr":
    case "issue": {
      const url = meta.url;
      if (url) return String(url);
      return null;
    }
    case "calendar": {
      const eventId = meta.event_id ?? meta.source_id;
      if (eventId) return `https://calendar.google.com/calendar/event?eid=${String(eventId)}`;
      return "https://calendar.google.com";
    }
    case "task":
    case "document":
    case "file": {
      const url = meta.url;
      if (url) return String(url);
      return null;
    }
    default:
      return null;
  }
}

export function CommandBar() {
  const { commandBarOpen, setCommandBarOpen } = useAppStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [placeholder, setPlaceholder] = useState(placeholders[0]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('atlas-search-history');
    if (saved) setRecentSearches(JSON.parse(saved).slice(0, 5));
  }, []);

  const saveToHistory = (q: string) => {
    const saved = JSON.parse(localStorage.getItem('atlas-search-history') || '[]');
    const updated = [q, ...saved.filter((s: string) => s !== q)].slice(0, 10);
    localStorage.setItem('atlas-search-history', JSON.stringify(updated));
    setRecentSearches(updated.slice(0, 5));
  };

  // Rotate placeholder
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholder(prev => {
        const idx = placeholders.indexOf(prev);
        return placeholders[(idx + 1) % placeholders.length];
      });
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (commandBarOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
      setHasSearched(false);
      // Reload recent searches when opened
      const saved = localStorage.getItem('atlas-search-history');
      if (saved) setRecentSearches(JSON.parse(saved).slice(0, 5));
    }
  }, [commandBarOpen]);

  // Search with debounce
  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setHasSearched(false); return; }
    setLoading(true);
    setHasSearched(true);
    try {
      const data = await searchAPI.omniSearch({ query: q, limit: 8 });
      setResults(data.results || []);
      setSelectedIndex(0);
      // Save to history on successful search
      saveToHistory(q);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearch(e.target.value), 200);
  };

  const fillAndSearch = (text: string) => {
    setQuery(text);
    handleSearch(text);
    inputRef.current?.focus();
  };

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (results[selectedIndex]) {
        handleResultClick(results[selectedIndex]);
      } else if (query.trim()) {
        handleSearch(query);
      }
    } else if (e.key === "Escape") {
      setCommandBarOpen(false);
    }
  };

  const handleResultClick = (result: SearchResult) => {
    const url = getResultUrl(result);
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setCommandBarOpen(false);
  };

  if (!commandBarOpen) return null;

  return (
    <AnimatePresence>
      {commandBarOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            className="command-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setCommandBarOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Atlas Command Bar"
          >
            {/* Command Panel */}
            <motion.div
              key="panel"
              className="command-bar"
              initial={{ opacity: 0, scale: 0.94, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -8 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={e => e.stopPropagation()}
            >
              {/* Search Input */}
              <div className="flex items-center px-4 py-3 gap-3">
                <Search
                  size={18}
                  className="text-[var(--text-muted)] flex-shrink-0"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  id="atlas-command-input"
                  type="text"
                  className="command-input flex-1"
                  placeholder={placeholder}
                  value={query}
                  onChange={onQueryChange}
                  onKeyDown={onKeyDown}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search Atlas"
                  aria-autocomplete="list"
                  aria-controls="command-results"
                  aria-activedescendant={
                    results[selectedIndex] ? `result-${results[selectedIndex].id}` : undefined
                  }
                />
                {loading && (
                  <span className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin flex-shrink-0" />
                )}
                {query && !loading && (
                  <button
                    onClick={() => { setQuery(""); setResults([]); setHasSearched(false); inputRef.current?.focus(); }}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Results / Empty State */}
              <div
                id="command-results"
                className="command-results"
                role="listbox"
                aria-label="Search results"
              >
                {/* Empty state: show recent + suggestions */}
                {!query && !hasSearched && (
                  <div className="py-2">
                    {/* Recent Searches */}
                    {recentSearches.length > 0 && (
                      <div className="mb-2">
                        <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider flex items-center gap-1.5">
                          <Clock size={10} />
                          Recent Searches
                        </div>
                        {recentSearches.map((search, i) => (
                          <button
                            key={`recent-${i}`}
                            className={cn(
                              "w-full flex items-center gap-3 px-4 py-2 text-left",
                              "hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                            )}
                            onClick={() => fillAndSearch(search)}
                          >
                            <Clock size={13} className="text-[var(--text-muted)] flex-shrink-0" />
                            <span className="text-sm text-[var(--text-secondary)] truncate">{search}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Suggested Queries */}
                    <div>
                      <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles size={10} />
                        Suggestions
                      </div>
                      {suggestedQueries.map((suggestion, i) => (
                        <button
                          key={`suggestion-${i}`}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-left",
                            "hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
                          )}
                          onClick={() => fillAndSearch(suggestion.label)}
                        >
                          <span className="text-[var(--accent)] flex-shrink-0">{suggestion.icon}</span>
                          <span className="text-sm text-[var(--text-secondary)]">{suggestion.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI-powered badge + result count */}
                {hasSearched && !loading && results.length > 0 && (
                  <div className="px-4 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">
                      {results.length} result{results.length !== 1 ? 's' : ''}
                    </span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-medium">
                      <Sparkles size={9} />
                      AI-powered
                    </span>
                  </div>
                )}

                {/* Search Results */}
                {results.map((result, i) => (
                  <motion.div
                    key={result.id}
                    id={`result-${result.id}`}
                    className="command-result-item"
                    data-selected={i === selectedIndex}
                    role="option"
                    aria-selected={i === selectedIndex}
                    initial={{ opacity: 0, x: -4 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => handleResultClick(result)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <span className={cn(
                      "flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg",
                      "bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                    )}>
                      {sourceIcon[result.type] ?? sourceIcon.default}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {result.title}
                        </span>
                        <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)]">
                          {result.source}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                        {result.excerpt}
                      </p>
                    </div>

                    <ArrowRight
                      size={14}
                      className={cn(
                        "flex-shrink-0 transition-opacity",
                        i === selectedIndex ? "opacity-60" : "opacity-0"
                      )}
                    />
                  </motion.div>
                ))}

                {/* No results state */}
                {query && !loading && hasSearched && results.length === 0 && (
                  <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
                    <p>No results for <span className="text-[var(--text-primary)]">&ldquo;{query}&rdquo;</span></p>
                    <p className="text-xs mt-1 text-[var(--text-muted)]">
                      Try rephrasing your question.{" "}
                      <button
                        className="text-[var(--accent)] hover:underline"
                        onClick={() => handleSearch(query)}
                      >
                        Retry
                      </button>
                    </p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-subtle)]">
                <div className="flex gap-3 text-[10px] text-[var(--text-muted)]">
                  <span><kbd className="font-mono">↑↓</kbd> navigate</span>
                  <span><kbd className="font-mono">↵</kbd> open</span>
                  <span><kbd className="font-mono">Esc</kbd> close</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <Zap size={10} className="text-[var(--accent)]" />
                  <span>Atlas AI Search</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
