/**
 * Atlas Local Authentication Service.
 *
 * Provides fully local user authentication without any backend dependency.
 * Uses sql.js (same as local-store) for user storage.
 * Password hashing: Node.js built-in crypto (pbkdf2).
 * Session: stored in the config table.
 */

import { randomUUID, pbkdf2Sync, randomBytes, createHash } from "crypto";
import { getDB, forcePersist, clearCacheAndQueue } from "./local-store";
import { setEncryptionKey, setCrossDeviceDetails, clearKeys } from "./crypto";
import { syncTokensFromCloud, clearAllTokens } from "./token-store";
import { syncManager } from "./cloud-sync";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LocalUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  salt: string;
  iterations: number;
  created_at: string;
  updated_at: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";
const SESSION_KEY = "auth_session_token";

function persist(): void {
  forcePersist();
}

/**
 * Generate a cryptographically random session token (32 bytes = 64 hex chars).
 */
function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Initialize auth tables. Must be called after initDB() from local-store.
 */
export async function initAuthTables(): Promise<void> {
  const db = getDB();
  if (!db) {
    throw new Error("[Atlas Auth] Database not initialized. Call initDB() from local-store first.");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Add iterations column for PBKDF2 migration (default 10000 for legacy rows)
  try { db.run(`ALTER TABLE users ADD COLUMN iterations INTEGER NOT NULL DEFAULT 10000`); } catch (e) { /* column already exists */ }

  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );
    `);
  } catch (err) {
    console.warn("[Atlas Auth] Notice: config table creation skipped/failed", err);
  }

  // Force persist through the shared instance
  forcePersist();
}

// ── Password Hashing ───────────────────────────────────────────────────────────

function hashPassword(password: string, iterations: number = PBKDF2_ITERATIONS): { hash: string; salt: string; iterations: number } {
  const salt = randomBytes(32).toString("hex");
  const hash = pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString("hex");
  return { hash, salt, iterations };
}

function verifyPassword(password: string, storedHash: string, salt: string, iterations: number = PBKDF2_ITERATIONS): boolean {
  const hash = pbkdf2Sync(password, salt, iterations, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString("hex");
  if (hash.length !== storedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function queryOne(sql: string, params: any[] = []): any {
  const db = getDB();
  if (!db) return null;
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function setConfig(key: string, value: string): void {
  const db = getDB();
  if (!db) return;
  db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [key, value]);
  forcePersist();
}

function getConfigVal(key: string): string | null {
  const row = queryOne("SELECT value FROM config WHERE key = ?", [key]);
  return row?.value ?? null;
}

function deleteConfigKey(key: string): void {
  const db = getDB();
  if (!db) return;
  db.run("DELETE FROM config WHERE key = ?", [key]);
  forcePersist();
}

function toPublicUser(row: UserRow): LocalUser {
  return { id: row.id, email: row.email, full_name: row.full_name, created_at: row.created_at, updated_at: row.updated_at };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function register(email: string, password: string, fullName: string): LocalUser {
  const db = getDB();
  if (!db) throw new Error("Auth not initialized");
  if (!email || !email.includes("@")) throw new Error("Invalid email address");
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters");
  if (!fullName || fullName.trim().length === 0) throw new Error("Full name is required");

  const existing = queryOne("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  if (existing) throw new Error("An account with this email already exists");

  const { hash, salt, iterations } = hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.run(
    "INSERT INTO users (id, email, full_name, password_hash, salt, iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, email.toLowerCase(), fullName.trim(), hash, salt, iterations, now, now]
  );
  forcePersist();

  // Generate random session token instead of storing user ID directly
  const sessionToken = generateSessionToken();
  setConfig(SESSION_KEY, sessionToken);
  setConfig(`session:${sessionToken}`, id);

  setEncryptionKey(salt);
  try {
    setCrossDeviceDetails(email, password);
    syncTokensFromCloud().catch(console.error);
    syncManager.pullFromCloud(new Date(0).toISOString()).catch(console.error);
  } catch (err) {
    console.error("[Atlas Auth] Failed to initialize cross-device sync:", err);
  }
  return { id, email: email.toLowerCase(), full_name: fullName.trim(), created_at: now, updated_at: now };
}

export function login(email: string, password: string): LocalUser {
  const db = getDB();
  if (!db) throw new Error("Auth not initialized");
  if (!email || !password) throw new Error("Email and password are required");

  const row = queryOne("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]) as UserRow | null;
  if (!row) throw new Error("Invalid email or password");

  // Verify with the iterations the hash was originally created with
  const storedIterations = row.iterations || 10000;
  if (!verifyPassword(password, row.password_hash, row.salt, storedIterations)) throw new Error("Invalid email or password");

  // Upgrade hash if using old iteration count
  if (storedIterations < PBKDF2_ITERATIONS) {
    const { hash: newHash, salt: newSalt, iterations: newIterations } = hashPassword(password);
    const now = new Date().toISOString();
    db.run(
      "UPDATE users SET password_hash = ?, salt = ?, iterations = ?, updated_at = ? WHERE id = ?",
      [newHash, newSalt, newIterations, now, row.id]
    );
    row.salt = newSalt;
    forcePersist();
  }

  // Generate random session token instead of storing user ID directly
  const sessionToken = generateSessionToken();
  setConfig(SESSION_KEY, sessionToken);
  setConfig(`session:${sessionToken}`, row.id);

  setEncryptionKey(row.salt);
  try {
    setCrossDeviceDetails(email, password);
    syncTokensFromCloud().catch(console.error);
    syncManager.pullFromCloud(new Date(0).toISOString()).catch(console.error);
  } catch (err) {
    console.error("[Atlas Auth] Failed to initialize cross-device sync:", err);
  }
  return toPublicUser(row);
}

export function loginWithGoogle(email: string, fullName: string, sub: string): LocalUser {
  const db = getDB();
  if (!db) throw new Error("Auth not initialized");
  if (!email || !email.includes("@")) throw new Error("Invalid email address");
  if (!sub) throw new Error("Google subject (sub) is required");
  if (!fullName || fullName.trim().length === 0) fullName = "Google User";

  // Use a cryptographically derived key instead of a deterministic dummy string
  const derivedPassword = createHash("sha256")
    .update(`google-oauth-${sub}-${email}`)
    .digest("hex");

  const row = queryOne("SELECT * FROM users WHERE email = ?", [email.toLowerCase()]) as UserRow | null;
  if (!row) {
    // Register them locally
    return register(email, derivedPassword, fullName);
  } else {
    // Login locally — generate random session token
    const sessionToken = generateSessionToken();
    setConfig(SESSION_KEY, sessionToken);
    setConfig(`session:${sessionToken}`, row.id);

    setEncryptionKey(row.salt);
    
    // Only set cross-device details if the password actually matches derivedPassword
    // Otherwise we'd corrupt the user's sync with an incorrect key
    const storedIterations = row.iterations || 10000;
    if (verifyPassword(derivedPassword, row.password_hash, row.salt, storedIterations)) {
      try {
        setCrossDeviceDetails(email, derivedPassword);
        syncTokensFromCloud().catch(console.error);
        syncManager.pullFromCloud(new Date(0).toISOString()).catch(console.error);
      } catch (err) {
        console.error("[Atlas Auth] Failed to initialize cross-device sync:", err);
      }
    } else {
      console.warn("[Atlas Auth] User registered locally with a real password. Skipping cross-device sync for Google login.");
    }
    return toPublicUser(row);
  }
}

export function getCurrentUser(): LocalUser | null {
  const sessionToken = getConfigVal(SESSION_KEY);
  if (!sessionToken) return null;

  // Look up user ID from session token mapping
  const userId = getConfigVal(`session:${sessionToken}`);
  if (!userId) { deleteConfigKey(SESSION_KEY); return null; }

  const row = queryOne("SELECT * FROM users WHERE id = ?", [userId]) as UserRow | null;
  if (!row) { deleteConfigKey(SESSION_KEY); deleteConfigKey(`session:${sessionToken}`); return null; }
  setEncryptionKey(row.salt);
  return toPublicUser(row);
}

export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

export function logout(): void {
  // Invalidate the session token mapping
  const sessionToken = getConfigVal(SESSION_KEY);
  if (sessionToken) {
    deleteConfigKey(`session:${sessionToken}`);
  }
  deleteConfigKey(SESSION_KEY);
  clearKeys();
  clearAllTokens();
  clearCacheAndQueue();
}

export function updateProfile(data: { email?: string; full_name?: string; password?: string }): LocalUser {
  const current = getCurrentUser();
  if (!current) throw new Error("Not authenticated");

  const db = getDB();
  const now = new Date().toISOString();
  if (data.email) {
    const existing = queryOne("SELECT id FROM users WHERE email = ? AND id != ?", [data.email.toLowerCase(), current.id]);
    if (existing) throw new Error("Email already taken");
    db.run("UPDATE users SET email = ?, updated_at = ? WHERE id = ?", [data.email.toLowerCase(), now, current.id]);
  }
  if (data.full_name) {
    db.run("UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?", [data.full_name.trim(), now, current.id]);
  }
  if (data.password) {
    const { hash, salt } = hashPassword(data.password);
    db.run("UPDATE users SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?", [hash, salt, now, current.id]);
  }
  forcePersist();

  const updated = queryOne("SELECT * FROM users WHERE id = ?", [current.id]) as UserRow;
  return toPublicUser(updated);
}
