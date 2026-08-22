"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageTransition } from "@/components/layout/PageTransition";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { useRef } from "react";

import { useWebSocket } from "@/lib/hooks/useWebSocket";
import { Spinner } from "@/components/ui/Spinner";
import { useQueryClient } from "@tanstack/react-query";
import { connectorsAPI } from "@/lib/api/connectors";
import { briefingAPI } from "@/lib/api/briefing";

import { useChatStore } from "@/lib/store/useChatStore";

function HydrationSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg-primary)]">
      <Spinner size="md" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isHydrated } = useAuthStore();
  const [isMounted, setIsMounted] = useState(false);

  useWebSocket();

  const queryClient = useQueryClient();

  useEffect(() => {
    setIsMounted(true);

    // Hydrate conversations from SQLite on app boot
    useChatStore.getState().hydrateFromSQLite();

    // Persistent workflow stream & event listeners across all pages
    if (typeof window !== "undefined" && window.atlasElectron) {
      const electron = window.atlasElectron;

      const unsubStream = electron.onWorkflowStream?.((payload: any) => {
        const token = typeof payload === "string" ? payload : (payload?.content || "");
        useChatStore.getState().appendStreamingToken(token);
      });

      const unsubTool = electron.onWorkflowToolExecuting?.((data: any) => {
        useChatStore.getState().addWorkflowToolExecution(data);
      });

      const unsubApproval = electron.onWorkflowApprovalNeeded?.((data: any) => {
        useChatStore.getState().addWorkflowAction(data);
      });

      const unsubDraft = electron.onWorkflowDraftReady?.((data: any) => {
        useChatStore.getState().setWorkflowDraft(data);
      });

      const unsubComplete = electron.onWorkflowComplete?.((data: any) => {
        useChatStore.getState().completeWorkflow(data);
        queryClient.invalidateQueries({ queryKey: ["connectors"] });
      });

      return () => {
        unsubStream?.();
        unsubTool?.();
        unsubApproval?.();
        unsubDraft?.();
        unsubComplete?.();
      };
    }
  }, [queryClient]);

  useEffect(() => {
    // Prefetch dashboard data to make it load instantly
    if (user && isHydrated) {
      queryClient.prefetchQuery({
        queryKey: ["connectors"],
        queryFn: connectorsAPI.listConnectors,
        staleTime: Infinity,
      });
      queryClient.prefetchQuery({
        queryKey: ["briefing", "daily"],
        queryFn: () => briefingAPI.getDaily(),
        staleTime: Infinity,
      });
      
      // Also prefetch mcp-manager status without blocking
      if (typeof window !== "undefined" && window.atlasElectron?.mcpGetStatus) {
        queryClient.prefetchQuery({
          queryKey: ["mcpStatus"],
          queryFn: () => window.atlasElectron!.mcpGetStatus(),
          staleTime: Infinity,
        });
      }
    }
  }, [user, isHydrated, queryClient]);

  useEffect(() => {
    if (!isMounted || !isHydrated) return;

    const isLogin = pathname === "/login" || pathname === "/login/";

    // Redirect unauthenticated users away from protected routes
    if (!user && !isLogin) {
      router.replace("/login");
    }

    // Redirect authenticated users away from login
    if (user && isLogin) {
      router.replace("/dashboard");
    }
  }, [user, pathname, router, isMounted, isHydrated]);

  // Show spinner until both mounted AND Zustand has rehydrated from localStorage
  // This prevents the flash-to-login race condition
  if (!isMounted || !isHydrated) {
    return (
      <>
        <div style={{ display: "none" }}>{children}</div>
        <HydrationSpinner />
      </>
    );
  }

  const isLoginPage = pathname === "/login" || pathname === "/login/";

  // Wait for redirect to finish if unauthorized, preventing flash of dashboard UI
  if (!user && !isLoginPage) {
    return (
      <>
        <div style={{ display: "none" }}>{children}</div>
        <HydrationSpinner />
      </>
    );
  }

  if (isLoginPage) {
    return (
      <main id="main-content" className="min-h-screen bg-[var(--bg-primary)] relative overflow-hidden" role="main">
        {/* The login page manages its own specific high-opacity gradients */}
        {children}
      </main>
    );
  }

  const isChat = pathname?.startsWith('/chat');

  return (
    <div className="app-layout relative overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />
      <main id="main-content" className="app-main !p-0 z-10 bg-transparent h-screen overflow-hidden flex flex-col relative" role="main">
        {/* Ambient background with GPU acceleration to prevent visual tearing */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0" style={{ willChange: "transform", transform: "translateZ(0)" }}>
          <div
            className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)" }}
          />
          <div
            className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
            style={{ background: "radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)" }}
          />
        </div>
        
        <div className={isChat ? "flex-1 overflow-hidden z-10" : "p-8 overflow-y-auto flex-1 z-10"}>
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
