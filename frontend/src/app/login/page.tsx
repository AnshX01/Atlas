"use client";

import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, Mail, Lock, User } from "lucide-react";
import { useAuthStore } from "../../lib/store/useAuthStore";
import { authAPI } from "../../lib/api/auth";
import { tokenSyncAPI } from "../../lib/api/token-sync";
import { apiClient } from "../../lib/api/client";
import { conversationSyncAPI } from "@/lib/api/conversation-sync";
import { useChatStore } from "@/lib/store/useChatStore";
import { Toast } from "@/components/ui/Toast";

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [offlineToast, setOfflineToast] = useState(false);
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const setTokens = useAuthStore((state) => state.setTokens);
  const submittingRef = useRef(false);

  const switchMode = useCallback((register: boolean) => {
    setIsRegister(register);
    setError(null);
    setOtpStep(false);
    setOtpInput("");
    setGeneratedOtp("");
  }, []);

  const handleLoginSuccess = useCallback((user: any) => {
    setUser(user);
    // Background sync — download all user data from cloud (don't block navigation)
    // 1. Download connector tokens and save to Electron token store
    tokenSyncAPI.downloadTokens().then((tokens) => {
      for (const [provider, creds] of Object.entries(tokens)) {
        localStorage.setItem(`atlas_connector_${provider}`, JSON.stringify(creds));
        (window as any).atlasElectron?.tokenStore?.set(provider, creds);
      }
    }).catch(() => {});
    // 2. Download conversations from cloud and merge into local store
    conversationSyncAPI.listConversations().then((conversations) => {
      if (conversations.length > 0) {
        const store = useChatStore.getState();
        const existingIds = new Set(store.conversations.map((c: any) => c.id));
        for (const conv of conversations) {
          if (!existingIds.has(conv.id)) {
            // Add cloud conversation to local store
            store.conversations.unshift({
              id: conv.id,
              title: conv.title,
              createdAt: conv.created_at,
              lastMessage: conv.last_message,
            });
          }
        }
      }
    }).catch(() => {});
    // 3. Download avatar
    apiClient.get('/users/me/avatar').then(({ data }) => {
      if (data.image_data) {
        localStorage.setItem('atlas-profile-avatar', data.image_data);
        window.dispatchEvent(new Event('atlas-avatar-updated'));
      }
    }).catch(() => {});
    router.push("/dashboard");
  }, [setUser, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;

    setError(null);
    setLoading(true);

    const currentEmail = email.trim();
    const currentPassword = password;
    const currentFullName = fullName.trim();

    if (!currentEmail || !currentPassword) {
      setError("Please fill in all required fields.");
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    if (isRegister && !otpStep) {
      // Step 1: Send OTP
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/v1/auth/send-otp`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: currentEmail }),
            signal: AbortSignal.timeout(5000),
          }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Failed to send code");
        if (data.dev_otp) setGeneratedOtp(data.dev_otp);
      } catch {
        // Backend unavailable — generate OTP locally for dev
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(code);
      }
      setOtpStep(true);
      setLoading(false);
      submittingRef.current = false;
      return;
    }

    if (isRegister && otpStep) {
      // Step 2: Verify OTP then register
      if (generatedOtp && otpInput !== generatedOtp) {
        setError("Invalid verification code.");
        setLoading(false);
        submittingRef.current = false;
        return;
      }
    }

    try {
      // Try backend first
      if (isRegister) {
        const data = await authAPI.register(currentEmail, currentPassword, currentFullName || undefined);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        handleLoginSuccess(data.user);
      } else {
        const data = await authAPI.login(currentEmail, currentPassword);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        handleLoginSuccess(data.user);
      }
    } catch (err: any) {
      // If backend is unreachable, try local auth
      const isNetworkError = !err?.response;

      if (isNetworkError && (window as any).atlasElectron?.localAuth) {
        try {
          const localAuth = (window as any).atlasElectron.localAuth;
          const localUser = isRegister
            ? await localAuth.register(currentEmail, currentPassword, currentFullName)
            : await localAuth.login(currentEmail, currentPassword);
          setUser({ ...localUser, is_active: true, avatar_url: null } as any);
          setOfflineToast(true);
          router.push("/dashboard");
        } catch (localErr: any) {
          setError(localErr.message || "Authentication failed. Please check your credentials.");
        }
      } else if (err?.response?.data?.detail) {
        const detail = err.response.data.detail;
        if (detail.includes("Google")) {
          setError("This account uses Google sign-in. Please click 'Continue with Google' below.");
        } else if (detail.includes("Invalid") || detail.includes("incorrect")) {
          setError("Incorrect email or password.");
        } else if (detail.includes("exists") || detail.includes("already")) {
          setError("An account with this email already exists. Try signing in instead.");
        } else {
          setError(detail);
        }
      } else if (isNetworkError) {
        setError("Unable to connect to server. Please check your connection.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleGoogleLogin = useCallback(async () => {
    setError(null);
    setLoading(true);

    const oauthUrl = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/v1/auth/oauth/google/login/initiate`;
    const electron = (window as any).atlasElectron;

    if (electron?.openExternal) {
      electron.openExternal(oauthUrl);
    } else {
      window.open(oauthUrl, "_blank");
    }

    // Listen for OAuth callback via Electron IPC
    if (electron?.onOAuthCallback) {
      const unsub = electron.onOAuthCallback(async (data: { access_token?: string; refresh_token?: string; error?: string }) => {
        unsub();
        if (data.error) {
          setError("Google sign-in failed. Please try again.");
          setLoading(false);
          return;
        }
        if (data.access_token && data.refresh_token) {
          try {
            setTokens(data.access_token, data.refresh_token);
            const user = await authAPI.getMe();
            handleLoginSuccess(user);
          } catch {
            setError("Google sign-in failed. Please try again.");
            setLoading(false);
          }
        } else {
          setError("Google sign-in failed. Please try again.");
          setLoading(false);
        }
      });
      // Timeout after 2 minutes
      setTimeout(() => {
        unsub();
        if (loading) setLoading(false);
      }, 120000);
    } else {
      // Browser mode — redirect-based flow, user won't return here
      setLoading(false);
    }
  }, [setTokens, handleLoginSuccess, loading]);


  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] relative overflow-hidden p-4">
      {/* Ambient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)" }}
        />
      </div>

      <div
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)`,
          backgroundSize: "40px 40px",
        }}
      />

      <motion.div
        className="w-full max-w-sm relative z-10"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        {/* Logo */}
        <motion.div
          className="flex items-center justify-center gap-3 mb-10"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
        >
          <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center shadow-lg">
            <img src="/logo.png" alt="Atlas" className="w-7 h-7" />
          </div>
          <span className="text-xl font-bold text-white tracking-tight">Atlas</span>
        </motion.div>

        {/* Card */}
        <div
          className="rounded-2xl border border-white/[0.08] p-8"
          style={{
            background: "rgba(17, 17, 19, 0.8)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 32px 64px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* Tab switcher */}
          <div
            className="flex p-1 rounded-xl mb-8"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            {["Sign In", "Sign Up"].map((tab, i) => (
              <button
                key={tab}
                type="button"
                onClick={() => switchMode(i === 1)}
                className="flex-1 py-2 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  background: (i === 1) === isRegister ? "rgba(255, 255, 255, 0.1)" : "transparent",
                  color: (i === 1) === isRegister ? "#ffffff" : "rgba(255,255,255,0.4)",
                  boxShadow: (i === 1) === isRegister ? "0 0 12px rgba(255, 255, 255, 0.05)" : "none",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Error message — persistent until cleared */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="mb-5 p-3 rounded-xl text-sm"
                style={{
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                }}
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name (register only) */}
            <AnimatePresence>
              {isRegister && !otpStep && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                >
                  <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                    Full Name
                  </label>
                  <div className="relative">
                    <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full Name"
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            {!otpStep && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Password */}
            {!otpStep && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Password
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-11 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "rgba(255,255,255,0.3)" }}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {isRegister && (
                  <p className="mt-1.5 text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
                    Min 8 characters, one uppercase, one digit.
                  </p>
                )}
              </div>
            )}


            {/* OTP Verification Step */}
            {isRegister && otpStep && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                <div className="p-3 rounded-xl mb-4" style={{ background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
                  <p className="text-xs text-white/70 mb-1 font-medium">Verification Code</p>
                  {generatedOtp ? (
                    <>
                      <p className="text-[11px] text-white/50">Dev mode code: <span className="font-mono text-white/90 select-all">{generatedOtp}</span></p>
                      <p className="text-[10px] text-white/30 mt-1">In production, this would be sent to your email.</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-white/50">A 6-digit code has been sent to <span className="text-white/90">{email}</span></p>
                  )}
                </div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                  Enter 6-digit code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white text-center font-mono tracking-[0.5em] placeholder-white/20 outline-none"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  autoFocus
                />
              </motion.div>
            )}

            {/* Submit button */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-[#09090b] mt-6 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{
                background: "#e4e4e7",
                boxShadow: loading ? "none" : "0 0 24px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-[#09090b]/30 border-t-[#09090b] rounded-full animate-spin" />
              ) : (
                <>
                  {isRegister ? (otpStep ? "Verify & Create Account" : "Send Verification Code") : "Continue"}
                  <ArrowRight size={15} />
                </>
              )}
            </motion.button>
          </form>

          {/* Separator */}
          <div className="my-6 flex items-center justify-between">
            <span className="w-1/5 border-b border-white/[0.08]"></span>
            <span className="text-[11px] font-medium uppercase text-white/30 tracking-widest">or</span>
            <span className="w-1/5 border-b border-white/[0.08]"></span>
          </div>

          {/* Google Login Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.8)",
            }}
            onMouseOver={(e) => { if (!loading) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        {/* Version tag */}
        <p className="mt-6 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.15)" }}>
          Atlas v0.1.0 · Beta
        </p>
      </motion.div>

      {/* Offline auth toast */}
      {offlineToast && (
        <Toast
          message="Working offline — using local account (cross-device sync unavailable)"
          type="success"
          duration={5000}
          onClose={() => setOfflineToast(false)}
        />
      )}
    </div>
  );
}
