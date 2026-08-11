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
 *   - google_workspace: OAuth credentials (client_id, client_secret, access_token, refresh_token)
 *   - github: Personal access token
 *   - slack:  Bot token
 *   - notion: Integration token
 *   - local_fs: Watch paths configuration
 */

import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { encryptData, decryptData, getEncryptionKey, getHashedEmailId, getCrossDeviceKey } from "./crypto";
import { syncManager } from "./cloud-sync";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ProviderName = "google_workspace" | "github" | "slack" | "notion" | "local_fs";

export type ProviderCredentials = Record<string, any>;

interface TokenStoreData {
  google_workspace?: Record<string, any>;
  github?: Record<string, any>;
  slack?: Record<string, any>;
  notion?: Record<string, any>;
  local_fs?: Record<string, any>;
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
    
    // Check if it's plaintext JSON
    if (raw.trim().startsWith("{")) {
      return JSON.parse(raw) as TokenStoreData;
    }

    // Otherwise, assume it's encrypted base64
    const pwd = getEncryptionKey();
    if (!pwd) {
      return {};
    }

    const decrypted = decryptData(raw, pwd);
    return JSON.parse(decrypted) as TokenStoreData;
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
    const raw = JSON.stringify(data, null, 2);
    const pwd = getEncryptionKey();
    
    if (!pwd) {
      console.warn("[Atlas] Cannot write token store: no encryption key available");
      return; // NEVER write with empty key — prevents credential wipeout
    }
    
    const out = encryptData(raw, pwd);
    const tmpPath = storePath + '.tmp';
    fs.writeFileSync(tmpPath, out, "utf-8");
    fs.renameSync(tmpPath, storePath);

    // Push encrypted credentials to Supabase
    const emailId = getHashedEmailId();
    if (emailId) {
      syncManager.queueDelta({
        table: "user_secrets",
        operation: "UPDATE",
        data: {
          user_id: emailId,
          secret_key: "token-store",
          encrypted_value: encryptData(raw, getCrossDeviceKey() || pwd),
          updated_at: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      });
    }
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

  const validProviders: ProviderName[] = ["google_workspace", "github", "slack", "notion", "local_fs"];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider: ${provider}. Must be one of: ${validProviders.join(", ")}`);
  }

  const store = readStore();
  (store as Record<string, ProviderCredentials>)[provider] = credentials;
  writeStore(store);
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
}

/**
 * List all providers that have credentials configured.
 *
 * @returns Array of provider names that have stored credentials.
 */
export function listConfigured(): ProviderName[] {
  const store = readStore();
  const configured: ProviderName[] = [];

  const providers: ProviderName[] = ["google_workspace", "github", "slack", "notion", "local_fs"];

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

/**
 * Sync tokens from cloud
 */
export async function syncTokensFromCloud(): Promise<void> {
  const emailId = getHashedEmailId();
  const crossKey = getCrossDeviceKey();
  if (!emailId || !crossKey) return;

  const encryptedBlob = await syncManager.pullSecret(emailId, "token-store");
  if (!encryptedBlob) return;

  // Prevent race condition if user logged out or switched during await
  if (getHashedEmailId() !== emailId) return;

  try {
    const decrypted = decryptData(encryptedBlob, crossKey);
    const data = JSON.parse(decrypted);

    // Re-encrypt with local encryption key
    const localPwd = getEncryptionKey();
    if (!localPwd) return;

    const storePath = getStorePath();
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const out = encryptData(JSON.stringify(data, null, 2), localPwd);
    const tmpPath = storePath + '.tmp';
    fs.writeFileSync(tmpPath, out, "utf-8");
    fs.renameSync(tmpPath, storePath);
    console.log("[Token Store] Successfully synced cross-device tokens.");
  } catch (err) {
    console.error("[Token Store] Failed to decrypt pulled tokens. Key mismatch?", err);
  }
}
