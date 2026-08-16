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
  const clickTimestamps = useRef<number[]>([]);
  const [rageLocked, setRageLocked] = useState(false);

  useWebSocket();

  const queryClient = useQueryClient();

  useEffect(() => {
    setIsMounted(true);
    
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
    const handleGlobalClick = (e: MouseEvent) => {
      const now = Date.now();
      clickTimestamps.current = clickTimestamps.current.filter((t) => now - t < 1000);
      clickTimestamps.current.push(now);

      if (clickTimestamps.current.length >= 5) {
        if (!rageLocked) {
          setRageLocked(true);
          setTimeout(() => {
            setRageLocked(false);
            clickTimestamps.current = [];
          }, 2000);
        }
        e.stopPropagation();
        e.preventDefault();
      } else if (rageLocked) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    document.addEventListener("click", handleGlobalClick, true);
    return () => document.removeEventListener("click", handleGlobalClick, true);
  }, [rageLocked]);

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
    return <HydrationSpinner />;
  }

  const isLoginPage = pathname === "/login" || pathname === "/login/";

  // Wait for redirect to finish if unauthorized, preventing flash of dashboard UI
  if (!user && !isLoginPage) {
    return <HydrationSpinner />;
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
          {rageLocked && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/5 backdrop-blur-sm pointer-events-none animate-fade-in">
              <div className="bg-[var(--bg-secondary)] px-4 py-2 rounded-full text-sm font-medium text-orange-500">
                Slow down! Clicks are debounced.
              </div>
            </div>
          )}
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </main>
      <CommandPalette />
    </div>
  );
}
