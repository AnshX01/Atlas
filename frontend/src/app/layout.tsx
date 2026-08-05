import type { Metadata } from "next";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { CommandBar } from "@/components/composite/CommandBar";
import "@/styles/globals.css";
import "@/styles/animations.css";

export const metadata: Metadata = {
  title: "Atlas — Personal Command Center",
  description:
    "Atlas is the world's first AI Chief of Staff for knowledge workers. Connect Gmail, GitHub, Slack, and more into a single unified briefing.",
  keywords: ["AI", "productivity", "knowledge management", "personal assistant"],
  authors: [{ name: "Atlas" }],
  openGraph: {
    title: "Atlas — Personal Command Center",
    description: "Your AI Chief of Staff — unified, prioritized, proactive.",
    type: "website",
  },
};

// React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,   // 5 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body>
        {/* Skip to main content — WCAG 2.1 AA */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded-xl"
        >
          Skip to main content
        </a>

        <div className="app-layout">
          <TopBar />
          <Sidebar />
          <main id="main-content" className="app-main" role="main">
            {children}
          </main>
        </div>

        {/* Global Command Bar overlay */}
        <CommandBar />
      </body>
    </html>
  );
}
