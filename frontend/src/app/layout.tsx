import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import "@/styles/globals.css";
import "@/styles/animations.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas",
  description:
    "Atlas is the world's first AI Chief of Staff for knowledge workers. Connect Gmail, GitHub, Slack, and more into a single unified briefing.",
  keywords: ["AI", "productivity", "knowledge management", "personal assistant"],
  authors: [{ name: "Atlas" }],
  openGraph: {
    title: "Atlas",
    description: "Your AI Chief of Staff — unified, prioritized, proactive.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${inter.variable}`} suppressHydrationWarning>
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body className={inter.className}>
        {/* Skip to main content — WCAG 2.1 AA */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded-xl"
        >
          Skip to main content
        </a>

        <Providers>
          <AppShell>
            {children}
          </AppShell>
        </Providers>
      </body>
    </html>
  );
}
