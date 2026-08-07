"use client";

import { motion } from "framer-motion";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Settings, Zap, Shield, Bell, Plug, ChevronRight, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { connectorsAPI, ConnectorResponse } from "@/lib/api/connectors";
import { useAppStore } from "@/lib/store/useAppStore";
import { useAuthStore } from "@/lib/store/useAuthStore";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

type SettingsSection = "general" | "integrations" | "ai" | "privacy" | "notifications";

const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general",       label: "General",       icon: <Settings size={15} /> },
  { id: "integrations",  label: "Integrations",  icon: <Plug size={15} /> },
  { id: "ai",            label: "AI & Models",   icon: <Zap size={15} /> },
  { id: "privacy",       label: "Privacy",        icon: <Shield size={15} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={15} /> },
];

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[var(--border-subtle)] last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  id,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  label: string;
}) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0",
        checked ? "bg-[var(--accent)]" : "bg-[var(--bg-tertiary)] border border-[var(--border-default)]"
      )}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? 18 : 0 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

function SettingsToasts() {
  const searchParams = useSearchParams();
  const connectedParam = searchParams.get("connected");
  const errorParam = searchParams.get("error");

  return (
    <>
      {connectedParam && (
        <Toast message={`Successfully connected ${connectedParam}`} type="success" />
      )}
      {errorParam && (
        <Toast message={`Connection failed: ${errorParam}`} type="error" />
      )}
    </>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const { theme, toggleTheme } = useAppStore();
  const { user, setUser } = useAuthStore();
  
  const queryClient = useQueryClient();
  
  // Settings state initialized from user object
  const [strictLocal, setStrictLocal] = useState(user?.settings_json?.strict_local ?? false);
  const [draftedByAtlas, setDraftedByAtlas] = useState(user?.settings_json?.drafted_by_atlas ?? false);
  const [notifications, setNotifications] = useState(user?.settings_json?.notifications ?? true);

  // Local FS config state
  const [showLocalFsForm, setShowLocalFsForm] = useState(false);
  const [localFsPaths, setLocalFsPaths] = useState("");
  const [localFsError, setLocalFsError] = useState<string | null>(null);

  // Fetch Connectors
  const { data: connectors = [] } = useQuery({
    queryKey: ["connectors"],
    queryFn: connectorsAPI.listConnectors,
  });

  // Configure Local FS mutation
  const configureLocalFs = useMutation({
    mutationFn: (watchPaths: string[]) => connectorsAPI.configureLocalFs(watchPaths),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      setShowLocalFsForm(false);
      setLocalFsPaths("");
      setLocalFsError(null);
    },
    onError: (err: any) => {
      setLocalFsError(err?.response?.data?.detail || "Failed to configure Local Files connector");
    },
  });

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (newSettings: any) => {
      const { data } = await apiClient.patch("/users/me/settings", { settings: newSettings });
      return data;
    },
    onSuccess: (data) => {
      setUser(data);
    }
  });

  const handleStrictLocalChange = (val: boolean) => {
    setStrictLocal(val);
    updateSettings.mutate({ strict_local: val });
  };
  
  const handleDraftedChange = (val: boolean) => {
    setDraftedByAtlas(val);
    updateSettings.mutate({ drafted_by_atlas: val });
  };

  const getConnectorStatus = (providerId: string) => {
    const c = connectors.find(c => c.provider === providerId);
    return c ? (c.status === "active" ? "active" : "inactive") : "unconnected";
  };

  return (
    <div className="max-w-3xl mx-auto">
      <Suspense fallback={null}>
        <SettingsToasts />
      </Suspense>
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
      >
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Settings</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Configure Atlas to match your workflow.
        </p>
      </motion.div>

      <div className="flex gap-6">
        {/* Section nav */}
        <motion.nav
          className="flex flex-col gap-0.5 w-44 flex-shrink-0"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          aria-label="Settings sections"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              id={`settings-nav-${s.id}`}
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-left transition-all duration-150",
                activeSection === s.id
                  ? "bg-[var(--accent)]/10 text-[var(--accent)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              )}
            >
              <span className={activeSection === s.id ? "text-[var(--accent)]" : "text-[var(--text-muted)]"}>
                {s.icon}
              </span>
              {s.label}
              {activeSection === s.id && (
                <ChevronRight size={12} className="ml-auto" />
              )}
            </button>
          ))}
        </motion.nav>

        {/* Content panel */}
        <motion.div
          key={activeSection}
          className="flex-1 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-default)] p-5"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          {activeSection === "general" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">General</h2>
              <SettingRow label="Appearance" description="Choose your preferred color theme.">
                <button
                  id="settings-theme-toggle"
                  onClick={toggleTheme}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
                  aria-label={`Current theme: ${theme}. Click to toggle.`}
                >
                  {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                  <span className="capitalize">{theme}</span>
                </button>
              </SettingRow>
              <SettingRow label="Keyboard Shortcut" description="Global shortcut to open the command bar.">
                <span className="text-sm font-mono bg-[var(--bg-tertiary)] border border-[var(--border-default)] px-2.5 py-1 rounded-lg text-[var(--text-secondary)]">
                  ⌘ Space
                </span>
              </SettingRow>
            </>
          )}

          {activeSection === "ai" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">AI & Models</h2>
              <SettingRow
                label="Strict Local Mode"
                description="Route all AI processing through local Ollama (Llama 3 8B). No data leaves your machine. Requires Ollama running locally."
              >
                <Toggle
                  id="settings-strict-local"
                  checked={strictLocal}
                  onChange={handleStrictLocalChange}
                  label="Toggle strict local mode"
                />
              </SettingRow>
              <SettingRow label="Active Model" description="The LLM used for briefings and search.">
                <span className="text-sm text-[var(--text-secondary)] font-mono">
                  {strictLocal ? "llama3:8b (local)" : "gpt-4o"}
                </span>
              </SettingRow>
              <SettingRow
                label='"Drafted by Atlas" Signature'
                description="Append a subtle Atlas signature to emails drafted by the Action Agent. Disabled for Pro users by default."
              >
                <Toggle
                  id="settings-drafted-by-atlas"
                  checked={draftedByAtlas}
                  onChange={handleDraftedChange}
                  label="Toggle drafted by Atlas signature"
                />
              </SettingRow>
            </>
          )}

          {activeSection === "privacy" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Privacy</h2>
              <SettingRow
                label="Data Retention"
                description="How long Atlas retains indexed content in the knowledge graph."
              >
                <span className="text-sm text-[var(--text-secondary)]">Infinite (Pro)</span>
              </SettingRow>
              <SettingRow
                label="Delete All Data"
                description="Permanently remove all indexed data, vectors, and graph nodes. This action cannot be undone."
              >
                <Button size="sm" variant="danger" id="settings-delete-all-data">
                  Delete All Data
                </Button>
              </SettingRow>
            </>
          )}

          {activeSection === "notifications" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Notifications</h2>
              <SettingRow label="Push Notifications" description="Receive OS notifications for urgent items.">
                <Toggle
                  id="settings-push-notifications"
                  checked={notifications}
                  onChange={setNotifications}
                  label="Toggle push notifications"
                />
              </SettingRow>
            </>
          )}

          {activeSection === "integrations" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Integrations</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Connect your tools to build your personal knowledge graph.
              </p>
              {[
                { name: "Google Workspace", desc: "Gmail & Calendar", status: getConnectorStatus("google_workspace"), id: "google_workspace" },
                { name: "GitHub",           desc: "Issues & Pull Requests", status: getConnectorStatus("github"), id: "github" },
                { name: "Local Files",      desc: "Documents & Code", status: getConnectorStatus("local_fs"), id: "local_fs" },
                { name: "Slack",            desc: "Messages & Threads", status: "coming_soon", id: "slack" },
                { name: "Notion",           desc: "Pages & Databases", status: "coming_soon", id: "notion" },
              ].map((integration) => (
                <div key={integration.id}>
                  <div
                    className="flex items-center justify-between py-3 border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{integration.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{integration.desc}</p>
                    </div>
                    {integration.status === "coming_soon" ? (
                      <span className="text-xs px-2 py-1 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                        Coming Soon
                      </span>
                    ) : integration.id === "local_fs" && integration.status === "active" ? (
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        id={`reconfigure-${integration.id}`}
                        onClick={() => {
                          // Pre-fill with existing paths from connector config
                          const connector = connectors.find(c => c.provider === "local_fs");
                          if (connector?.display_name) {
                            try {
                              const config = JSON.parse(connector.display_name);
                              if (config.watch_paths && Array.isArray(config.watch_paths)) {
                                setLocalFsPaths(config.watch_paths.join("\n"));
                              }
                            } catch {
                              // display_name wasn't JSON, ignore
                            }
                          }
                          setShowLocalFsForm(true);
                        }}
                      >
                        Reconfigure
                      </Button>
                    ) : integration.status === "active" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-400 font-medium">Connected</span>
                        <Button 
                          size="sm" 
                          variant="danger" 
                          id={`disconnect-${integration.id}`}
                          onClick={async () => {
                            if (confirm(`Disconnect ${integration.name}? You can reconnect later.`)) {
                              await connectorsAPI.disconnect(integration.id as any);
                              queryClient.invalidateQueries({ queryKey: ["connectors"] });
                            }
                          }}
                        >
                          Disconnect
                        </Button>
                      </div>
                    ) : (
                      <Button 
                        size="sm" 
                        variant="primary" 
                        id={`connect-${integration.id}`}
                        onClick={() => {
                          if (integration.id === "google_workspace") {
                            connectorsAPI.initiateOAuth("google");
                          } else if (integration.id === "github") {
                            connectorsAPI.initiateOAuth("github");
                          } else if (integration.id === "local_fs") {
                            setShowLocalFsForm(true);
                          }
                        }}
                      >
                        Connect
                      </Button>
                    )}
                  </div>

                  {/* Local Files inline configuration form */}
                  {integration.id === "local_fs" && showLocalFsForm && (
                    <motion.div
                      className="py-3 px-4 my-2 rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-default)]"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    >
                      <label
                        htmlFor="local-fs-paths"
                        className="block text-sm font-medium text-[var(--text-primary)] mb-1.5"
                      >
                        Directory paths to watch
                      </label>
                      <p className="text-xs text-[var(--text-muted)] mb-2">
                        {integration.status === "active"
                          ? "Edit paths or add new directories. Atlas will re-index and monitor these folders."
                          : "Enter one directory path per line. Atlas will index and monitor these folders."}
                      </p>
                      <textarea
                        id="local-fs-paths"
                        value={localFsPaths}
                        onChange={(e) => setLocalFsPaths(e.target.value)}
                        placeholder={"C:\\Users\\you\\Documents\nC:\\Projects\\my-app"}
                        rows={3}
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
                      />
                      {localFsError && (
                        <p className="text-xs text-red-400 mt-1.5">{localFsError}</p>
                      )}
                      <div className="flex gap-2 mt-3">
                        <Button
                          size="sm"
                          variant="primary"
                          id="local-fs-submit"
                          disabled={configureLocalFs.isPending || !localFsPaths.trim()}
                          onClick={() => {
                            const paths = localFsPaths
                              .split("\n")
                              .map((p) => p.trim())
                              .filter(Boolean);
                            if (paths.length > 0) {
                              configureLocalFs.mutate(paths);
                            }
                          }}
                        >
                          {configureLocalFs.isPending
                            ? "Saving…"
                            : integration.status === "active"
                            ? "Save Changes"
                            : "Connect"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          id="local-fs-cancel"
                          onClick={() => {
                            setShowLocalFsForm(false);
                            setLocalFsPaths("");
                            setLocalFsError(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </motion.div>
                  )}
                </div>
              ))}
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
