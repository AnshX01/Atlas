"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolExecutions?: ToolExecution[];
  approval?: ApprovalData;
}

export interface ToolExecution {
  id: string;
  server: string;
  tool: string;
  params?: Record<string, unknown>;
  status: "loading" | "done" | "error";
  result?: string;
}

export interface ApprovalData {
  executionId: string;
  action: string;
  description: string;
  params?: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executing" | "done" | "error";
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface UseWorkflowReturn {
  messages: Message[];
  isStreaming: boolean;
  pendingApproval: ApprovalData | null;
  send: (prompt: string) => void;
  approve: (executionId: string) => void;
  reject: (executionId: string) => void;
  currentStreamingContent: string;
  conversations: Conversation[];
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;
  createNewConversation: () => void;
  loadConversations: () => void;
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.atlasElectron;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWorkflow(): UseWorkflowReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<ApprovalData | null>(null);
  const [currentStreamingContent, setCurrentStreamingContent] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const streamingContentRef = useRef("");
  const activeToolExecutions = useRef<ToolExecution[]>([]);

  // ── Load conversations ─────────────────────────────────────────────────────

  const loadConversations = useCallback(async () => {
    if (isElectron()) {
      try {
        const convos = await window.atlasElectron!.listConversations();
        setConversations(
          convos.map((c: any) => ({
            id: c.id,
            title: c.title || "Untitled",
            createdAt: c.created_at || c.createdAt,
            updatedAt: c.updated_at || c.updatedAt,
          }))
        );
      } catch (err) {
        console.error("Failed to load conversations:", err);
      }
    }
  }, []);

  // ── Load conversation history ──────────────────────────────────────────────

  const setActiveConversation = useCallback(
    async (id: string | null) => {
      setActiveConversationId(id);
      if (!id) {
        setMessages([]);
        return;
      }

      if (isElectron()) {
        try {
          const history = await window.atlasElectron!.getConversationHistory(id, 100);
          setMessages(
            history.map((m: any) => ({
              id: m.id || generateId(),
              role: m.role,
              content: m.content,
              timestamp: m.created_at || m.timestamp || new Date().toISOString(),
              toolExecutions: m.toolExecutions || [],
              approval: m.approval,
            }))
          );
        } catch (err) {
          console.error("Failed to load conversation history:", err);
        }
      }
    },
    []
  );

  const createNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setCurrentStreamingContent("");
    setPendingApproval(null);
    setIsStreaming(false);
  }, []);

  // ── Subscribe to IPC events ────────────────────────────────────────────────

  useEffect(() => {
    if (!isElectron()) return;

    const api = window.atlasElectron!;

    const unsubStream = api.onWorkflowStream((payload: any) => {
      const token = typeof payload === 'string' ? payload : (payload.content || '');
      streamingContentRef.current += token;
      setCurrentStreamingContent(streamingContentRef.current);
      
      setMessages((prev) => {
        const updated = [...prev];
        let lastAssistantIndex = -1;
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === "assistant") {
            lastAssistantIndex = i;
            break;
          }
        }
        if (lastAssistantIndex !== -1) {
          updated[lastAssistantIndex] = {
            ...updated[lastAssistantIndex],
            content: streamingContentRef.current,
          };
        }
        return updated;
      });
    });

    const unsubApproval = api.onWorkflowApprovalNeeded((data: any) => {
      const approvalData: ApprovalData = {
        executionId: data.executionId || data.id,
        action: data.action || data.tool || "Unknown Action",
        description: data.description || data.message || "",
        params: data.params,
        status: "pending",
      };
      setPendingApproval(approvalData);

      // Also attach to current assistant message
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          lastAssistant.approval = approvalData;
        }
        return updated;
      });
    });

    const unsubTool = api.onWorkflowToolExecuting((data: any) => {
      const toolExec: ToolExecution = {
        id: data.id || generateId(),
        server: data.server || "unknown",
        tool: data.tool || "unknown",
        params: data.params,
        status: "loading",
      };
      activeToolExecutions.current = [...activeToolExecutions.current, toolExec];

      // Attach tool execution to current assistant message
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          lastAssistant.toolExecutions = [
            ...(lastAssistant.toolExecutions || []),
            toolExec,
          ];
        }
        return [...updated];
      });
    });

    const unsubComplete = api.onWorkflowComplete((data: any) => {
      setIsStreaming(false);

      // Finalize the assistant message with the full content
      const finalContent = data?.error ? `Error: ${data.error}` : (streamingContentRef.current || data?.response || data?.content || "");
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
        if (lastAssistant) {
          lastAssistant.content = finalContent;
          // Mark all tool executions as done
          if (lastAssistant.toolExecutions) {
            lastAssistant.toolExecutions = lastAssistant.toolExecutions.map((t) =>
              t.status === "loading" ? { ...t, status: "done" as const } : t
            );
          }
        }
        return [...updated];
      });

      streamingContentRef.current = "";
      setCurrentStreamingContent("");
      activeToolExecutions.current = [];

      // Refresh conversations list
      loadConversations();
    });

    // Initial load
    loadConversations();

    return () => {
      unsubStream();
      unsubApproval();
      unsubTool();
      unsubComplete();
    };
  }, [loadConversations]);

  // ── Send message ───────────────────────────────────────────────────────────

  const send = useCallback(
    async (prompt: string) => {
      if (!prompt.trim() || isStreaming) return;

      // Add user message
      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: prompt.trim(),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Add placeholder assistant message
      const assistantMessage: Message = {
        id: generateId(),
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        toolExecutions: [],
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Reset streaming state
      streamingContentRef.current = "";
      setCurrentStreamingContent("");
      setIsStreaming(true);
      setPendingApproval(null);

      if (isElectron()) {
        try {
          await window.atlasElectron!.executeWorkflow(
            prompt.trim(),
            activeConversationId || undefined
          );
        } catch (err) {
          console.error("Workflow execution failed:", err);
          setIsStreaming(false);
          setMessages((prev) => {
            const updated = [...prev];
            const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
            if (lastAssistant) {
              lastAssistant.content =
                "Sorry, I encountered an error processing your request. Please try again.";
            }
            return [...updated];
          });
        }
      } else {
        // HTTP API fallback for browser-only mode
        try {
          const response = await fetch("/api/v1/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: prompt.trim() }),
          });

          if (response.ok) {
            const data = await response.json();
            setMessages((prev) => {
              const updated = [...prev];
              const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
              if (lastAssistant) {
                lastAssistant.content = data.content || data.message || "No response.";
              }
              return [...updated];
            });
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        } catch (err) {
          console.error("HTTP chat failed:", err);
          setMessages((prev) => {
            const updated = [...prev];
            const lastAssistant = [...updated].reverse().find((m) => m.role === "assistant");
            if (lastAssistant) {
              lastAssistant.content =
                "Unable to connect to the Atlas backend. Make sure the server is running.";
            }
            return [...updated];
          });
        } finally {
          setIsStreaming(false);
        }
      }
    },
    [isStreaming, activeConversationId]
  );

  // ── Approve / Reject ───────────────────────────────────────────────────────

  const approve = useCallback(async (executionId: string) => {
    setPendingApproval((prev) =>
      prev && prev.executionId === executionId ? { ...prev, status: "executing" } : prev
    );

    // Update in messages as well
    setMessages((prev) =>
      prev.map((m) =>
        m.approval && m.approval.executionId === executionId
          ? { ...m, approval: { ...m.approval, status: "executing" as const } }
          : m
      )
    );

    if (isElectron()) {
      try {
        await window.atlasElectron!.approveAction(executionId);
        setPendingApproval((prev) =>
          prev && prev.executionId === executionId ? { ...prev, status: "done" } : prev
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.approval && m.approval.executionId === executionId
              ? { ...m, approval: { ...m.approval, status: "done" as const } }
              : m
          )
        );
      } catch (err) {
        setPendingApproval((prev) =>
          prev && prev.executionId === executionId
            ? { ...prev, status: "error", error: String(err) }
            : prev
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.approval && m.approval.executionId === executionId
              ? { ...m, approval: { ...m.approval, status: "error" as const, error: String(err) } }
              : m
          )
        );
      }
    }
  }, []);

  const reject = useCallback(async (executionId: string) => {
    setPendingApproval((prev) =>
      prev && prev.executionId === executionId ? { ...prev, status: "rejected" } : prev
    );

    setMessages((prev) =>
      prev.map((m) =>
        m.approval && m.approval.executionId === executionId
          ? { ...m, approval: { ...m.approval, status: "rejected" as const } }
          : m
      )
    );

    if (isElectron()) {
      try {
        await window.atlasElectron!.rejectAction(executionId);
      } catch (err) {
        console.error("Failed to reject action:", err);
      }
    }
  }, []);

  return {
    messages,
    isStreaming,
    pendingApproval,
    send,
    approve,
    reject,
    currentStreamingContent,
    conversations,
    activeConversationId,
    setActiveConversation,
    createNewConversation,
    loadConversations,
  };
}
