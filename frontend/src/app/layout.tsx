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
        <Providers>
          {/* C-02: ErrorBoundary was imported but never used — any uncaught render
              error would produce a white screen. Now the entire app tree is wrapped
              so errors surface the built-in recovery UI instead of crashing. */}
          <ErrorBoundary>
            <OfflineBanner />
            <OnboardingWizard>
              <AppShell>
                {children}
              </AppShell>
            </OnboardingWizard>
          </ErrorBoundary>
        </Providers>
        <Toaster position="bottom-center" />
        </div>
      </body>
    </html>
  );
}
