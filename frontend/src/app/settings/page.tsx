"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback } from "react";
import {
  Settings,
  Plug,
  ChevronRight,
  Moon,
  Sun,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  FolderPlus,
} from "lucide-react";
import {
  GoogleLogo,
  GitHubLogo,
  SlackLogo,
  NotionLogo,
  LocalFilesLogo,
} from "@/components/icons/ProviderLogos";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { useAppStore } from "@/lib/store/useAppStore";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type SettingsSection = "general" | "integrations";

type ConnectorId = "google_workspace" | "github" | "slack" | "notion" | "local_fs";

interface ConnectorField {
  key: string;
  label: string;
  placeholder: string;
  type: "password" | "textarea";
}

interface ConnectorConfig {
  id: ConnectorId;
  name: string;
  description: string;
  logo: React.ReactNode;
  helpText: string;
  fields: ConnectorField[];
}

interface ConnectorStatus {
  configured: boolean;
  testing?: boolean;
  testResult?: "success" | "error" | null;
  testMessage?: string;
}

// ─── Connector definitions ────────────────────────────────────────────────────

const connectorConfigs: ConnectorConfig[] = [
  {
    id: "google_workspace",
    name: "Google Workspace",
    description: "Gmail, Calendar & Tasks",
    logo: <GoogleLogo size={18} className="text-[#EA4335]" />,
    helpText:
      "Create a Google Cloud project, enable Gmail/Calendar APIs, create OAuth credentials. After entering your Client ID and Secret, click Connect to complete the OAuth flow.",
    fields: [
      {
        key: "client_id",
        label: "Client ID",
        placeholder: "your-client-id.apps.googleusercontent.com",
        type: "password",
      },
      {
        key: "client_secret",
        label: "Client Secret",
        placeholder: "GOCSPX-...",
        type: "password",
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Issues & Pull Requests",
    logo: <GitHubLogo size={18} className="text-[#181717] dark:text-white" />,
    helpText:
      "Generate a PAT at github.com/settings/tokens with repo, user scopes.",
    fields: [
      {
        key: "personal_access_token",
        label: "Personal Access Token",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        type: "password",
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Messages & Mentions",
    logo: <SlackLogo size={18} className="text-[#E01E5A]" />,
    helpText:
      "Create a Slack App at api.slack.com/apps, install to workspace, copy Bot Token.",
    fields: [
      {
        key: "bot_token",
        label: "Bot Token",
        placeholder: "xoxb-...",
        type: "password",
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Pages & Databases",
    logo: <NotionLogo size={18} className="text-[#000000] dark:text-white" />,
    helpText:
      "Create an integration at notion.so/my-integrations, copy the token.",
    fields: [
      {
        key: "integration_token",
        label: "Integration Token",
        placeholder: "secret_...",
        type: "password",
      },
    ],
  },
  {
    id: "local_fs",
    name: "Local Files",
    description: "Documents & Code",
    logo: <LocalFilesLogo size={18} className="text-amber-400" />,
    helpText:
      "Add directory paths that Atlas should index and monitor. Use the Browse button or type paths manually.",
    fields: [
      {
        key: "watch_paths",
        label: "Directory paths to watch",
        placeholder: "C:\\Users\\you\\Documents\nC:\\Projects\\my-app",
        type: "textarea",
      },
    ],
  },
];

const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <Settings size={15} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={15} /> },
];


// ─── Helper components ────────────────────────────────────────────────────────

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
    <div className="flex items-start justify-between gap-4 py-4 last:border-0">
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">{label}</p>
        {description && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function PasswordField({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (val: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 pr-10 rounded-xl bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none font-mono"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        aria-label={visible ? "Hide value" : "Show value"}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

function StatusDot({ configured }: { configured: boolean }) {
  return configured ? (
    <span className="flex items-center gap-1.5 text-xs text-green-400 font-medium">
      <CheckCircle2 size={12} className="text-green-400" />
      Connected
    </span>
  ) : (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
      <Circle size={12} className="text-[var(--text-muted)]" />
      Not configured
    </span>
  );
}


// ─── Connector Card ───────────────────────────────────────────────────────────

function ConnectorCard({
  config,
  status,
  onSave,
  onDisconnect,
  onGoogleOAuth,
  onBrowseDirectory,
}: {
  config: ConnectorConfig;
  status: ConnectorStatus;
  onSave: (values: Record<string, string>) => void;
  onDisconnect: () => void;
  onGoogleOAuth: (clientId: string, clientSecret: string) => void;
  onBrowseDirectory: (currentPaths: string, callback: (newPaths: string) => void) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (expanded && status.configured) {
      const loadCreds = async () => {
        try {
          const electron = (window as any).atlasElectron;
          if (electron?.tokenStore?.get) {
            const creds = await electron.tokenStore.get(config.id);
            if (creds) setFieldValues(creds);
          } else {
            const stored = localStorage.getItem(`atlas_connector_${config.id}`);
            if (stored) setFieldValues(JSON.parse(stored));
          }
        } catch (e) {
          console.error("Failed to load credentials", e);
        }
      };
      loadCreds();
    }
  }, [expanded, status.configured, config.id]);

  const updateField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const hasValues = config.fields.every(
    (f) => (fieldValues[f.key] ?? "").trim().length > 0
  );

  const isGoogle = config.id === "google_workspace";
  const isLocalFs = config.id === "local_fs";

  return (
    <div className="last:border-0">
      {/* Header row */}
      <div className="flex items-center justify-between py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex-shrink-0">{config.logo}</span>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {config.name}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{config.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot configured={status.configured} />
          {status.configured && (
            <button
              onClick={onDisconnect}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Disconnect
            </button>
          )}
          <Button
            size="sm"
            variant={status.configured ? "secondary" : "primary"}
            id={`configure-${config.id}`}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Close" : status.configured ? "Reconfigure" : "Configure"}
          </Button>
        </div>
      </div>

      {/* Inline configuration form */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            className="pb-4 px-1"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <div className="py-3 px-4 rounded-2xl bg-[var(--bg-tertiary)]">
              {/* Help text */}
              <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                {config.helpText}
              </p>

              {/* Fields */}
              <div className="space-y-3">
                {config.fields.map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`${config.id}-${field.key}`}
                      className="block text-xs font-medium text-[var(--text-primary)] mb-1"
                    >
                      {field.label}
                    </label>
                    {field.type === "textarea" ? (
                      <div className="space-y-2">
                        <textarea
                          id={`${config.id}-${field.key}`}
                          value={fieldValues[field.key] ?? ""}
                          onChange={(e) => updateField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          rows={3}
                          className="w-full px-3 py-2 rounded-xl bg-[var(--bg-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none resize-none font-mono"
                        />
                        {isLocalFs && (
                          <Button
                            size="sm"
                            variant="secondary"
                            id="browse-directory"
                            onClick={() =>
                              onBrowseDirectory(
                                fieldValues[field.key] ?? "",
                                (newPaths) => updateField(field.key, newPaths)
                              )
                            }
                          >
                            <FolderPlus size={13} className="mr-1.5" />
                            Browse…
                          </Button>
                        )}
                      </div>
                    ) : (
                      <PasswordField
                        id={`${config.id}-${field.key}`}
                        value={fieldValues[field.key] ?? ""}
                        onChange={(val) => updateField(field.key, val)}
                        placeholder={field.placeholder}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Test result */}
              {status.testResult && (
                <p
                  className={cn(
                    "text-xs mt-2",
                    status.testResult === "success"
                      ? "text-green-400"
                      : "text-red-400"
                  )}
                >
                  {status.testMessage}
                </p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 mt-4">
                {isGoogle ? (
                  <Button
                    size="sm"
                    variant="primary"
                    id={`connect-${config.id}`}
                    disabled={
                      !(fieldValues["client_id"] ?? "").trim() ||
                      !(fieldValues["client_secret"] ?? "").trim()
                    }
                    isLoading={status.testing}
                    onClick={() =>
                      onGoogleOAuth(
                        fieldValues["client_id"] ?? "",
                        fieldValues["client_secret"] ?? ""
                      )
                    }
                  >
                    {status.testing ? "Connecting…" : "Connect with Google"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    id={`save-${config.id}`}
                    disabled={!hasValues}
                    onClick={() => onSave(fieldValues)}
                  >
                    Save
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  id={`cancel-${config.id}`}
                  onClick={() => setExpanded(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");
  const { theme, toggleTheme } = useAppStore();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  // Track configuration status per connector
  const [statuses, setStatuses] = useState<Record<ConnectorId, ConnectorStatus>>(
    () => {
      const initial: Record<string, ConnectorStatus> = {};
      for (const c of connectorConfigs) {
        initial[c.id] = { configured: false, testing: false, testResult: null };
      }
      return initial as Record<ConnectorId, ConnectorStatus>;
    }
  );

  // On mount, check which providers are already configured via Electron token store
  useEffect(() => {
    async function checkConfigured() {
      // Small delay to ensure Electron IPC bridge is ready
      await new Promise((r) => setTimeout(r, 100));

      const electron = (window as any).atlasElectron;
      let configured: string[] = [];
      
      try {
        if (electron?.tokenStore?.listConfigured) {
          configured = (await electron.tokenStore.listConfigured()) ?? [];
        } else {
          configured = connectorConfigs.map(c => c.id).filter(id => !!localStorage.getItem(`atlas_connector_${id}`));
        }

        setStatuses((prev) => {
          const next = { ...prev };
          for (const id of Object.keys(next) as ConnectorId[]) {
            next[id] = { ...next[id], configured: configured.includes(id) };
          }
          return next;
        });
      } catch (err) {
        console.warn("[Settings] Failed to check configured providers:", err);
      }
    }
    checkConfigured();
  }, []);

  // Save credentials for a connector (GitHub, Slack, Notion, Local Files)
  const handleSave = useCallback(
    async (connectorId: ConnectorId, values: Record<string, string>) => {
      try {
        const electron = (window as any).atlasElectron;

        if (electron?.tokenStore?.set) {
          await electron.tokenStore.set(connectorId, values);
        } else {
          // Fallback: store in localStorage (for dev outside Electron)
          localStorage.setItem(
            `atlas_connector_${connectorId}`,
            JSON.stringify(values)
          );
        }

        setStatuses((prev) => ({
          ...prev,
          [connectorId]: {
            ...prev[connectorId],
            configured: true,
            testResult: "success",
            testMessage: "Credentials saved successfully.",
          },
        }));

        // Sync credentials to cloud for cross-device access (best-effort)
        try {
          const { tokenSyncAPI } = await import("@/lib/api/token-sync");
          await tokenSyncAPI.uploadToken(connectorId, values);
        } catch {
          // Silent — cloud sync is best-effort, local still works
        }

        queryClient.invalidateQueries({ queryKey: ["connectors"] });

        setToast({ message: `${connectorId.replace("_", " ")} configured successfully.`, type: "success" });
      } catch (err: any) {
        setToast({
          message: `Failed to save: ${err?.message || "Unknown error"}`,
          type: "error",
        });
      }
    },
    [queryClient]
  );

  // Disconnect/remove a connector
  const handleDisconnect = useCallback(
    async (connectorId: ConnectorId) => {
      try {
        const electron = (window as any).atlasElectron;
        if (electron?.tokenStore?.remove) {
          await electron.tokenStore.remove(connectorId);
        }
        // Also clear localStorage
        localStorage.removeItem(`atlas_connector_${connectorId}`);

        setStatuses((prev) => ({
          ...prev,
          [connectorId]: { configured: false, testing: false, testResult: null },
        }));

        // Invalidate all queries so sidebar, dashboard, briefing all update
        queryClient.invalidateQueries({ queryKey: ["connectors"] });
        queryClient.invalidateQueries({ queryKey: ["briefing"] });

        // Sync removal to cloud
        try {
          const { tokenSyncAPI } = await import("@/lib/api/token-sync");
          await tokenSyncAPI.uploadToken(connectorId, {});
        } catch {}

        setToast({ message: `${connectorId.replace("_", " ")} disconnected.`, type: "success" });
      } catch (err: any) {
        setToast({ message: `Failed to disconnect: ${err?.message || "Unknown error"}`, type: "error" });
      }
    },
    [queryClient]
  );

  // Google OAuth flow — opens popup, completes OAuth, stores tokens automatically
  const handleGoogleOAuth = useCallback(
    async (clientId: string, clientSecret: string) => {
      setStatuses((prev) => ({
        ...prev,
        google_workspace: { ...prev.google_workspace, testing: true, testResult: null, testMessage: undefined },
      }));

      try {
        const electron = (window as any).atlasElectron;

        if (!electron?.startGoogleOAuth) {
          // Not in Electron — save credentials only
          if (electron?.tokenStore?.set) {
            await electron.tokenStore.set("google_workspace", {
              client_id: clientId,
              client_secret: clientSecret,
            });
          } else {
            localStorage.setItem(
              "atlas_connector_google_workspace",
              JSON.stringify({ client_id: clientId, client_secret: clientSecret })
            );
          }
          setStatuses((prev) => ({
            ...prev,
            google_workspace: {
              configured: true,
              testing: false,
              testResult: "success",
              testMessage: "Credentials saved. Run in desktop app to complete OAuth.",
            },
          }));
          setToast({ message: "Google credentials saved.", type: "success" });
          return;
        }

        // Start the OAuth flow — this opens a popup and handles everything
        const result = await electron.startGoogleOAuth(clientId, clientSecret);

        if (result.success) {
          setStatuses((prev) => ({
            ...prev,
            google_workspace: {
              configured: true,
              testing: false,
              testResult: "success",
              testMessage: "Google OAuth successful! Connected.",
            },
          }));
          queryClient.invalidateQueries({ queryKey: ["connectors"] });
          setToast({ message: "Google Workspace connected successfully!", type: "success" });

          // Sync to cloud for cross-device access (best-effort)
          try {
            const creds = await electron.tokenStore.get("google_workspace");
            if (creds) {
              const { tokenSyncAPI } = await import("@/lib/api/token-sync");
              await tokenSyncAPI.uploadToken("google_workspace", creds);
            }
          } catch {}
        } else {
          throw new Error(result.error || "OAuth flow failed");
        }
      } catch (err: any) {
        setStatuses((prev) => ({
          ...prev,
          google_workspace: {
            ...prev.google_workspace,
            testing: false,
            testResult: "error",
            testMessage: err.message || "Google OAuth failed",
          },
        }));
        setToast({
          message: `Google OAuth failed: ${err.message || "Unknown error"}`,
          type: "error",
        });
      }
    },
    [queryClient]
  );

  // Browse for directories (Local Files connector)
  const handleBrowseDirectory = useCallback(
    async (currentPaths: string, callback: (newPaths: string) => void) => {
      const electron = (window as any).atlasElectron;
      if (!electron?.selectDirectory) {
        setToast({ message: "Directory picker not available outside desktop app.", type: "error" });
        return;
      }

      try {
        const selected: string[] = await electron.selectDirectory();
        if (selected && selected.length > 0) {
          const existing = currentPaths.trim();
          const newPaths = existing
            ? existing + "\n" + selected.join("\n")
            : selected.join("\n");
          callback(newPaths);
        }
      } catch (err: any) {
        setToast({
          message: `Failed to open directory picker: ${err.message || "Unknown error"}`,
          type: "error",
        });
      }
    },
    []
  );

  return (
    <div className="max-w-3xl mx-auto">
      {/* Toast notifications */}
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
              <span
                className={
                  activeSection === s.id
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-muted)]"
                }
              >
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
          className="flex-1 bg-[var(--bg-secondary)] rounded-2xl p-5"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        >
          {activeSection === "general" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">
                General
              </h2>
              <SettingRow
                label="Appearance"
                description="Choose your preferred color theme."
              >
                <button
                  id="settings-theme-toggle"
                  onClick={toggleTheme}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-tertiary)] text-sm text-[var(--text-primary)] transition-colors"
                  aria-label={`Current theme: ${theme}. Click to toggle.`}
                >
                  {mounted ? (theme === "dark" ? <Moon size={13} /> : <Sun size={13} />) : <Moon size={13} />}
                  <span className="capitalize">{mounted ? theme : "dark"}</span>
                </button>
              </SettingRow>
            </>
          )}

          {activeSection === "integrations" && (
            <>
              <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">
                Integrations
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Configure your connectors by providing API tokens or credentials
                directly. All secrets are stored locally on your device.
              </p>

              {connectorConfigs.map((connector) => (
                <ConnectorCard
                  key={connector.id}
                  config={connector}
                  status={statuses[connector.id]}
                  onSave={(values) => handleSave(connector.id, values)}
                  onDisconnect={() => handleDisconnect(connector.id)}
                  onGoogleOAuth={handleGoogleOAuth}
                  onBrowseDirectory={handleBrowseDirectory}
                />
              ))}
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
