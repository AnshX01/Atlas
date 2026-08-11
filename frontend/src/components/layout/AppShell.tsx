"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageTransition } from "@/components/layout/PageTransition";
import { useAuthStore } from "@/lib/store/useAuthStore";

import { useWebSocket } from "@/lib/hooks/useWebSocket";

function HydrationSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="w-5 h-5 border-2 border-white/20 border-t-white/80 rounded-full animate-spin" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isHydrated } = useAuthStore();
  const [isMounted, setIsMounted] = useState(false);

  useWebSocket();

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
        {/* Ambient background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
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
    </div>
  );
}
