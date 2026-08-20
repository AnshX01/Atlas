"use client";

import { useState, useRef, useCallback, useEffect, Suspense, type KeyboardEvent, memo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AgentDesignSystemShell } from "@/components/ui/AgentDesignSystemShell";
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
  ExternalLink,
  ArrowDown,
  Github,
  Slack,
  BookOpen,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { useAuthStore } from "@/lib/store/useAuthStore";

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
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for non-standard environments (e.g., older Electron renderers)
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
    <span className="inline-block w-2 h-[1em] bg-white rounded-[1px] animate-pulse ml-1 align-middle -translate-y-[1px]" />
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
    <AgentDesignSystemShell
      className={cn(
        "flex items-center justify-between gap-2 px-3 py-2 w-full max-w-2xl",
        tool.status === "failed" ? "bg-red-500/5" : "bg-[var(--bg-secondary)]"
      )}
      initial={{ opacity: 0, height: 0, scale: 0.95 }}
      animate={{ opacity: 1, height: "auto", scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <div className="flex items-center gap-2">
        {tool.status === "executing" ? (
          <Spinner size="xs" className="border-[var(--text-muted)] border-t-[var(--text-muted)]" />
        ) : tool.status === "failed" ? (
          <X size={12} className="text-red-400" />
        ) : (
          <Check size={12} className="text-[var(--text-muted)]" />
        )}
        <span className={cn("text-[12px]", tool.status === "failed" ? "text-red-400/90" : "text-[var(--text-muted)]")}>
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
    </AgentDesignSystemShell>
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
    <AgentDesignSystemShell
      className="group cursor-pointer bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-all duration-300 w-full max-w-2xl"
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
          <span className="text-[var(--text-muted)]">{icon}</span>
          <span className="text-[12px] font-medium text-[var(--text-muted)]">
            {formatSourceName(result.source)}
          </span>
          {result.timestamp && (
            <span className="text-[11px] text-[var(--text-muted)] opacity-70 ml-auto">
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
            <ExternalLink size={11} className="text-[var(--text-muted)] opacity-50 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {/* Title */}
        <h4 className="text-[13px] font-medium text-[var(--text-primary)] leading-snug line-clamp-1 mb-1">
          {result.title}
        </h4>

        {/* Excerpt */}
        {result.excerpt && (
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed line-clamp-2">
            {result.excerpt}
          </p>
        )}
      </div>
    </AgentDesignSystemShell>
  );
}, (prev, next) => JSON.stringify(prev.result) === JSON.stringify(next.result));

const ReferencesAccordion = memo(function ReferencesAccordion({
  tools,
  results,
  isStreaming,
  onRetryTool,
}: {
  tools?: ToolExecution[];
  results?: SearchResult[];
  isStreaming?: boolean;
  onRetryTool?: (toolId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const hasTools = tools && tools.length > 0;
  const hasResults = results && results.length > 0;

  if (!hasTools && !hasResults) return null;

  const expanded = Boolean(isStreaming || isOpen);
  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="flex flex-col gap-2 my-1 w-full max-w-2xl">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors w-fit"
      >
        <span>Show references</span>
        <ChevronIcon size={14} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="references-content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-2 overflow-hidden w-full"
          >
            {hasTools && (
              <div className="flex flex-col gap-1.5 w-full">
                {tools.map((tool) => (
                  <ToolExecutionCard key={tool.id} tool={tool} onRetry={onRetryTool} />
                ))}
              </div>
            )}

            {hasResults && (
              <div className="flex flex-col gap-2 w-full">
                {results.map((result) => (
                  <ResultCard key={result.id} result={result} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});


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
    <AgentDesignSystemShell
      className={cn(
        "p-2.5 bg-[var(--bg-tertiary)] transition-all duration-200",
        action.status === "approved"
          ? "bg-green-500/5"
          : action.status === "rejected"
            ? "bg-red-500/5 opacity-60"
            : ""
      )}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[var(--text-muted)]">
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
    </AgentDesignSystemShell>
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
    <AgentDesignSystemShell
      className="relative group w-full"
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <div className="relative bg-[var(--bg-secondary)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-[var(--text-secondary)]">{getActionIcon(draft.actionType)}</span>
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            {getDraftTypeLabel(draft.actionType)}
          </span>
        </div>

        {/* Meta fields */}
        {metaFields.length > 0 && (
          <div className="px-4 py-2.5 space-y-1.5">
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
        <div className="px-4 py-3">
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
              <Spinner size="sm" />
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
    </AgentDesignSystemShell>
  );
}, (prev, next) => JSON.stringify(prev.draft) === JSON.stringify(next.draft));


function DraftCardSkeleton() {
  return (
    <AgentDesignSystemShell
      className="relative group w-full mt-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="relative rounded-2xl bg-[var(--bg-secondary)] overflow-hidden p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-5 h-5 rounded-md bg-[var(--bg-tertiary)] animate-pulse" />
          <div className="w-24 h-4 rounded-md bg-[var(--bg-tertiary)] animate-pulse" />
        </div>
        <div className="space-y-3 mb-4 pb-4">
          <div className="flex items-center gap-2">
             <div className="w-12 h-3 rounded bg-[var(--bg-secondary)] animate-pulse" />
             <div className="w-48 h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
             <div className="w-12 h-3 rounded bg-[var(--bg-secondary)] animate-pulse" />
             <div className="w-32 h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
          </div>
        </div>
        <div className="space-y-2 mb-4">
          <div className="w-full h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
          <div className="w-[90%] h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
          <div className="w-[95%] h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
          <div className="w-[80%] h-3 rounded bg-[var(--bg-tertiary)] animate-pulse" />
        </div>
        <div className="flex items-center gap-2 pt-2">
          <Spinner size="xs" className="border-[var(--text-muted)] border-t-[var(--accent)]" />
          <span className="text-[11px] text-[var(--text-secondary)]">Generating draft...</span>
        </div>
      </div>
    </AgentDesignSystemShell>
  );
}

const ChatMessageBubble = memo(function ChatMessageBubble({
  message,
  onApproveAction,
  onRejectAction,
  onApproveDraft,
  onRejectDraft,
  onRetryTool,
}: {
  message: ChatMessage;
  onApproveAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onApproveDraft: (executionId: string) => void;
  onRejectDraft: (executionId: string) => void;
  onRetryTool?: (toolId: string) => void;
}) {
  const isUser = message.role === "user";

  return (
    <motion.div
      className={cn("flex gap-3 max-w-[85%]", isUser ? "ml-auto flex-row-reverse" : "mr-auto")}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={snappySpring}
    >
      {/* Avatar Removed */}

      {/* Content */}
      <div className="flex flex-col gap-2 min-w-0 overflow-x-hidden">
        <div
          className={cn(
            "px-4 py-3 rounded-2xl text-[15px] leading-relaxed break-word w-full max-w-3xl",
            isUser ? "bg-[var(--accent)] text-[var(--bg-primary)] rounded-tr-sm" : "text-[var(--text-primary)] rounded-tl-sm",
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
                    return !inline ? (
                      <div className="rounded-xl overflow-hidden my-4 bg-[#282c34]">
                        <div className="flex items-center justify-between px-4 py-2 bg-black/40">
                          <span className="text-xs font-mono text-[var(--text-muted)]">{match?.[1] || "text"}</span>
                          <button 
                            onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, "")).catch(console.error)}
                            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1"
                          >
                            Copy
                          </button>
                        </div>
                        <SyntaxHighlighter
                          {...props}
                          style={oneDark}
                          language={match?.[1] || "text"}
                          PreTag="div"
                          customStyle={{ margin: 0, padding: "1rem", backgroundColor: "transparent" }}
                        >
                          {String(children).replace(/\n$/, "")}
                        </SyntaxHighlighter>
                      </div>
                    ) : (
                      <code {...props} className="bg-[var(--bg-tertiary)] rounded-md px-1.5 py-0.5 text-[0.9em] font-mono text-[var(--text-primary)]">
                        {children}
                      </code>
                    );
                  },
                  p: ({ children }) => <p className="mb-4 last:mb-0 leading-relaxed text-[15px]">{children}</p>,
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{children}</a>,
                  ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-4 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-4 space-y-1">{children}</ol>,
                  li: ({ children }) => <li className="pl-1 text-[15px]">{children}</li>,
                  h1: ({ children }) => <h1 className="text-xl font-bold mb-4 mt-6 text-[var(--text-primary)]">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-lg font-bold mb-3 mt-5 text-[var(--text-primary)]">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-base font-bold mb-2 mt-4 text-[var(--text-primary)]">{children}</h3>,
                  table: ({ children }) => <div className="overflow-x-auto mb-4 rounded-lg"><table className="min-w-full divide-y divide-white/10">{children}</table></div>,
                  thead: ({ children }) => <thead className="bg-[var(--bg-secondary)]">{children}</thead>,
                  th: ({ children }) => <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">{children}</th>,
                  td: ({ children }) => <td className="px-4 py-2 text-sm text-[var(--text-primary)]">{children}</td>,
                  blockquote: ({ children }) => <blockquote className="pl-4 italic text-[var(--text-primary)]/60 mb-4">{children}</blockquote>,
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {message.streaming && <StreamingIndicator />}
        </div>

        {/* References Accordion */}
        <ReferencesAccordion
          tools={message.toolExecutions}
          results={message.results}
          isStreaming={message.streaming}
          onRetryTool={onRetryTool}
        />

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
});

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
    <div className="flex flex-col gap-2 px-4 py-2 rounded-2xl bg-[var(--bg-secondary)] transition-all duration-200">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1 pb-1">
          {attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-1 bg-[var(--bg-tertiary)] rounded-md px-2 py-1 text-xs text-[var(--text-primary)]">
              <span className="truncate max-w-[150px]">{file.name}</span>
              <button onClick={() => onRemoveAttachment?.(i)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
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
              ? "bg-[var(--accent)] text-[var(--bg-primary)] hover:bg-[var(--accent-hover)]"
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
      <Spinner size="md" />
    </div>
  );
}

function ChatPageInner() {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Cancel any in-flight HTTP request (browser/dev-mode path)
      abortRef.current?.abort();
      // Drain all IPC workflow listeners so they don't fire after unmount
      unsubscribersRef.current.forEach((fn) => fn());
      unsubscribersRef.current = [];
    };
  }, []);
  const searchParams = useSearchParams();
  const router = useRouter();
  const conversationId = searchParams.get('id');
  const t = searchParams.get('t');

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
    const isNavigation = conversationId !== conversationIdRef.current;
    conversationIdRef.current = conversationId;

    if (conversationId) {
      isFirstMessageRef.current = false;
      if (isNavigation || t) {
        const loadMessages = async () => {
          let loadedMessages: ChatMessage[] = [];
          if (hasElectronIPC()) {
            try {
              const history = await window.atlasElectron!.getConversationHistory(conversationId, 100);
              loadedMessages = history.map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                results: m.results || [],
                actions: m.actions || [],
                toolExecutions: m.toolExecutions || [],
                draft: m.draft,
                timestamp: new Date(m.timestamp || m.created_at || Date.now()),
              }));
              useChatStore.getState().clearMessages(conversationId);
              loadedMessages.forEach(msg => {
                useChatStore.getState().addMessage(conversationId, {
                  ...msg,
                  timestamp: msg.timestamp.toISOString(),
                });
              });
            } catch (err) {
              console.error("[Atlas] Failed to load history from SQLite", err);
            }
          }
          if (loadedMessages.length === 0) {
            const stored = useChatStore.getState().messages[conversationId];
            if (stored && stored.length > 0) {
              loadedMessages = stored.map((m) => ({
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
          if (mountedRef.current) {
            setMessages(loadedMessages);
          }
        };
        loadMessages();
      }
    } else {
      abortRef.current?.abort();
      unsubscribersRef.current.forEach((fn) => fn());
      unsubscribersRef.current = [];

      setMessages([]);
      setStatus("idle");
      isFirstMessageRef.current = true;
    }
  }, [conversationId, t]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const observer = new ResizeObserver(() => {
      if (!isAutoScrollPausedRef.current) {
        messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
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
      let convId = conversationIdRef.current;
      if (isFirstMessageRef.current) {
        isFirstMessageRef.current = false;
        const title = text.slice(0, 50);
        convId = useChatStore.getState().addConversation(title);
        conversationIdRef.current = convId;
        useChatStore.getState().setActiveConversation(convId);
        router.replace(`/chat?id=${convId}`, { scroll: false });
      }

      if (convId) {
        const userStoreMsg = {
          id: userMsg.id,
          role: "user" as const,
          content: userMsg.content,
          timestamp: userMsg.timestamp.toISOString(),
        };
        useChatStore.getState().addMessage(convId, userStoreMsg);
      }

      // ── Electron IPC path ──
      // Clear previous unsubscribers (shouldn't be any, but defensive)
      unsubscribersRef.current.forEach((fn) => fn());
      unsubscribersRef.current = [];

      let unsubStream: (() => void) | null = null;
      let unsubEnd: (() => void) | null = null;
      let unsubTool: (() => void) | null = null;
      let unsubApproval: (() => void) | null = null;
      let unsubDraft: (() => void) | null = null;
      let executionTimeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanupAll = () => {
        unsubStream?.();
        unsubEnd?.();
        unsubTool?.();
        unsubApproval?.();
        unsubDraft?.();
        if (executionTimeoutId) clearTimeout(executionTimeoutId);
        unsubscribersRef.current = [];
      };

      unsubStream = window.atlasElectron!.onWorkflowStream((payload: any) => {
        const token = typeof payload === 'string' ? payload : (payload.content || '');
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + token } : m
          )
        );
      });

      unsubTool = window.atlasElectron!.onWorkflowToolExecuting((data: any) => {
        if (!mountedRef.current) return;
        const toolExec: ToolExecution = {
          id: data.id ?? generateId(),
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
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
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
        if (!mountedRef.current) return;
        
        let finalAssistantMsg: ChatMessage | undefined;

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

            if (!finalContent.trim() && !updatedDraft && filteredResults.length === 0 && (!m.toolExecutions || m.toolExecutions.length === 0)) {
              finalContent = "I'm sorry, but I couldn't generate a response. Please check your connection to Ollama.";
            }

            finalAssistantMsg = {
              ...m,
              streaming: false,
              content: finalContent,
              results: filteredResults.length > 0 ? filteredResults : undefined,
              toolExecutions: m.toolExecutions?.map((t) => {
                const backendTool = data?.toolCalls?.find((bt: any) => bt.id === t.id);
                const hasError = backendTool?.result?.error != null || backendTool?.error != null;
                return {
                  ...t,
                  status: (hasError ? "failed" : "done") as any,
                  errorMessage: hasError ? (backendTool?.result?.error || backendTool?.error) : undefined,
                };
              }),
              draft: updatedDraft,
            };
            return finalAssistantMsg;
          });

          // Perform side effects outside of the state updater
          if (finalAssistantMsg) {
            setTimeout(() => {
              if (mountedRef.current) {
                const assistantStoreMsg = {
                  id: finalAssistantMsg!.id,
                  role: finalAssistantMsg!.role,
                  content: finalAssistantMsg!.content,
                  results: finalAssistantMsg!.results,
                  actions: finalAssistantMsg!.actions,
                  toolExecutions: finalAssistantMsg!.toolExecutions,
                  draft: finalAssistantMsg!.draft,
                  timestamp: finalAssistantMsg!.timestamp as any,
                };
                if (convId) {
                  useChatStore.getState().addMessage(convId, assistantStoreMsg);
                }
              }
            }, 0);
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
        const parsedAttachments = [];
        if (files.length > 0 && window.atlasElectron?.parseFile) {
           for (const file of files) {
              const path = (file as any).path;
              if (path) {
                try {
                  const parsed = await window.atlasElectron.parseFile(path);
                  parsedAttachments.push(parsed);
                } catch (err) {
                  console.warn("[Atlas] Failed to parse file:", err);
                }
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
        // Set a timeout — if workflow-complete doesn't fire within 5 minutes, recover
        executionTimeoutId = setTimeout(() => {
          if (!mountedRef.current) return;
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
        }, 300000);
      } catch (err: unknown) {
        if (!mountedRef.current) return;
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
      let convId = conversationIdRef.current;
      if (isFirstMessageRef.current) {
        isFirstMessageRef.current = false;
        const title = text.slice(0, 50);
        convId = useChatStore.getState().addConversation(title);
        conversationIdRef.current = convId;
        useChatStore.getState().setActiveConversation(convId);
        router.replace(`/chat?id=${convId}`, { scroll: false });
      }

      if (convId) {
        const userStoreMsg = {
          id: userMsg.id,
          role: "user" as const,
          content: userMsg.content,
          timestamp: userMsg.timestamp.toISOString(),
        };
        useChatStore.getState().addMessage(convId, userStoreMsg);
      }

      // ── HTTP fallback (dev mode / browser) ──
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
        const token = useAuthStore.getState().accessToken;

        if (!mountedRef.current) return;
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

        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: responseText, results, streaming: false }
              : m
          )
        );

        // Save to store with results
        const convId = conversationIdRef.current;
        if (convId) {
          const assistantStoreMsg = {
            id: assistantId,
            role: "assistant" as const,
            content: responseText,
            timestamp: new Date().toISOString(),
            results,
          };
          useChatStore.getState().addMessage(convId, assistantStoreMsg);
        }
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") return;
        if (!mountedRef.current) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, something went wrong. Please try again.", streaming: false }
              : m
          )
        );
      } finally {
        if (mountedRef.current) setStatus("idle");
      }
    }
    setAttachments([]); // Clear attachments after send
  }, []);

  // ── Global event and URL parameter injection ───────────────────────────
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('q');
      window.history.replaceState({}, '', newUrl);
      sendMessage(q);
    }

    const handleInjectChat = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string }>;
      if (customEvent.detail?.message) {
        sendMessage(customEvent.detail.message);
      }
    };
    window.addEventListener('atlas:inject_chat', handleInjectChat);
    return () => window.removeEventListener('atlas:inject_chat', handleInjectChat);
  }, [searchParams, sendMessage]);

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
      window.atlasElectron!.abortWorkflow({ conversationId: conversationIdRef.current || '' }).catch(console.error);
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
      window.atlasElectron!.approveAction(actionId).catch(console.error);
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
      window.atlasElectron!.rejectAction(actionId).catch(console.error);
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
      window.atlasElectron!.approveAction(executionId).catch(console.error);
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
      window.atlasElectron!.rejectAction(executionId).catch(console.error);
    }
  }, []);

  const handleRetryTool = useCallback((toolId: string) => {
    sendMessage("Retry that tool");
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
        <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center backdrop-blur-sm rounded-xl">
          <div className="text-[var(--text-primary)] text-2xl font-bold flex flex-col items-center gap-4">
            <FileText size={48} className="text-[var(--accent)]" />
            Drop to share with Atlas
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col justify-center items-center px-4 w-full max-w-3xl mx-auto gap-8 pb-12">
          <EmptyState />
          <div className="w-full">
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
      ) : (
        <>
          <div className="flex-1 w-full overflow-y-auto scroll-smooth scrollbar-hide flex flex-col" onScroll={handleScroll}>
            <div ref={contentRef} className="w-full flex-1 transition-all duration-500 pt-6 pb-6 px-4">
              <div className="w-full max-w-4xl mx-auto flex flex-col gap-5">
                <AnimatePresence mode="popLayout">
                  {messages.map((msg) => (
                    <ErrorBoundary key={msg.id}>
                      <ChatMessageBubble
                        message={msg}
                        onApproveAction={handleApproveAction}
                        onRejectAction={handleRejectAction}
                        onApproveDraft={handleApproveDraft}
                        onRejectDraft={handleRejectDraft}
                        onRetryTool={handleRetryTool}
                      />
                    </ErrorBoundary>
                  ))}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>

          <div className="relative w-full flex flex-col items-center px-4 pb-6 pt-2 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/90 to-transparent">
            {isAutoScrollPaused && (
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-10">
                <button
                  onClick={() => {
                    setIsAutoScrollPaused(false);
                    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-[var(--bg-primary)] text-[13px] font-medium hover:scale-105 transition-all shadow-lg"
                >
                  <ArrowDown size={16} /> New messages
                </button>
              </div>
            )}
            <div className="w-full max-w-3xl mx-auto">
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
        </>
      )}
    </div>
  );
}


// ── Empty State ─────────────────────────────────────────────────────────────

function EmptyState() {
  const user = useAuthStore((state) => state.user);

  const firstName = user?.full_name
    ? user.full_name.trim().split(" ")[0]
    : user?.email
      ? user.email.split("@")[0]
      : "";

  const greeting = firstName
    ? `Hi ${firstName}, how can I help you today?`
    : "Hi, how can I help you today?";

  return (
    <motion.div
      className="flex flex-col items-center justify-center text-center px-4 w-full"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <h1 className="text-2xl md:text-3xl font-semibold text-[var(--text-primary)] tracking-tight">
        {greeting}
      </h1>
    </motion.div>
  );
}

