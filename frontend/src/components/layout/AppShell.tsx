"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandBar } from "@/components/composite/CommandBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  
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
