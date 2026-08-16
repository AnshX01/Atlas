"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Spinner } from "@/components/ui/Spinner";

function OAuthCallbackInner() {
  const searchParams = useSearchParams();
  const accessToken = searchParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token");
  const error = searchParams.get("error");

  useEffect(() => {
    if (accessToken && refreshToken) {
      // Store tokens in localStorage so the Electron app can pick them up
      localStorage.setItem("atlas-oauth-result", JSON.stringify({
        access_token: accessToken,
        refresh_token: refreshToken,
        timestamp: Date.now(),
      }));
    }
  }, [accessToken, refreshToken]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-white">
        <div className="text-center">
          <p className="text-lg font-semibold mb-2">Sign in failed</p>
          <p className="text-sm text-white/50">Please close this tab and try again.</p>
        </div>
      </div>
    );
  }

  if (accessToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-white">
        <div className="text-center">
          <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center mx-auto mb-4">
            <img src="/logo.png" alt="Atlas" className="w-8 h-8" />
          </div>
          <p className="text-lg font-semibold mb-2">Signed in successfully!</p>
          <p className="text-sm text-white/50">You can close this tab and return to Atlas.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <Spinner size="md" />
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-[#09090b]"><Spinner size="md" /></div>}>
      <OAuthCallbackInner />
    </Suspense>
  );
}
