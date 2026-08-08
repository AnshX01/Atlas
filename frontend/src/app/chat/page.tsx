"use client";

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mail,
  GitPullRequest,
  Calendar,
  FileText,
  Zap,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useChatStore } from "@/lib/store/useChatStore";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ── Types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string;
  type: string;
  title: string;
  excerpt: string;
  source: string;
  score: number;
  url?: string;
  timestamp: string;
}

interface ActionSuggestion {
  id: string;
  type: string;
  label: string;
  preview: string;
  status: "pending" | "approved" | "rejected";
}

interface ToolExecution {
  id: string;
  server: string;
  tool: string;
  status: "executing" | "done";
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  results?: SearchResult[];
  actions?: ActionSuggestion[];
  toolExecutions?: ToolExecution[];
  streaming?: boolean;
  timestamp: Date;
}

type ChatStatus = "idle" | "streaming" | "loading";

// ── Constants ───────────────────────────────────────────────────────────────

const typeIcon: Record<string, React.ReactNode> = {
  email: <Mail size={14} />,
  pr: <GitPullRequest size={14} />,
  issue: <GitPullRequest size={14} />,
  calendar: <Calendar size={14} />,
  document: <FileText size={14} />,
  file: <FileText size={14} />,
  task: <Zap size={14} />,
};

const typeColor: Record<string, string> = {
  email: "text-blue-400 bg-blue-400/10",
  pr: "text-purple-400 bg-purple-400/10",
  issue: "text-orange-400 bg-orange-400/10",
  calendar: "text-green-400 bg-green-400/10",
  document: "text-slate-400 bg-slate-400/10",
  file: "text-slate-400 bg-slate-400/10",
  task: "text-yellow-400 bg-yellow-400/10",
};

const ACTION_LABELS: Record<string, string> = {
  send_email: "Send Email",
  reply_email: "Reply",
  merge_pr: "Merge PR",
  close_issue: "Close Issue",
  create_issue: "Create Issue",
  schedule_event: "Schedule Event",
  add_comment: "Add Comment",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Detect if running inside Electron with Atlas IPC bridge */
function hasElectronIPC(): boolean {
  return typeof window !== "undefined" && !!window.atlasElectron;
}


// ── Sub-Components ──────────────────────────────────────────────────────────

function StreamingIndicator() {
  return (
    <span className="inline-block w-0.5 h-4 bg-[var(--text-muted)] animate-pulse ml-0.5" />
  );
}

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  return (
    <motion.div
      className="flex items-center gap-2.5 p-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-tertiary)]"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
    >
      <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-amber-400/10 flex items-center justify-center">
        {tool.status === "executing" ? (
          <Loader2 size={12} className="text-amber-400 animate-spin" />
        ) : (
          <Check size={12} className="text-green-400" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-[var(--text-primary)] truncate">
          {tool.tool}
        </p>
        <p className="text-[10px] text-[var(--text-muted)]">
          {tool.status === "executing" ? `Calling ${tool.server}…` : `Done — ${tool.server}`}
        </p>
      </div>
    </motion.div>
  );
}

function ResultCard({ result }: { result: SearchResult }) {
  const color = typeColor[result.type] ?? "text-slate-400 bg-slate-400/10";
  const icon = typeIcon[result.type] ?? <FileText size={14} />;

  return (
    <motion.div
      className="p-2.5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-tertiary)] hover:border-[var(--accent)]/20 transition-all duration-150 cursor-pointer group"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", color)}>
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wide">
              {result.source}
            </span>
            {result.timestamp && (
              <span className="text-[10px] text-[var(--text-muted)]">
                {(() => {
                  try {
                    return formatDistanceToNow(new Date(result.timestamp), { addSuffix: true });
                  } catch {
                    return "";
                  }
                })()}
              </span>
            )}
          </div>
          <h4 className="text-xs font-semibold text-[var(--text-primary)] leading-snug line-clamp-1">
            {result.title}
          </h4>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-2 mt-0.5">
            {result.excerpt}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function ActionCard({
  action,
  onApprove,
  onReject,
}: {
  action: ActionSuggestion;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isResolved = action.status !== "pending";

  return (
    <motion.div
      className={cn(
        "p-2.5 rounded-2xl border bg-[var(--bg-tertiary)] transition-all duration-200",
        action.status === "approved"
          ? "border-green-500/30 bg-green-500/5"
          : action.status === "rejected"
            ? "border-red-500/30 bg-red-500/5 opacity-60"
            : "border-[var(--accent)]/20"
      )}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex-shrink-0 w-7 h-7 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center">
            <Zap size={13} className="text-[var(--accent)]" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              {getActionLabel(action.type)}
            </p>
            <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1">{action.preview}</p>
          </div>
        </div>

        {!isResolved ? (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => onApprove(action.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
              aria-label={`Approve ${getActionLabel(action.type)}`}
            >
              <Check size={12} />
              Approve
            </button>
            <button
              onClick={() => onReject(action.id)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              aria-label={`Reject ${getActionLabel(action.type)}`}
            >
              <X size={12} />
              Reject
            </button>
          </div>
        ) : (
          <span
            className={cn(
              "text-[11px] font-medium px-2 py-1 rounded-lg",
              action.status === "approved" ? "text-green-400 bg-green-500/10" : "text-red-400 bg-red-500/10"
            )}
          >
            {action.status === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </div>
    </motion.div>
  );
}


function ChatMessageBubble({
  message,
  onApproveAction,
  onRejectAction,
  userAvatar,
}: {
  message: ChatMessage;
  onApproveAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  userAvatar?: string | null;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      className={cn("flex gap-3 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-1",
          isUser ? "bg-[var(--accent)]/15" : "bg-white"
        )}
      >
        {isUser ? (
          userAvatar ? (
            <img src={userAvatar} alt="You" className="w-full h-full object-cover rounded-full" />
          ) : (
            <span className="text-[10px] font-semibold text-[var(--accent)]">
              {(() => {
                const { user } = useAuthStore.getState();
                return user?.full_name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U';
              })()}
            </span>
          )
        ) : (
          <img src="/logo.png" alt="Atlas" className="w-4 h-4" />
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-2 min-w-0">
        <div
          className={cn(
            "px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed",
            isUser
              ? "bg-[var(--accent)]/10 text-[var(--text-primary)]"
              : "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
          )}
        >
          <span className="whitespace-pre-wrap">{message.content}</span>
          {message.streaming && <StreamingIndicator />}
        </div>

        {/* Tool Execution Cards (inline) */}
        {message.toolExecutions && message.toolExecutions.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.toolExecutions.map((tool) => (
              <ToolExecutionCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* Result Cards */}
        {message.results && message.results.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.results.map((result) => (
              <ResultCard key={result.id} result={result} />
            ))}
          </div>
        )}

        {/* Action Cards */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onApprove={onApproveAction}
                onReject={onRejectAction}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  return (
    <div className="flex items-end gap-2 p-3 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border-default)] transition-all duration-200">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none max-h-40 leading-relaxed min-h-[44px] focus-visible:outline-none"
        aria-label="Chat input"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !text.trim()}
        className={cn(
          "flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150",
          text.trim() && !disabled
            ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-sm"
            : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
        )}
        aria-label="Send message"
      >
        {disabled ? (
          <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : (
          <Send size={14} />
        )}
      </button>
    </div>
  );
}


// ── Main Page Component ─────────────────────────────────────────────────────

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isFirstMessageRef = useRef(true);

  // Load user avatar from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('atlas-profile-avatar');
    if (stored) setUserAvatar(stored);
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message & get response ────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const assistantId = generateId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      toolExecutions: [],
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStatus("streaming");

    if (hasElectronIPC()) {
      // ── Electron IPC path — real streaming from Ollama via orchestrator ──
      let unsubStream: (() => void) | null = null;
      let unsubEnd: (() => void) | null = null;
      let unsubTool: (() => void) | null = null;
      let unsubApproval: (() => void) | null = null;

      unsubStream = window.atlasElectron!.onWorkflowStream((token: string) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + token } : m
          )
        );
      });

      unsubTool = window.atlasElectron!.onWorkflowToolExecuting((data: any) => {
        const toolExec: ToolExecution = {
          id: generateId(),
          server: data.server ?? "mcp",
          tool: data.tool ?? "unknown",
          status: "executing",
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, toolExecutions: [...(m.toolExecutions ?? []), toolExec] }
              : m
          )
        );
      });

      unsubApproval = window.atlasElectron!.onWorkflowApprovalNeeded((data: any) => {
        const action: ActionSuggestion = {
          id: data.executionId ?? generateId(),
          type: data.actionType ?? data.tool ?? "action",
          label: data.label ?? getActionLabel(data.actionType ?? "action"),
          preview: data.preview ?? data.description ?? "Requires your approval",
          status: "pending",
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, actions: [...(m.actions ?? []), action] }
              : m
          )
        );
      });

      unsubEnd = window.atlasElectron!.onWorkflowComplete((data: any) => {
        // Mark all tool executions as done
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  results: data?.results ?? m.results,
                  toolExecutions: m.toolExecutions?.map((t) => ({ ...t, status: "done" as const })),
                }
              : m
          )
        );
        setStatus("idle");

        // Create conversation on first message
        if (isFirstMessageRef.current) {
          isFirstMessageRef.current = false;
          const title = text.slice(0, 50);
          useChatStore.getState().addConversation(title);
        }

        // Cleanup all listeners
        unsubStream?.();
        unsubEnd?.();
        unsubTool?.();
        unsubApproval?.();
      });

      try {
        await window.atlasElectron!.executeWorkflow(text);
      } catch (err: unknown) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
              : m
          )
        );
        setStatus("idle");
        unsubStream?.();
        unsubEnd?.();
        unsubTool?.();
        unsubApproval?.();
      }
    } else {
      // ── HTTP fallback (dev mode / browser) — existing fetch logic ──────
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        const token = useAuthStore.getState().accessToken;

        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: "Searching across your sources…" } : m))
        );

        const response = await fetch(`${apiBase}/v1/search/omni`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ query: text, limit: 8 }),
          signal: abortRef.current?.signal,
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const results: SearchResult[] = data.results ?? [];
        const rewrittenQuery: string = data.rewritten_query ?? text;

        const resultCount = results.length;
        let responseText: string;
        if (resultCount === 0) {
          responseText = `I searched for "${rewrittenQuery}" but didn't find any results. Try rephrasing or connecting more sources in Settings.`;
        } else {
          responseText = `Found ${resultCount} result${resultCount !== 1 ? "s" : ""} for "${rewrittenQuery}":`;
        }

        const actions = deriveActionsFromResults(results);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: responseText, results, actions, streaming: false }
              : m
          )
        );

        // Create conversation on first message
        if (isFirstMessageRef.current) {
          isFirstMessageRef.current = false;
          const title = text.slice(0, 50);
          useChatStore.getState().addConversation(title);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
              : m
          )
        );
      } finally {
        setStatus("idle");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Derive action suggestions from search results (fallback mode only) */
  const deriveActionsFromResults = (results: SearchResult[]): ActionSuggestion[] => {
    const actions: ActionSuggestion[] = [];

    for (const result of results.slice(0, 2)) {
      if (result.type === "email") {
        actions.push({
          id: generateId(),
          type: "reply_email",
          label: "Reply",
          preview: `Reply to: ${result.title}`,
          status: "pending",
        });
      } else if (result.type === "pr") {
        actions.push({
          id: generateId(),
          type: "merge_pr",
          label: "Merge",
          preview: `Merge: ${result.title}`,
          status: "pending",
        });
      } else if (result.type === "issue") {
        actions.push({
          id: generateId(),
          type: "add_comment",
          label: "Comment",
          preview: `Comment on: ${result.title}`,
          status: "pending",
        });
      }
    }

    return actions;
  };

  // ── Action handlers ────────────────────────────────────────────────────

  const handleApproveAction = useCallback((actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        actions: m.actions?.map((a) => (a.id === actionId ? { ...a, status: "approved" as const } : a)),
      }))
    );

    // If in Electron, call the IPC approve method
    if (hasElectronIPC()) {
      window.atlasElectron!.approveAction(actionId);
    }
  }, []);

  const handleRejectAction = useCallback((actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        actions: m.actions?.map((a) => (a.id === actionId ? { ...a, status: "rejected" as const } : a)),
      }))
    );

    // If in Electron, call the IPC reject method
    if (hasElectronIPC()) {
      window.atlasElectron!.rejectAction(actionId);
    }
  }, []);

  // ── Suggestion click handler ───────────────────────────────────────────

  const handleSuggestionClick = useCallback((suggestion: string) => {
    sendMessage(suggestion);
  }, [sendMessage]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {messages.length === 0 ? (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        ) : (
          <div className="max-w-2xl mx-auto flex flex-col gap-5">
            <AnimatePresence mode="popLayout">
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  onApproveAction={handleApproveAction}
                  onRejectAction={handleRejectAction}
                  userAvatar={userAvatar}
                />
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area — sticky at bottom */}
      <div className="flex-shrink-0 sticky bottom-0 px-4 pb-4 pt-3 bg-[var(--bg-primary)]">
        <div className="max-w-2xl mx-auto">
          <ChatInput onSend={sendMessage} disabled={status !== "idle"} />
        </div>
      </div>
    </div>
  );
}


// ── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ onSuggestionClick }: { onSuggestionClick: (suggestion: string) => void }) {
  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full text-center px-4"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-5">
        <img src="/logo.png" alt="Atlas" className="w-8 h-8" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Atlas AI</h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mb-6">
        Ask me anything about your emails, calendar, pull requests, documents, and more.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {[
          "Summarize today's emails",
          "Open PRs that need review",
          "What meetings do I have tomorrow?",
          "Find docs about onboarding",
        ].map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            className="px-3 py-1.5 rounded-xl text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:border-[var(--accent)]/30 hover:text-[var(--text-primary)] transition-all duration-150 cursor-pointer"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
