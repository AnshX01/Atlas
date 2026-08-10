"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { PageTransition } from "@/components/layout/PageTransition";
import { useAuthStore } from "@/lib/store/useAuthStore";

import dynamic from "next/dynamic";

const CommandPalette = dynamic(
  () => import("@/components/ui/CommandPalette").then((mod) => mod.CommandPalette),
  { ssr: false }
);

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

  return (
    <div className="app-layout relative overflow-hidden bg-[var(--bg-primary)]">
      {/* Global Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 -left-1/4 w-[150%] h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/10 via-transparent to-transparent"></div>
        <div className="absolute bottom-0 -right-1/4 w-[150%] h-1/2 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-fuchsia-900/5 via-transparent to-transparent"></div>
      </div>

      <Sidebar />
      <main id="main-content" className="app-main !p-0 z-10 bg-transparent" role="main">
        <header className="sticky top-0 z-50 backdrop-blur-md bg-[var(--bg-primary)]/80 border-b border-[var(--border-subtle)] px-6 py-3">
          <CommandPalette />
        </header>
        <div className="p-8">
          <PageTransition>
            {children}
          </PageTransition>
        </div>
      </main>
    </div>
  );
}
