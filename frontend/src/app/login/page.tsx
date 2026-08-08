"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, Mail, Lock, User } from "lucide-react";
import { useAuthStore } from "../../lib/store/useAuthStore";
import { authAPI } from "../../lib/api/auth";
import { tokenSyncAPI } from "../../lib/api/token-sync";
import { apiClient } from "../../lib/api/client";

interface FormField {
  value: string;
  error: string;
}

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState<FormField>({ value: "", error: "" });
  const [password, setPassword] = useState<FormField>({ value: "", error: "" });
  const [fullName, setFullName] = useState<FormField>({ value: "", error: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const setTokens = useAuthStore((state) => state.setTokens);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    setLoading(true);

    try {
      if (isRegister) {
        if (!otpStep) {
          // Try backend OTP, fall back to local code generation
          try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/v1/auth/send-otp`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: email.value }),
              signal: AbortSignal.timeout(5000),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed');
            if (data.dev_otp) setGeneratedOtp(data.dev_otp);
          } catch {
            // Backend unavailable - generate OTP locally
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            setGeneratedOtp(code);
          }
          setOtpStep(true);
          setLoading(false);
          return;
        } else {
          // Verify OTP (if we have the generated OTP locally for dev, check locally; otherwise trust backend)
          if (generatedOtp && otpInput !== generatedOtp) {
            setGlobalError('Invalid verification code.');
            setLoading(false);
            return;
          }
        }
        // Register via backend API
        const data = await authAPI.register(email.value, password.value, fullName.value || undefined);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        setUser(data.user);
      } else {
        // Login via backend API
        const data = await authAPI.login(email.value, password.value);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        setUser(data.user);
      }
      router.push('/dashboard');
      // Sync connector tokens from server to local device
      tokenSyncAPI.downloadTokens().then((tokens) => {
        for (const [provider, creds] of Object.entries(tokens)) {
          // Save to localStorage for the frontend
          localStorage.setItem(`atlas_connector_${provider}`, JSON.stringify(creds));
          // Save to Electron token store if available
          (window as any).atlasElectron?.tokenStore?.set(provider, creds);
        }
      });
      // Sync profile picture from cloud
      apiClient.get('/users/me/avatar').then(({ data }) => {
        if (data.image_data) {
          localStorage.setItem('atlas-profile-avatar', data.image_data);
          window.dispatchEvent(new Event('atlas-avatar-updated'));
        }
      }).catch(() => {});
    } catch (err: any) {
      // If backend unreachable, try local auth as fallback
      if (!err?.response && window.atlasElectron?.localAuth) {
        try {
          const localUser = isRegister
            ? await window.atlasElectron.localAuth.register(email.value, password.value, fullName.value)
            : await window.atlasElectron.localAuth.login(email.value, password.value);
          setUser({ ...localUser, is_active: true, avatar_url: null } as any);
          router.push('/dashboard');
          return;
        } catch (localErr: any) {
          setGlobalError(localErr.message || 'Authentication failed');
          return;
        }
      }
      setGlobalError(
        err?.response?.data?.detail === 'This account was created with Google. Please use \'Sign in with Google\' instead.'
          ? err.response.data.detail
          : err?.response?.data?.detail?.includes?.('Invalid')
            ? 'Incorrect email or password.'
            : !err?.response
              ? 'Unable to connect. Using offline mode.'
              : 'Something went wrong. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b] relative overflow-hidden p-4">
      {/* Ambient background orbs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-40 -left-40 w-96 h-96 rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.5) 0%, transparent 60%)" }}
        />
      </div>

      {/* Grid pattern */}
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
                onClick={() => {
                  setIsRegister(i === 1);
                  setGlobalError(null);
                  setOtpStep(false); setOtpInput(''); setGeneratedOtp('');
                }}
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

          {/* Error */}
          <AnimatePresence>
            {globalError && (
              <motion.div
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -8, height: 0 }}
                className="mb-5 p-3 rounded-xl text-sm"
                style={{
                  background: "rgba(239, 68, 68, 0.08)",
                  border: "1px solid rgba(239, 68, 68, 0.2)",
                  color: "#f87171",
                }}
              >
                {globalError}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name (register only) */}
            <AnimatePresence>
              {isRegister && (
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
                      id="login-fullname"
                      type="text"
                      value={fullName.value}
                      onChange={(e) => setFullName({ value: e.target.value, error: "" })}
                      placeholder="Full Name"
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: fullName.error ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.08)",
                      }}
                      onFocus={(e) => {}}
                      onBlur={(e) => {}}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Email Address
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email.value}
                  onChange={(e) => setEmail({ value: e.target.value, error: "" })}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: email.error ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  }}
                  onFocus={(e) => {}}
                  onBlur={(e) => {}}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }} />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password.value}
                  onChange={(e) => setPassword({ value: e.target.value, error: "" })}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-11 py-3 rounded-xl text-sm text-white placeholder-white/20 transition-all duration-200 outline-none"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: password.error ? "1px solid rgba(239,68,68,0.5)" : "1px solid rgba(255,255,255,0.08)",
                  }}
                  onFocus={(e) => {}}
                  onBlur={(e) => {}}
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
                  Min 8 chars, one uppercase letter, one digit.
                </p>
              )}
            </div>

            {/* OTP Verification Step */}
            {isRegister && otpStep && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <div className="p-3 rounded-xl mb-4" style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                  <p className="text-xs text-white/70 mb-1 font-medium">Verification Code</p>
                  {generatedOtp ? (
                    <>
                      <p className="text-[11px] text-white/50">Dev mode code: <span className="font-mono text-white/90 select-all">{generatedOtp}</span></p>
                      <p className="text-[10px] text-white/30 mt-1">In production, this would be sent to your email.</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-white/50">A 6-digit code has been sent to <span className="text-white/90">{email.value}</span></p>
                  )}
                </div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  Enter 6-digit code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="w-full px-4 py-3 rounded-xl text-sm text-white text-center font-mono tracking-[0.5em] placeholder-white/20 outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  autoFocus
                />
              </motion.div>
            )}

            {/* Submit button */}
            <motion.button
              id="login-submit-btn"
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
                  {isRegister ? (otpStep ? 'Verify & Create Account' : 'Send Verification Code') : 'Continue'}
                  <ArrowRight size={15} />
                </>
              )}
            </motion.button>
          </form>

        </div>

        {/* Version tag */}
        <p className="mt-6 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.15)" }}>
          Atlas v0.1.0 · Beta
        </p>
      </motion.div>
    </div>
  );
}
