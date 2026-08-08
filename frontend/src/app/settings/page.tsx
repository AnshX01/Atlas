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
    logo: <GoogleLogo size={18} />,
    helpText:
      "Create a Google Cloud project, enable Gmail/Calendar APIs, create OAuth credentials.",
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
    logo: <GitHubLogo size={18} />,
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
    logo: <SlackLogo size={18} />,
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
    logo: <NotionLogo size={18} />,
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
    logo: <LocalFilesLogo size={18} />,
    helpText:
      "Enter one directory path per line. Atlas will index and monitor these folders.",
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
    <div className="flex items-start justify-between gap-4 py-4 border-b border-[var(--border-subtle)] last:border-0">
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
        className="w-full px-3 py-2 pr-10 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] font-mono"
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
      Configured
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
  onTest,
}: {
  config: ConnectorConfig;
  status: ConnectorStatus;
  onSave: (values: Record<string, string>) => void;
  onTest: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const updateField = (key: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  };

  const hasValues = config.fields.some(
    (f) => (fieldValues[f.key] ?? "").trim().length > 0
  );

  return (
    <div className="border-b border-[var(--border-subtle)] last:border-0">
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
            <div className="py-3 px-4 rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border-default)]">
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
                      <textarea
                        id={`${config.id}-${field.key}`}
                        value={fieldValues[field.key] ?? ""}
                        onChange={(e) => updateField(field.key, e.target.value)}
                        placeholder={field.placeholder}
                        rows={3}
                        className="w-full px-3 py-2 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
                      />
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
                <Button
                  size="sm"
                  variant="primary"
                  id={`save-${config.id}`}
                  disabled={!hasValues}
                  onClick={() => onSave(fieldValues)}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  id={`test-${config.id}`}
                  disabled={!hasValues && !status.configured}
                  isLoading={status.testing}
                  onClick={onTest}
                >
                  {status.testing ? "Testing…" : "Test Connection"}
                </Button>
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

  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Track configuration status per connector
  // Initialize synchronously from localStorage so the first render shows correct status
  const [statuses, setStatuses] = useState<Record<ConnectorId, ConnectorStatus>>(
    () => {
      const initial: Record<string, ConnectorStatus> = {};
      for (const c of connectorConfigs) {
        const stored = typeof window !== 'undefined' ? localStorage.getItem(`atlas_connector_${c.id}`) : null;
        let configured = false;
        if (stored) {
          try { configured = Object.values(JSON.parse(stored)).some((v: any) => v && String(v).trim()); } catch {}
        }
        initial[c.id] = { configured, testing: false, testResult: null };
      }
      return initial as Record<ConnectorId, ConnectorStatus>;
    }
  );

  // On mount, check which providers are already configured
  useEffect(() => {
    async function checkConfigured() {
      // Small delay to ensure Electron IPC bridge is ready
      await new Promise((r) => setTimeout(r, 100));

      const electron = (window as any).atlasElectron;
      const configuredFromElectron: string[] = [];

      if (electron?.tokenStore?.listConfigured) {
        try {
          const list = await electron.tokenStore.listConfigured();
          configuredFromElectron.push(...list);
        } catch {
          // IPC call failed — fall through to localStorage check
        }
      }

      // Check both Electron token store and localStorage
      setStatuses((prev) => {
        const next = { ...prev };
        for (const id of Object.keys(next) as ConnectorId[]) {
          const inElectron = configuredFromElectron.includes(id);
          const inLocalStorage = !!localStorage.getItem(`atlas_connector_${id}`);
          next[id] = { ...next[id], configured: inElectron || inLocalStorage };
        }
        return next;
      });
    }
    checkConfigured();
  }, []);

  // Save credentials for a connector
  const handleSave = useCallback(
    async (connectorId: ConnectorId, values: Record<string, string>) => {
      try {
        const electron = (window as any).atlasElectron;
        if (electron?.tokenStore?.save) {
          await electron.tokenStore.set(connectorId, values);
        } else {
          // Fallback: store in localStorage (less secure, for dev)
          localStorage.setItem(
            `atlas_connector_${connectorId}`,
            JSON.stringify(values)
          );
        }

        setStatuses((prev) => ({
          ...prev,
          [connectorId]: { ...prev[connectorId], configured: true },
        }));

        // Invalidate React Query cache so the sidebar updates immediately
        queryClient.invalidateQueries({ queryKey: ["connectors"] });

        setToast({ message: `${connectorId} configured successfully.`, type: "success" });
      } catch (err: any) {
        setToast({
          message: `Failed to save: ${err?.message || "Unknown error"}`,
          type: "error",
        });
      }
    },
    [queryClient]
  );

  // Test connection for a connector
  const handleTest = useCallback(
    async (connectorId: ConnectorId) => {
      setStatuses((prev) => ({
        ...prev,
        [connectorId]: {
          ...prev[connectorId],
          testing: true,
          testResult: null,
          testMessage: undefined,
        },
      }));

      try {
        const electron = (window as any).atlasElectron;
        if (electron?.tokenStore?.testConnection) {
          const result = await electron.tokenStore.testConnection(connectorId);
          setStatuses((prev) => ({
            ...prev,
            [connectorId]: {
              ...prev[connectorId],
              testing: false,
              testResult: result.success ? "success" : "error",
              testMessage: result.success
                ? "Connection successful!"
                : result.error || "Connection failed.",
            },
          }));
        } else {
          // Simulate test when not in Electron
          await new Promise((r) => setTimeout(r, 1000));
          const isConfigured = statuses[connectorId].configured;
          setStatuses((prev) => ({
            ...prev,
            [connectorId]: {
              ...prev[connectorId],
              testing: false,
              testResult: isConfigured ? "success" : "error",
              testMessage: isConfigured
                ? "Connection successful!"
                : "No credentials configured.",
            },
          }));
        }
      } catch (err: any) {
        setStatuses((prev) => ({
          ...prev,
          [connectorId]: {
            ...prev[connectorId],
            testing: false,
            testResult: "error",
            testMessage: err?.message || "Test failed unexpectedly.",
          },
        }));
      }
    },
    [statuses]
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
          className="flex-1 bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-default)] p-5"
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
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-default)] text-sm text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
                  aria-label={`Current theme: ${theme}. Click to toggle.`}
                >
                  {theme === "dark" ? <Moon size={13} /> : <Sun size={13} />}
                  <span className="capitalize">{theme}</span>
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
                  onTest={() => handleTest(connector.id)}
                />
              ))}
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
