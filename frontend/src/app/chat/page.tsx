"use client";

import { useState, useRef, useCallback, useEffect, Suspense, type KeyboardEvent, memo } from "react";
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
  ArrowDown,
  Mic,
  Github,
  Slack,
  BookOpen,
} from "lucide-react";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useSpeechToText } from "@/lib/hooks/useSpeechToText";
import { useChatStore,
  type ChatMessage as StoredChatMessage,
  type SearchResult,
  type ActionSuggestion,
  type ToolExecution,
  type DraftData,
} from "@/lib/store/useChatStore";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/cjs/styles/prism";

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

export const snappySpring = { type: "spring", stiffness: 500, damping: 30 };

const typeIcon: Record<string, React.ReactNode> = {
  email: <Mail size={16} />,
  pr: <Github size={16} />,
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

// Strip markdown logic is no longer needed since we are natively rendering markdown!

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

const ToolExecutionCard = memo(function ToolExecutionCard({ tool, onRetry }: { tool: ToolExecution; onRetry?: (toolId: string) => void }) {
  return (
    <motion.div
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-2 rounded-lg",
        tool.status === "failed" ? "border-red-500/20 bg-red-500/5" : "glass-panel"
      )}
      initial={{ opacity: 0, height: 0, scale: 0.95 }}
      animate={{ opacity: 1, height: "auto", scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <div className="flex items-center gap-2">
        {tool.status === "executing" ? (
          <Loader2 size={12} className="text-white/40 animate-spin" />
        ) : tool.status === "failed" ? (
          <X size={12} className="text-red-400" />
        ) : (
          <Check size={12} className="text-white/50" />
        )}
        <span className={cn("text-[12px]", tool.status === "failed" ? "text-red-400/90" : "text-white/50")}>
          {formatServerName(tool.server)} {tool.status === "failed" ? "Failed" : ""}
        </span>
      </div>
      {tool.status === "failed" && onRetry && (
        <button
          onClick={() => onRetry(tool.id)}
          className="text-[11px] font-medium px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
        >
          Retry
        </button>
      )}
    </motion.div>
  );
}, (prev, next) => JSON.stringify(prev.tool) === JSON.stringify(next.tool));

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

const ResultCard = memo(function ResultCard({ result }: { result: SearchResult }) {
  let icon = typeIcon[result.type] ?? <FileText size={15} />;
  
  // Enhance source icons based on name
  const sourceName = formatSourceName(result.source).toLowerCase();
  if (sourceName.includes("github")) icon = <Github size={15} />;
  if (sourceName.includes("slack")) icon = <Slack size={15} />;
  if (sourceName.includes("notion")) icon = <BookOpen size={15} />;
  if (sourceName.includes("google")) icon = <Mail size={15} />;

  const handleClick = () => {
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <motion.div
      className="group cursor-pointer rounded-xl glass-panel hover:bg-white/[0.04] transition-all duration-300"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
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
}, (prev, next) => JSON.stringify(prev.result) === JSON.stringify(next.result));


function getActionIcon(actionType: string): React.ReactNode {
  if (actionType.includes("email") || actionType.includes("mail")) return <Mail size={16} />;
  if (actionType.includes("pr") || actionType.includes("merge") || actionType.includes("branch")) return <GitPullRequest size={16} />;
  if (actionType.includes("issue")) return <AlertCircle size={16} />;
  if (actionType.includes("event") || actionType.includes("calendar") || actionType.includes("schedule")) return <Calendar size={16} />;
  if (actionType.includes("message") || actionType.includes("slack") || actionType.includes("post")) return <Send size={16} />;
  if (actionType.includes("page") || actionType.includes("notion") || actionType.includes("doc")) return <FileText size={16} />;
  return <CheckSquare size={16} />;
}

const ActionCard = memo(function ActionCard({
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
}, (prev, next) => JSON.stringify(prev.action) === JSON.stringify(next.action));

const DraftCard = memo(function DraftCard({
  draft,
  onApprove,
  onReject,
}: {
  draft: DraftData;
  onApprove: (executionId: string) => void;
  onReject: (executionId: string) => void;
}) {
  const [isLocked, setIsLocked] = useState(false);
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
                onClick={(e) => {
                  if (draft.status !== "pending" || isLocked) return;
                  setIsLocked(true);
                  onApprove(draft.executionId);
                }}
                disabled={draft.status !== "pending" || isLocked}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Check size={14} />
                Send
              </button>
              <button
                onClick={(e) => {
                  if (draft.status !== "pending" || isLocked) return;
                  setIsLocked(true);
                  onReject(draft.executionId);
                }}
                disabled={draft.status !== "pending" || isLocked}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
}, (prev, next) => JSON.stringify(prev.draft) === JSON.stringify(next.draft));


function DraftCardSkeleton() {
  return (
    <motion.div
      className="relative group w-full mt-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-white/[0.08] to-white/[0.02]" />
      <div className="relative rounded-2xl bg-[#111113]/90 backdrop-blur-xl overflow-hidden p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-5 h-5 rounded-md bg-white/10 animate-pulse" />
          <div className="w-24 h-4 rounded-md bg-white/10 animate-pulse" />
        </div>
        <div className="space-y-3 mb-4 pb-4 border-b border-white/[0.04]">
          <div className="flex items-center gap-2">
             <div className="w-12 h-3 rounded bg-white/5 animate-pulse" />
             <div className="w-48 h-3 rounded bg-white/10 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
             <div className="w-12 h-3 rounded bg-white/5 animate-pulse" />
             <div className="w-32 h-3 rounded bg-white/10 animate-pulse" />
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <div className="w-full h-3 rounded bg-white/10 animate-pulse" />
          <div className="w-[90%] h-3 rounded bg-white/10 animate-pulse" />
          <div className="w-[95%] h-3 rounded bg-white/10 animate-pulse" />
          <div className="w-[80%] h-3 rounded bg-white/10 animate-pulse" />
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
          <Loader2 size={12} className="text-[var(--accent)] animate-spin" />
          <span className="text-[11px] text-[var(--text-secondary)]">Generating draft...</span>
        </div>
      </div>
    </motion.div>
  );
}

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  onApproveAction,
  onRejectAction,
  onApproveDraft,
  onRejectDraft,
  onRetryTool,
  userAvatar,
}: {
  message: ChatMessage;
  onApproveAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onApproveDraft: (executionId: string) => void;
  onRejectDraft: (executionId: string) => void;
  onRetryTool?: (toolId: string) => void;
  userAvatar?: string | null;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      className={cn("flex gap-3 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={snappySpring}
      layout
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
      <div className="flex flex-col gap-2 min-w-0 overflow-x-hidden">
        <div
          className={cn(
            "px-4 py-3 rounded-2xl text-[15px] leading-relaxed break-word w-full",
            isUser ? "bg-[var(--accent)] text-[var(--bg-primary)] rounded-tr-none" : "bg-[#18181b] text-[var(--text-primary)] rounded-tl-none border border-white/[0.06]",
            !isUser && message.streaming && message.content.trim().startsWith('{') && "hidden"
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{message.content}</span>
          ) : (
            <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    return !inline && match ? (
                      <div className="rounded-xl overflow-hidden my-4 border border-white/10 bg-[#282c34]">
                        <div className="flex items-center justify-between px-4 py-2 bg-black/40">
                          <span className="text-xs font-mono text-white/50">{match[1]}</span>
                          <button 
                            onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}
                            className="text-xs text-white/50 hover:text-white transition-colors flex items-center gap-1"
                          >
                            Copy
                          </button>
                        </div>
                        <SyntaxHighlighter
                          {...props}
                          style={oneDark}
                          language={match[1]}
                          PreTag="div"
                          customStyle={{ margin: 0, padding: "1rem", backgroundColor: "transparent" }}
                        >
                          {String(children).replace(/\n$/, "")}
                        </SyntaxHighlighter>
                      </div>
                    ) : (
                      <code {...props} className="bg-white/10 rounded-md px-1.5 py-0.5 text-[0.9em] font-mono text-white/90">
                        {children}
                      </code>
                    );
                  },
                  p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed text-[15px]">{children}</p>,
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{children}</a>,
                  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-4 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-4 space-y-1">{children}</ol>,
                  li: ({ children }) => <li className="pl-1 text-[15px]">{children}</li>,
                  h1: ({ children }) => <h1 className="text-xl font-bold mb-4 mt-6 text-white">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-bold mb-3 mt-5 text-white">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-bold mb-2 mt-4 text-white">{children}</h3>,
                  table: ({ children }) => <div className="overflow-x-auto mb-4 border border-white/10 rounded-lg"><table className="min-w-full divide-y divide-white/10">{children}</table></div>,
                  thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
                  th: ({ children }) => <th className="px-4 py-2 text-left text-xs font-medium text-white/70 uppercase tracking-wider">{children}</th>,
                  td: ({ children }) => <td className="px-4 py-2 text-sm text-white/90 border-t border-white/10">{children}</td>,
                  blockquote: ({ children }) => <blockquote className="border-l-4 border-[var(--accent)] pl-4 italic text-white/60 mb-4">{children}</blockquote>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {message.streaming && <StreamingIndicator />}
        </div>

        {/* Tool Execution Cards */}
        {message.toolExecutions && message.toolExecutions.length > 0 && (
          <div className="flex flex-col gap-1">
            {message.toolExecutions.map((tool) => (
              <ToolExecutionCard key={tool.id} tool={tool} onRetry={onRetryTool} />
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

        {/* Draft Card or Skeleton */}
        {message.draft ? (
          <DraftCard
            draft={message.draft}
            onApprove={onApproveDraft}
            onReject={onRejectDraft}
          />
        ) : (!isUser && message.streaming && message.content.trim().startsWith('{')) ? (
          <DraftCardSkeleton />
        ) : null}
      </div>
    </motion.div>
  );
}, (prev, next) => JSON.stringify(prev.message) === JSON.stringify(next.message) && prev.userAvatar === next.userAvatar);

function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  attachments = [],
  onRemoveAttachment,
}: {
  onSend: (text: string, files: File[]) => void;
  onStop?: () => void;
  disabled: boolean;
  isStreaming?: boolean;
  attachments?: File[];
  onRemoveAttachment?: (index: number) => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0 || disabled) return;
    onSend(trimmed, attachments);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, disabled, onSend, attachments]);

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
    <div className="flex flex-col gap-2 px-4 py-2 rounded-2xl glass-panel shadow-lg border border-[var(--border-default)] transition-all duration-200">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 pb-1">
          {attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-1 bg-white/10 rounded-md px-2 py-1 text-xs text-white">
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button onClick={() => onRemoveAttachment?.(i)} className="text-white/50 hover:text-white transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 w-full pl-2">

      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything..."
        rows={1}
        disabled={disabled}
        className="flex-1 bg-transparent text-[14px] text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none resize-none max-h-40 leading-relaxed py-2.5 focus-visible:outline-none"
        aria-label="Chat input"
      />
      {isStreaming ? (
        <button
          onClick={onStop}
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-all duration-150 mb-1"
          aria-label="Stop generating"
        >
          <span className="w-3 h-3 rounded-sm bg-current" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || (!text.trim() && attachments.length === 0)}
          className={cn(
            "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-150 mb-1",
            (text.trim() || attachments.length > 0) && !disabled
              ? "bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)] shadow-sm"
              : "bg-transparent text-[var(--text-muted)] cursor-not-allowed"
          )}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      )}
      </div>
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
  const contentRef = useRef<HTMLDivElement>(null);
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

  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const isAutoScrollPausedRef = useRef(false);
  useEffect(() => {
    isAutoScrollPausedRef.current = isAutoScrollPaused;
  }, [isAutoScrollPaused]);

  // Drag and drop state
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Only set dragging to false if we leave the main container
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const newFiles = Array.from(e.dataTransfer.files);
      setAttachments((prev) => [...prev, ...newFiles]);
    }
  }, []);

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
    const content = contentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      if (!isAutoScrollPausedRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    });

    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    const isNearBottom = distanceToBottom < 50;

    if (!isNearBottom && !isAutoScrollPausedRef.current) {
      setIsAutoScrollPaused(true);
    } else if (isNearBottom && isAutoScrollPausedRef.current) {
      setIsAutoScrollPaused(false);
    }
  }, []);

  // ── Send message & get response ────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, files: File[] = []) => {
    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text + (files.length > 0 ? `\n\n[Attachments: ${files.map(f => f.name).join(", ")}]` : ""),
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

            let finalContent = m.content || data?.response || "";
            if (data?.error) {
              const errMsg = `\n\n> **System Notice:** The workflow encountered an error: ${data.error}`;
              finalContent += errMsg;
            }

            return {
              ...m,
              streaming: false,
              content: finalContent,
              results: filteredResults.length > 0 ? filteredResults : undefined,
              toolExecutions: m.toolExecutions?.map((t, idx) => {
                const backendTool = data?.toolCalls?.[idx];
                const hasError = backendTool?.result?.error != null || backendTool?.error != null;
                return {
                  ...t,
                  status: (hasError ? "failed" : "done") as any,
                  errorMessage: hasError ? (backendTool?.result?.error || backendTool?.error) : undefined,
                };
              }),
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
        // Send attachments to backend by parsing them if in Electron
        let parsedAttachments = [];
        if (files.length > 0 && window.atlasElectron?.parseFile) {
           for (const file of files) {
              const path = (file as any).path;
              if (path) {
                const parsed = await window.atlasElectron.parseFile(path);
                parsedAttachments.push(parsed);
              }
           }
        }
        
        // Pass them to the workflow via a special prompt format or let Orchestrator handle it
        // Since executeWorkflow only takes prompt, we might need to stringify them or append to prompt
        // Or update executeWorkflow to take attachments, but for now we can append to prompt as JSON or let the backend know.
        // The prompt says "to prepare them for an Ollama Vision model", implying they might be appended as images in the Orchestrator, but let's append to prompt or let orchestrator know? Wait, `window.atlasElectron!.executeWorkflow(text)` doesn't have an attachments parameter. If I don't modify orchestrator, I should just pass them in the text or modify executeWorkflow. Let's just stringify for now or leave it. Actually the roadmap just says "allow ChatInput to hold a list of file attachments. Create file-parser to handle incoming file paths over IPC. Implement basic extraction..."
        // I will just append parsed text to the prompt, and for images just note them. Wait, if I append images, maybe I should use JSON?
        let finalPrompt = text;
        if (parsedAttachments.length > 0) {
           finalPrompt += "\n\nAttachments:\n" + JSON.stringify(parsedAttachments);
        }

        await window.atlasElectron!.executeWorkflow(finalPrompt);
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
    setAttachments([]); // Clear attachments after send
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

  const handleRetryTool = useCallback((toolId: string) => {
    sendMessage("Retry that tool");
  }, [sendMessage]);

  const handleSuggestionClick = useCallback((suggestion: string) => {
    sendMessage(suggestion);
  }, [sendMessage]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div 
      className="flex flex-col h-full relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm rounded-xl border-2 border-dashed border-[var(--accent)]">
          <div className="text-white text-2xl font-bold flex flex-col items-center gap-4">
            <FileText size={48} className="text-[var(--accent)]" />
            Drop to share with Atlas
          </div>
        </div>
      )}
      <div className="flex-1 w-full max-w-4xl mx-auto overflow-y-auto px-4 py-6 scroll-smooth scrollbar-hide" onScroll={handleScroll}>
        <div ref={contentRef} className="h-full w-full">
        {messages.length === 0 ? (
          <EmptyState onSuggestionClick={handleSuggestionClick} />
        ) : (
          <div className="w-full max-w-4xl mx-auto flex flex-col gap-5">
            <AnimatePresence mode="popLayout">
              {messages.map((msg) => (
                <ChatMessageBubble
                  key={msg.id}
                  message={msg}
                  onApproveAction={handleApproveAction}
                  onRejectAction={handleRejectAction}
                  onApproveDraft={handleApproveDraft}
                  onRejectDraft={handleRejectDraft}
                  onRetryTool={handleRetryTool}
                  userAvatar={userAvatar}
                />
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>
        )}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-6 lg:px-12 pb-8 pt-4 pointer-events-none flex flex-col items-center z-10">
        {isAutoScrollPaused && (
          <div className="mb-4 pointer-events-auto">
            <button
              onClick={() => {
                setIsAutoScrollPaused(false);
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-[var(--bg-primary)] text-[13px] font-medium shadow-lg hover:shadow-xl hover:scale-105 transition-all"
            >
              <ArrowDown size={16} /> New messages
            </button>
          </div>
        )}
        <div className="w-full max-w-3xl mx-auto pointer-events-auto">
          <ErrorBoundary>
            <ChatInput 
              onSend={sendMessage} 
              onStop={handleStop} 
              disabled={status !== "idle"} 
              isStreaming={status === "streaming"}
              attachments={attachments}
              onRemoveAttachment={(i) => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
            />
          </ErrorBoundary>
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
      <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto mb-6">
        Ask me anything about your emails, calendar, pull requests, documents, and more.
      </p>
      <div className="flex flex-wrap justify-center gap-2.5 w-full max-w-md mx-auto">
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
