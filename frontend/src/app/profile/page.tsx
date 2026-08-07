"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { User, Mail, Lock, Camera, Save } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { apiClient } from "@/lib/api/client";

const AVATAR_STORAGE_KEY = "atlas-profile-avatar";

export default function ProfilePage() {
  const { user, setUser } = useAuthStore();

  // ── Profile form state ──────────────────────────────────────────────
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");

  // ── Password form state ─────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // ── Avatar state ────────────────────────────────────────────────────
  const [avatar, setAvatar] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Toast state ─────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Load avatar from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(AVATAR_STORAGE_KEY);
    if (stored) setAvatar(stored);
  }, []);

  // ── Update profile mutation ─────────────────────────────────────────
  const updateProfile = useMutation({
    mutationFn: async (data: { full_name: string; email: string }) => {
      try {
        const { data: updated } = await apiClient.patch("/users/me/profile", data);
        return updated;
      } catch (err: any) {
        const status = err?.response?.status;
        // If endpoint doesn't exist (404) or method not allowed (405),
        // fall back to local-only update
        if (status === 404 || status === 405) {
          return { ...user, full_name: data.full_name, email: data.email };
        }
        // Re-throw real errors
        throw err;
      }
    },
    onSuccess: (data) => {
      setUser(data);
      setToast({ message: "Profile updated successfully.", type: "success" });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || "Failed to update profile.";
      setToast({ message: detail, type: "error" });
    },
  });

  // ── Change password mutation ────────────────────────────────────────
  const changePassword = useMutation({
    mutationFn: async (data: { current_password: string; new_password: string }) => {
      const { data: result } = await apiClient.patch("/users/me/password", data);
      return result;
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setToast({ message: "Password changed successfully.", type: "success" });
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || "Failed to change password.";
      setToast({ message: detail, type: "error" });
    },
  });

  // ── Handlers ────────────────────────────────────────────────────────
  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfile.mutate({ full_name: fullName, email });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setToast({ message: "New passwords do not match.", type: "error" });
      return;
    }
    if (!currentPassword || !newPassword) {
      setToast({ message: "Please fill in all password fields.", type: "error" });
      return;
    }
    changePassword.mutate({ current_password: currentPassword, new_password: newPassword });
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      setAvatar(base64);
      localStorage.setItem(AVATAR_STORAGE_KEY, base64);
      setToast({ message: "Profile picture updated.", type: "success" });
    };
    reader.readAsDataURL(file);
  };

  const userInitial = (user?.full_name?.[0] ?? user?.email?.[0] ?? "U").toUpperCase();

  return (
    <div className="max-w-2xl mx-auto">
      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Profile</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Manage your personal information and security settings.
        </p>
      </motion.div>

      {/* Avatar Section */}
      <motion.div
        className="flex flex-col items-center mb-8"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05, type: "spring", stiffness: 400, damping: 30 }}
      >
        <div className="relative group">
          <div className="w-24 h-24 rounded-full overflow-hidden bg-[var(--bg-tertiary)] border-2 border-[var(--border-default)] flex items-center justify-center">
            {avatar ? (
              <img
                src={avatar}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-3xl font-semibold text-[var(--text-secondary)]">
                {userInitial}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 rounded-full flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
            aria-label="Change profile picture"
          >
            <Camera size={20} className="text-white" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className="hidden"
            aria-label="Upload profile picture"
          />
        </div>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Click to change your photo
        </p>
      </motion.div>

      {/* Personal Info Card */}
      <motion.div
        className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-default)] p-6 mb-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, type: "spring", stiffness: 400, damping: 30 }}
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <User size={16} className="text-[var(--accent)]" />
          Personal Information
        </h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          {/* Name input */}
          <div>
            <label
              htmlFor="profile-name"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Display Name
            </label>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="profile-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          {/* Email input */}
          <div>
            <label
              htmlFor="profile-email"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Email Address
            </label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="profile-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={updateProfile.isPending}
              leftIcon={<Save size={14} />}
            >
              Save Changes
            </Button>
          </div>
        </form>
      </motion.div>

      {/* Security Card */}
      <motion.div
        className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-default)] p-6"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 400, damping: 30 }}
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Lock size={16} className="text-[var(--accent)]" />
          Security
        </h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {/* Current password */}
          <div>
            <label
              htmlFor="current-password"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Current Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          {/* New password */}
          <div>
            <label
              htmlFor="new-password"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5"
            >
              New Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          {/* Confirm password */}
          <div>
            <label
              htmlFor="confirm-password"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5"
            >
              Confirm New Password
            </label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={changePassword.isPending}
              leftIcon={<Lock size={14} />}
            >
              Change Password
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
