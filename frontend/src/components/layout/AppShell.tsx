"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandBar } from "@/components/composite/CommandBar";
import { useAuthStore } from "@/lib/store/useAuthStore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;
    
    // Redirect unauthenticated users away from protected routes
    if (!user && pathname !== "/login") {
      router.push("/login");
    }
    
    // Redirect authenticated users away from login
    if (user && pathname === "/login") {
      router.push("/briefing");
    }
  }, [user, pathname, router, isMounted]);

  // Don't render anything until mounted to prevent hydration mismatch flashes
  if (!isMounted) {
    return null;
  }

  if (pathname === "/login") {
    return (
      <main id="main-content" className="min-h-screen bg-[#09090b]" role="main">
        {children}
      </main>
    );
  }

  return (
    <>
      <div className="app-layout">
        <TopBar />
        <Sidebar />
        <main id="main-content" className="app-main" role="main">
          {children}
        </main>
      </div>
      <CommandBar />
    </>
  );
}
