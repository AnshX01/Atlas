import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "./providers";
import { AppShell } from "@/components/layout/AppShell";
import "@/styles/globals.css";
import "@/styles/animations.css";

import { OnboardingWizard } from "@/components/layout/OnboardingWizard";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Toaster } from "react-hot-toast";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Atlas",
  description: "Atlas",
  keywords: ["AI", "productivity"],
  openGraph: {
    title: "Atlas",
    description: "Atlas",
    type: "website",
  },
  metadataBase: new URL("http://localhost:3000"),
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
      <body className={`${inter.className} antialiased flex flex-col h-screen overflow-hidden`}>
        <div className="flex-1 overflow-auto relative">
          <OfflineBanner />
        {/* Skip to main content — WCAG 2.1 AA */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-[var(--accent)] focus:text-white focus:rounded-xl"
        >
          Skip to main content
        </a>

        <Providers>
          <OnboardingWizard>
            <AppShell>
              {children}
            </AppShell>
          </OnboardingWizard>
        </Providers>
        <Toaster position="bottom-center" />
        </div>
      </body>
    </html>
  );
}
