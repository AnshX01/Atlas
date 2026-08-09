"use client";

import { useState, useRef, useCallback, useEffect, Suspense, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Mail,
  GitPullRequest,
  AlertCircle,
  Calendar,
  FileText,
  CheckSquare,
  Check,
  X,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/useAuthStore";
import {
  useChatStore,
  type ChatMessage as StoredChatMessage,
  type SearchResult,
  type ActionSuggestion,
  type ToolExecution,
  type DraftData,
} from "@/lib/store/useChatStore";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// ── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  results?: SearchResult[];
  actions?: ActionSuggestion[];
  toolExecutions?: ToolExecution[];
  draft?: DraftData;
  streaming?: boolean;
  timestamp: Date;
}

type ChatStatus = "idle" | "streaming" | "loading";

// ── Constants ───────────────────────────────────────────────────────────────

const typeIcon: Record<string, React.ReactNode> = {
  email: <Mail size={16} />,
  pr: <GitPullRequest size={16} />,
  issue: <AlertCircle size={16} />,
  calendar: <Calendar size={16} />,
  document: <FileText size={16} />,
  file: <FileText size={16} />,
  task: <CheckSquare size={16} />,
};

const ACTION_LABELS: Record<string, string> = {
  send_email: "Send Email",
  reply_email: "Reply",
  merge_pr: "Merge PR",
  close_issue: "Close Issue",
  create_issue: "Create Issue",
  schedule_event: "Schedule Event",
  add_comment: "Add Comment",
  post_message: "Post Message",
  send_message: "Send Message",
};

const DRAFT_TYPE_LABELS: Record<string, string> = {
  reply_email: "Draft Email Reply",
  send_email: "Draft Email",
  forward_email: "Draft Forward",
  merge_pr: "Merge Pull Request",
  close_pr: "Close Pull Request",
  post_message: "Draft Slack Message",
  send_message: "Draft Message",
  create_issue: "Draft Issue",
  create_page: "Draft Page",
  update_page: "Update Page",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Strip common markdown artifacts from assistant messages.
 * Applied only to final (non-streaming) assistant content.
 */
function stripMarkdown(text: string): string {
  let result = text;
  // Remove heading markers at line start: "# ", "## ", "### ", etc.
  result = result.replace(/^#{1,6}\s+/gm, "");
  // Remove bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");
  // Remove italic: *text* or _text_ (single)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "$1");
  // Remove inline code: `code`
  result = result.replace(/`([^`]+)`/g, "$1");
  // Replace bullet markers at line start: "* " or "- " → "– "
  result = result.replace(/^[\*\-]\s+/gm, "– ");
  return result;
}

/**
 * Filter results to only include those relevant to the response text.
 * Heuristic: keep a result if its title (or a significant token from it) appears
 * as a substring in the response, OR if there are ≤3 total results.
 */
function filterRelevantResults(responseText: string, results: SearchResult[]): SearchResult[] {
  if (results.length <= 3) return results;

  const lowerResponse = responseText.toLowerCase();

  return results.filter((result) => {
    const title = result.title?.toLowerCase() ?? "";
    // Check if full title appears in response
    if (title && lowerResponse.includes(title)) return true;
    // Check significant tokens (words with 4+ chars) from title
    const tokens = title.split(/\s+/).filter((t) => t.length >= 4);
    return tokens.some((token) => lowerResponse.includes(token));
  });
}

function getActionLabel(action: string): string {
  return ACTION_LABELS[action] || action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getDraftTypeLabel(actionType: string): string {
  return DRAFT_TYPE_LABELS[actionType] || actionType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function hasElectronIPC(): boolean {
  return typeof window !== "undefined" && !!window.atlasElectron;
}


// ── Sub-Components ──────────────────────────────────────────────────────────

function StreamingIndicator() {
  return (
    <span className="inline-block w-0.5 h-[1em] bg-[var(--text-muted)] animate-pulse ml-0.5 align-middle" />
  );
}

function formatServerName(server: string): string {
  const names: Record<string, string> = {
    google_workspace: "Google Workspace",
    github: "GitHub",
    slack: "Slack",
    notion: "Notion",
    filesystem: "Local Files",
    local_fs: "Local Files",
  };
  return names[server] || server.charAt(0).toUpperCase() + server.slice(1);
}

function ToolExecutionCard({ tool }: { tool: ToolExecution }) {
  return (
    <motion.div
      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.04] bg-white/[0.02]"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
    >
      {tool.status === "executing" ? (
        <Loader2 size={12} className="text-white/40 animate-spin" />
      ) : (
        <Check size={12} className="text-white/50" />
      )}
      <span className="text-[12px] text-white/50">
        {formatServerName(tool.server)}
      </span>
    </motion.div>
  );
}

function formatSourceName(source: string): string {
  const names: Record<string, string> = {
    gmail: "Google Workspace",
    email: "Google Workspace",
    github: "GitHub",
    calendar: "Google Workspace",
    tasks: "Google Workspace",
    slack: "Slack",
    notion: "Notion",
    filesystem: "Local Files",
    "google workspace": "Google Workspace",
    "google_workspace": "Google Workspace",
    "local files": "Local Files",
    "local_fs": "Local Files",
  };
  return names[source?.toLowerCase()] || source?.charAt(0).toUpperCase() + source?.slice(1) || "Source";
}

function ResultCard({ result }: { result: SearchResult }) {
  const icon = typeIcon[result.type] ?? <FileText size={15} />;

  const handleClick = () => {
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <motion.div
      className="group cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-200"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      onClick={handleClick}
    >
      <div className="px-4 py-3">
        {/* Top row: icon + source name + timestamp */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-white/50">{icon}</span>
          <span className="text-[12px] font-medium text-white/50">
            {formatSourceName(result.source)}
          </span>
          {result.timestamp && (
            <span className="text-[11px] text-white/30 ml-auto">
              {(() => {
                try {
                  return formatDistanceToNow(new Date(result.timestamp), { addSuffix: true });
                } catch {
                  return "";
                }
              })()}
            </span>
          )}
          {result.url && (
            <ExternalLink size={11} className="text-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Title */}
        <h4 className="text-[13px] font-medium text-white/90 leading-snug line-clamp-1 mb-1">
          {result.title}
        </h4>

        {/* Excerpt */}
        {result.excerpt && (
          <p className="text-[12px] text-white/40 leading-relaxed line-clamp-2">
            {result.excerpt}
          </p>
        )}
      </div>
    </motion.div>
  );
}


function getActionIcon(actionType: string): React.ReactNode {
  if (actionType.includes("email") || actionType.includes("mail")) return <Mail size={16} />;
  if (actionType.includes("pr") || actionType.includes("merge") || actionType.includes("branch")) return <GitPullRequest size={16} />;
  if (actionType.includes("issue")) return <AlertCircle size={16} />;
  if (actionType.includes("event") || actionType.includes("calendar") || actionType.includes("schedule")) return <Calendar size={16} />;
  if (actionType.includes("message") || actionType.includes("slack") || actionType.includes("post")) return <Send size={16} />;
  if (actionType.includes("page") || actionType.includes("notion") || actionType.includes("doc")) return <FileText size={16} />;
  return <CheckSquare size={16} />;
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
          <span className="text-white/50">
            {getActionIcon(action.type)}
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

function DraftCard({
  draft,
  onApprove,
  onReject,
}: {
  draft: DraftData;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}) {
  const isPending = draft.status === "pending";
  const isExecuting = draft.status === "executing";
  const isDone = draft.status === "done" || draft.status === "approved";
  const isRejected = draft.status === "rejected";
  const isFailed = draft.status === "failed";

  // Separate the "body" / "message" / "content" field from meta fields
  const bodyKey = Object.keys(draft.fields).find((k) =>
    ["body", "message", "content", "description"].includes(k.toLowerCase())
  );
  const bodyContent = bodyKey ? draft.fields[bodyKey] : null;
  const metaFields = Object.entries(draft.fields).filter(
    ([k]) => k !== bodyKey && draft.fields[k]
  );

  return (
    <motion.div
      className="relative group"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      {/* Gradient border */}
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.02]" />

      <div className="relative rounded-2xl bg-[#111113]/90 backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
          <span className="text-white/70">{getActionIcon(draft.actionType)}</span>
          <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">
            {getDraftTypeLabel(draft.actionType)}
          </span>
        </div>

        {/* Meta fields */}
        {metaFields.length > 0 && (
          <div className="px-4 py-2.5 space-y-1.5 border-b border-white/[0.04]">
            {metaFields.map(([key, value]) => (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider w-14 flex-shrink-0">
                  {key}
                </span>
                <span className="text-[12px] text-[var(--text-primary)] truncate">
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Body content */}
        {bodyContent && (
          <div className="px-4 py-3">
            <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap line-clamp-6">
              {bodyContent}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 py-3 border-t border-white/[0.06]">
          {isPending && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onApprove(draft.executionId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
              >
                <Check size={14} />
                Send
              </button>
              <button
                onClick={() => onReject(draft.executionId)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <X size={14} />
                Cancel
              </button>
            </div>
          )}

          {isExecuting && (
            <div className="flex items-center justify-center gap-2 py-2">
              <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
              <span className="text-xs text-[var(--text-secondary)]">Executing…</span>
            </div>
          )}

          {isDone && (
            <div className="flex items-center justify-center gap-2 py-2">
              <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                <Check size={12} className="text-green-400" />
              </div>
              <span className="text-xs text-green-400 font-medium">Sent successfully</span>
            </div>
          )}

          {isRejected && (
            <div className="flex items-center justify-center gap-2 py-2">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <X size={12} className="text-red-400" />
              </div>
              <span className="text-xs text-red-400 font-medium">Cancelled</span>
            </div>
          )}

          {isFailed && (
            <div className="flex items-center justify-center gap-2 py-2">
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <X size={12} className="text-red-400" />
              </div>
              <span className="text-xs text-red-400 font-medium">
                Failed{draft.errorMessage ? `: ${draft.errorMessage}` : ""}
              </span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}


function ChatMessageBubble({
  message,
  onApproveAction,
  onRejectAction,
  onApproveDraft,
  onRejectDraft,
  userAvatar,
}: {
  message: ChatMessage;
  onApproveAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onApproveDraft: (executionId: string) => void;
  onRejectDraft: (executionId: string) => void;
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
          <img src="/logo.png" alt="Atlas" className="w-5 h-5" />
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
          <span className="whitespace-pre-wrap">
            {/* Strip markdown from final assistant messages; leave streaming/user messages untouched */}
            {!isUser && !message.streaming ? stripMarkdown(message.content) : message.content}
          </span>
          {message.streaming && <StreamingIndicator />}
        </div>

        {/* Tool Execution Cards */}
        {message.toolExecutions && message.toolExecutions.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.toolExecutions.map((tool) => (
              <ToolExecutionCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* Result Cards */}
        {message.results && message.results.length > 0 && (
          <div className="flex flex-col gap-2">
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

        {/* Draft Card */}
        {message.draft && (
          <DraftCard
            draft={message.draft}
            onApprove={onApproveDraft}
            onReject={onRejectDraft}
          />
        )}
      </div>
    </motion.div>
  );
}

function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
}: {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled: boolean;
  isStreaming?: boolean;
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
      {isStreaming ? (
        <button
          onClick={onStop}
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all duration-150"
          aria-label="Stop generating"
        >
          <span className="w-3 h-3 rounded-sm bg-current" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150",
            text.trim() && !disabled
              ? "bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] shadow-sm"
              : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
          )}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      )}
    </div>
  );
}


// ── Main Page Component ─────────────────────────────────────────────────────

export default function ChatPage() {
  return (
    <Suspense fallback={<ChatLoadingFallback />}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatLoadingFallback() {
  return (
    <div className="flex flex-col h-full items-center justify-center">
      <div className="w-5 h-5 border-2 border-[var(--text-muted)]/30 border-t-[var(--text-muted)] rounded-full animate-spin" />
    </div>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('id');

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (conversationId) {
      const stored = useChatStore.getState().messages[conversationId];
      if (stored && stored.length > 0) {
        return stored.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          results: m.results,
          actions: m.actions,
          toolExecutions: m.toolExecutions,
          draft: m.draft,
          timestamp: new Date(m.timestamp),
        }));
      }
    }
    return [];
  });
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Holds unsubscribe functions for all active workflow IPC listeners.
   * Populated in sendMessage, drained in handleStop.
   * This fixes the bug where handleStop couldn't access the local unsub variables
   * inside sendMessage's closure.
   */
  const unsubscribersRef = useRef<Array<() => void>>([]);
  const conversationIdRef = useRef<string | null>(conversationId);
  const isFirstMessageRef = useRef(!conversationId);

  useEffect(() => {
    const stored = localStorage.getItem('atlas-profile-avatar');
    if (stored) setUserAvatar(stored);
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
    if (conversationId) {
      isFirstMessageRef.current = false;
      const stored = useChatStore.getState().messages[conversationId];
      if (stored && stored.length > 0) {
        setMessages(stored.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          results: m.results,
          actions: m.actions,
          toolExecutions: m.toolExecutions,
          draft: m.draft,
          timestamp: new Date(m.timestamp),
        })));
      }
    } else {
      // New chat — reset everything
      setMessages([]);
      setStatus("idle");
      isFirstMessageRef.current = true;
    }
  }, [conversationId]);

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
      // ── Electron IPC path ──
      // Clear previous unsubscribers (shouldn't be any, but defensive)
      unsubscribersRef.current.forEach((fn) => fn());
      unsubscribersRef.current = [];

      let unsubStream: (() => void) | null = null;
      let unsubEnd: (() => void) | null = null;
      let unsubTool: (() => void) | null = null;
      let unsubApproval: (() => void) | null = null;
      let unsubDraft: (() => void) | null = null;

      const cleanupAll = () => {
        unsubStream?.();
        unsubEnd?.();
        unsubTool?.();
        unsubApproval?.();
        unsubDraft?.();
        unsubscribersRef.current = [];
      };

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
          label: getActionLabel(data.actionType ?? "action"),
          preview: data.description ?? "Requires your approval",
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

      // Listen for draft-ready events from the orchestrator
      unsubDraft = window.atlasElectron!.onWorkflowDraftReady((data: any) => {
        const draft: DraftData = {
          executionId: data.executionId,
          actionType: data.actionType,
          fields: data.fields ?? {},
          status: "pending",
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, draft } : m
          )
        );
      });

      unsubEnd = window.atlasElectron!.onWorkflowComplete((data: any) => {
        setMessages((prev) => {
          const updated = prev.map((m) => {
            if (m.id !== assistantId) return m;

            // Fix #3: filter results to only relevant ones
            const rawResults: SearchResult[] = data?.results ?? m.results ?? [];
            const filteredResults = filterRelevantResults(m.content, rawResults);

            // Fix #2: if workflow errored, mark non-final drafts as 'failed'
            let updatedDraft = m.draft;
            if (data?.error && updatedDraft && updatedDraft.status !== "rejected" && updatedDraft.status !== "done") {
              updatedDraft = { ...updatedDraft, status: "failed" as const, errorMessage: data.error };
            } else if (updatedDraft && updatedDraft.status !== "rejected") {
              updatedDraft = { ...updatedDraft, status: "done" as const };
            }

            return {
              ...m,
              streaming: false,
              content: m.content || data?.response || "",
              results: filteredResults.length > 0 ? filteredResults : undefined,
              toolExecutions: m.toolExecutions?.map((t) => ({ ...t, status: "done" as const })),
              draft: updatedDraft,
            };
          });

          // Save messages to store with full card data
          let convId = conversationIdRef.current;
          if (isFirstMessageRef.current) {
            isFirstMessageRef.current = false;
            const title = text.slice(0, 50);
            convId = useChatStore.getState().addConversation(title);
            conversationIdRef.current = convId;
          }
          if (convId) {
            const finalAssistant = updated.find((m) => m.id === assistantId);
            const userStoreMsg: StoredChatMessage = {
              id: userMsg.id,
              role: "user",
              content: userMsg.content,
              timestamp: userMsg.timestamp.toISOString(),
            };
            const assistantStoreMsg: StoredChatMessage = {
              id: assistantId,
              role: "assistant",
              content: finalAssistant?.content ?? "",
              timestamp: new Date().toISOString(),
              results: finalAssistant?.results,
              actions: finalAssistant?.actions,
              toolExecutions: finalAssistant?.toolExecutions,
              draft: finalAssistant?.draft,
            };
            useChatStore.getState().addMessage(convId, userStoreMsg);
            useChatStore.getState().addMessage(convId, assistantStoreMsg);
          }

          return updated;
        });
        setStatus("idle");
        cleanupAll();
      });

      // Store all unsubscribers in ref so handleStop can access them
      unsubscribersRef.current = [
        unsubStream, unsubEnd, unsubTool, unsubApproval, unsubDraft,
      ].filter(Boolean) as Array<() => void>;

      try {
        await window.atlasElectron!.executeWorkflow(text);
        // Set a timeout — if workflow-complete doesn't fire within 90s, recover
        setTimeout(() => {
          setStatus((currentStatus) => {
            if (currentStatus !== "idle") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && m.streaming
                    ? { ...m, streaming: false, content: m.content || "Request timed out. Please try again." }
                    : m
                )
              );
              cleanupAll();
              return "idle";
            }
            return currentStatus;
          });
        }, 90000);
      } catch (err: unknown) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
              : m
          )
        );
        setStatus("idle");
        cleanupAll();
      }
    } else {
      // ── HTTP fallback (dev mode / browser) ──
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

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: responseText, results, streaming: false }
              : m
          )
        );

        // Save to store with results
        let convId = conversationIdRef.current;
        if (isFirstMessageRef.current) {
          isFirstMessageRef.current = false;
          const title = text.slice(0, 50);
          convId = useChatStore.getState().addConversation(title);
          conversationIdRef.current = convId;
        }
        if (convId) {
          const userStoreMsg: StoredChatMessage = {
            id: userMsg.id,
            role: "user",
            content: userMsg.content,
            timestamp: userMsg.timestamp.toISOString(),
          };
          const assistantStoreMsg: StoredChatMessage = {
            id: assistantId,
            role: "assistant",
            content: responseText,
            timestamp: new Date().toISOString(),
            results,
          };
          useChatStore.getState().addMessage(convId, userStoreMsg);
          useChatStore.getState().addMessage(convId, assistantStoreMsg);
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

  // ── Stop handler ───────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    // Abort any HTTP requests (browser/dev fallback path)
    abortRef.current?.abort();

    // Immediately unsubscribe all workflow IPC listeners so the renderer
    // ignores further events from a still-running backend workflow.
    // NOTE: Full backend abort would require orchestrator.ts changes (access to
    // its internal AbortController for the Ollama stream). Out of scope here.
    unsubscribersRef.current.forEach((fn) => fn());
    unsubscribersRef.current = [];

    // Signal the main process (best-effort acknowledgement)
    if (hasElectronIPC()) {
      window.atlasElectron!.abortWorkflow().catch(() => {});
    }

    // Stop streaming — mark all messages as not streaming
    setMessages((prev) =>
      prev.map((m) => m.streaming ? { ...m, streaming: false, content: m.content || "Response stopped." } : m)
    );
    setStatus("idle");
  }, []);

  // ── Action handlers ────────────────────────────────────────────────────

  const handleApproveAction = useCallback((actionId: string) => {
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        actions: m.actions?.map((a) => (a.id === actionId ? { ...a, status: "approved" as const } : a)),
      }))
    );
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
    if (hasElectronIPC()) {
      window.atlasElectron!.rejectAction(actionId);
    }
  }, []);

  const handleApproveDraft = useCallback((executionId: string) => {
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        draft: m.draft?.executionId === executionId
          ? { ...m.draft, status: "executing" as const }
          : m.draft,
      }))
    );
    if (hasElectronIPC()) {
      window.atlasElectron!.approveAction(executionId);
    }
  }, []);

  const handleRejectDraft = useCallback((executionId: string) => {
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        draft: m.draft?.executionId === executionId
          ? { ...m.draft, status: "rejected" as const }
          : m.draft,
      }))
    );
    if (hasElectronIPC()) {
      window.atlasElectron!.rejectAction(executionId);
    }
  }, []);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    sendMessage(suggestion);
  }, [sendMessage]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-6">
        {messages.length === 0 ? (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        ) : (
          <div className="max-w-4xl mx-auto flex flex-col gap-5">
            <AnimatePresence mode="popLayout">
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  onApproveAction={handleApproveAction}
                  onRejectAction={handleRejectAction}
                  onApproveDraft={handleApproveDraft}
                  onRejectDraft={handleRejectDraft}
                  userAvatar={userAvatar}
                />
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-6 lg:px-12 pb-4 pt-3 bg-[var(--bg-primary)]">
        <div className="max-w-2xl mx-auto">
          <ChatInput onSend={sendMessage} onStop={handleStop} disabled={status !== "idle"} isStreaming={status === "streaming"} />
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
        <img src="/logo.png" alt="Atlas" className="w-9 h-9" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Atlas AI</h2>
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mb-6">
        Ask me anything about your emails, calendar, pull requests, documents, and more.
      </p>
      <div className="flex flex-wrap justify-center gap-2.5 max-w-md">
        {[
          "Summarize today's emails",
          "Open PRs that need review",
          "What meetings do I have tomorrow?",
          "Find docs about onboarding",
        ].map((suggestion) => (
          <motion.button
            key={suggestion}
            onClick={() => onSuggestionClick(suggestion)}
            whileHover={{ scale: 1.03, y: -1 }}
            whileTap={{ scale: 0.97 }}
            className="px-4 py-2 rounded-2xl text-[13px] font-medium text-[var(--text-secondary)] border border-white/[0.06] hover:border-white/[0.15] hover:text-[var(--text-primary)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-all duration-200 cursor-pointer"
            style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(8px)" }}
          >
            {suggestion}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
