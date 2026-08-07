/**
 * Atlas Token Store — Secure credential storage for MCP connectors.
 *
 * Stores OAuth tokens and API keys for each connector provider in a
 * JSON file within the user's appData directory.
 *
 * File location:
 *   Windows: %APPDATA%/Atlas/token-store.json
 *   macOS:   ~/Library/Application Support/Atlas/token-store.json
 *   Linux:   ~/.config/Atlas/token-store.json
 *
 * Supported providers:
 *   - google: OAuth credentials (client_id, client_secret, access_token, refresh_token)
 *   - github: Personal access token
 *   - slack:  Bot token
 *   - notion: Integration token
 *   - filesystem: Watch paths configuration
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GoogleCredentials {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  token_expiry?: string;
}

export interface GitHubCredentials {
  personal_access_token: string;
}

export interface SlackCredentials {
  bot_token: string;
}

export interface NotionCredentials {
  integration_token: string;
}

export interface FilesystemCredentials {
  watch_paths: string[];
}

export type ProviderName = "google" | "github" | "slack" | "notion" | "filesystem";

export type ProviderCredentials =
  | GoogleCredentials
  | GitHubCredentials
  | SlackCredentials
  | NotionCredentials
  | FilesystemCredentials;

interface TokenStoreData {
  google?: GoogleCredentials;
  github?: GitHubCredentials;
  slack?: SlackCredentials;
  notion?: NotionCredentials;
  filesystem?: FilesystemCredentials;
}

// ── File Path ──────────────────────────────────────────────────────────────────

function getStorePath(): string {
  try {
    return path.join(app.getPath("userData"), "token-store.json");
  } catch {
    // Fallback for testing outside Electron
    return path.join(process.cwd(), "token-store.json");
  }
}

// ── Internal Read/Write ────────────────────────────────────────────────────────

/**
 * Read the token store from disk. Returns empty object if file doesn't exist.
 */
function readStore(): TokenStoreData {
  const storePath = getStorePath();

  try {
    if (!fs.existsSync(storePath)) {
      return {};
    }
    const raw = fs.readFileSync(storePath, "utf-8");
    return JSON.parse(raw) as TokenStoreData;
  } catch (err) {
    console.error("[Token Store] Failed to read token store:", err);
    return {};
  }
}

/**
 * Write the token store to disk. Creates parent directories if needed.
 */
function writeStore(data: TokenStoreData): void {
  const storePath = getStorePath();
  const dir = path.dirname(storePath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[Token Store] Failed to write token store:", err);
    throw new Error("Failed to save credentials to disk");
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Get stored credentials for a provider.
 *
 * @returns The provider's credentials, or null if not configured.
 */
export function getToken(provider: ProviderName): ProviderCredentials | null {
  const store = readStore();
  const credentials = store[provider];

  if (!credentials) {
    return null;
  }

  return credentials;
}

/**
 * Store credentials for a provider. Overwrites any existing credentials.
 */
export function setToken(provider: ProviderName, credentials: ProviderCredentials): void {
  if (!provider) {
    throw new Error("Provider name is required");
  }

  const validProviders: ProviderName[] = ["google", "github", "slack", "notion", "filesystem"];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(", ")}`);
  }

  const store = readStore();
  (store as Record<string, ProviderCredentials>)[provider] = credentials;
  writeStore(store);

  console.log(`[Token Store] Credentials stored for provider: ${provider}`);
}

/**
 * Remove credentials for a provider.
 */
export function removeToken(provider: ProviderName): void {
  const store = readStore();

  if (!(provider in store)) {
    // Already removed, no-op
    return;
  }

  delete (store as Record<string, unknown>)[provider];
  writeStore(store);

  console.log(`[Token Store] Credentials removed for provider: ${provider}`);
}

/**
 * List all providers that have credentials configured.
 *
 * @returns Array of provider names that have stored credentials.
 */
export function listConfigured(): ProviderName[] {
  const store = readStore();
  const configured: ProviderName[] = [];

  const providers: ProviderName[] = ["google", "github", "slack", "notion", "filesystem"];

  for (const provider of providers) {
    if (store[provider] && Object.keys(store[provider]!).length > 0) {
      configured.push(provider);
    }
  }

  return configured;
}

/**
 * Check if a specific provider has credentials configured.
 */
export function isConfigured(provider: ProviderName): boolean {
  const store = readStore();
  const credentials = store[provider];
  return !!credentials && Object.keys(credentials).length > 0;
}
