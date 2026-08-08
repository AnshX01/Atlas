"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ArrowRight, Mail, Lock, User } from "lucide-react";
import { useAuthStore } from "../../lib/store/useAuthStore";
import { authAPI } from "../../lib/api/auth";

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError(null);
    setLoading(true);

    try {
      if (isRegister) {
        if (!otpStep) {
          // Step 1: Generate OTP and show verification UI
          const code = Math.floor(100000 + Math.random() * 900000).toString();
          setGeneratedOtp(code);
          setOtpStep(true);
          // Show the OTP (in a real app this would be emailed)
          setGlobalError(null);
          setLoading(false);
          return; // Don't proceed with registration yet
        } else {
          // Step 2: Verify OTP then register
          if (otpInput !== generatedOtp) {
            setGlobalError('Invalid verification code. Please try again.');
            setLoading(false);
            return;
          }
          // OTP correct - proceed with registration
        }
      }

      // Try Electron IPC first (desktop mode)
      if (typeof window !== "undefined" && window.atlasElectron?.localAuth) {
        const localAuth = window.atlasElectron.localAuth;
        let user;

        if (isRegister) {
          user = await localAuth.register(email.value, password.value, fullName.value || undefined);
        } else {
          user = await localAuth.login(email.value, password.value);
        }

        setUser({
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          avatar_url: user.avatar_url,
          is_active: user.is_active,
          created_at: user.created_at,
        });
        router.push("/dashboard");
      } else {
        // Fallback to API calls (dev mode without Electron)
        if (isRegister) {
          const data = await authAPI.register(email.value, password.value, fullName.value || undefined);
          setUser({
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.full_name,
            avatar_url: data.user.avatar_url,
            is_active: data.user.is_active,
            created_at: data.user.created_at,
          });
        } else {
          const data = await authAPI.login(email.value, password.value);
          setUser({
            id: data.user.id,
            email: data.user.email,
            full_name: data.user.full_name,
            avatar_url: data.user.avatar_url,
            is_active: data.user.is_active,
            created_at: data.user.created_at,
          });
        }
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message ||
        "Authentication failed. Please try again.";
      setGlobalError(message);
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
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)" }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full opacity-10"
          style={{ background: "radial-gradient(circle, #6366f1 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full opacity-5"
          style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 60%)" }}
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
                  background: (i === 1) === isRegister ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  color: (i === 1) === isRegister ? "#60a5fa" : "rgba(255,255,255,0.4)",
                  boxShadow: (i === 1) === isRegister ? "0 0 12px rgba(59, 130, 246, 0.2)" : "none",
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
                      onFocus={(e) => { e.target.style.borderColor = "rgba(59, 130, 246, 0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.08)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
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
                  onFocus={(e) => { e.target.style.borderColor = "rgba(59, 130, 246, 0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.08)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
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
                  onFocus={(e) => { e.target.style.borderColor = "rgba(59, 130, 246, 0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(59, 130, 246, 0.08)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
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
                <div className="p-3 rounded-xl mb-4" style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                  <p className="text-xs text-blue-400 mb-1 font-medium">Verification Code</p>
                  <p className="text-[11px] text-white/50">Your code: <span className="font-mono text-white/90 select-all">{generatedOtp}</span></p>
                  <p className="text-[10px] text-white/30 mt-1">In production, this would be sent to your email.</p>
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
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white mt-6 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{
                background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                boxShadow: loading ? "none" : "0 0 24px rgba(59, 130, 246, 0.3), 0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {isRegister ? (otpStep ? 'Verify & Create Account' : 'Send Verification Code') : 'Continue'}
                  <ArrowRight size={15} />
                </>
              )}
            </motion.button>
          </form>

          {/* Footer note */}
          <p className="mt-6 text-center text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
            Your data never leaves your machine.{" "}
            <span style={{ color: "rgba(59, 130, 246, 0.7)" }}>Privacy-first by design.</span>
          </p>
        </div>

        {/* Version tag */}
        <p className="mt-6 text-center text-[11px]" style={{ color: "rgba(255,255,255,0.15)" }}>
          Atlas v0.1.0 · Beta
        </p>
      </motion.div>
    </div>
  );
}
