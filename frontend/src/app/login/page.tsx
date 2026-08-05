"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "../../lib/store/useAuthStore";
import { authAPI } from "../../lib/api/auth";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";

export default function LoginPage() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const setTokens = useAuthStore((state) => state.setTokens);
  const setUser = useAuthStore((state) => state.setUser);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        const data = await authAPI.register(email, password, fullName);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        setUser(data.user);
      } else {
        const data = await authAPI.login(email, password);
        setTokens(data.tokens.access_token, data.tokens.refresh_token);
        setUser(data.user);
      }
      router.push("/briefing");
    } catch (err: any) {
      setError(err.response?.data?.detail || "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <div className="w-full max-w-md bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden backdrop-blur-sm">
        <div className="p-8">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-white shadow-[0_0_15px_rgba(59,130,246,0.5)]">
              A
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Atlas</h1>
          </div>
          
          <h2 className="text-xl font-semibold text-white mb-6">
            {isRegister ? "Create an account" : "Welcome back"}
          </h2>
          
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  Full Name
                </label>
                <Input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="John Doe"
                  className="w-full bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-blue-500/20 transition-all"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                Email Address
              </label>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-blue-500/20 transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-1">
                Password
              </label>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-zinc-950 border-zinc-800 text-white placeholder-zinc-600 focus:border-blue-500/50 focus:ring-blue-500/20 transition-all"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-lg shadow-blue-500/20 transition-all"
            >
              {loading ? "Please wait..." : isRegister ? "Sign Up" : "Sign In"}
            </Button>
          </form>
          
          <div className="mt-6 text-center text-sm text-zinc-400">
            {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
            <button
              onClick={() => {
                setIsRegister(!isRegister);
                setError(null);
              }}
              className="text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              {isRegister ? "Sign In" : "Sign Up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
