"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { PageTransition } from "@/components/layout/PageTransition";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { OfflineBanner } from "@/components/layout/OfflineBanner";
import { useAuthStore } from "@/lib/store/useAuthStore";

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

  if (isLoginPage) {
    return (
      <main id="main-content" className="min-h-screen bg-[#09090b]" role="main">
        {children}
      </main>
    );
  }

  return (
    <>
      <OfflineBanner />
      <div className="app-layout">
        <TopBar />
        <Sidebar />
        <main id="main-content" className="app-main" role="main">
          <ErrorBoundary>
            <PageTransition>
              {children}
            </PageTransition>
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
}
