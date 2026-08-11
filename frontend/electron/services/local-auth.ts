/**
 * Atlas Local Authentication Service.
 *
 * Provides fully local user authentication without any backend dependency.
 * Uses sql.js (same as local-store) for user storage.
 * Password hashing: Node.js built-in crypto (pbkdf2).
 * Session: stored in the config table.
 */

import { randomUUID, pbkdf2Sync, randomBytes, createHash } from "crypto";
import { getDB, forcePersist } from "./local-store";
import { setEncryptionKey, setCrossDeviceDetails, clearKeys } from "./crypto";
import { syncTokensFromCloud } from "./token-store";

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
  created_at: string;
  updated_at: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const PBKDF2_ITERATIONS = 10_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";
const SESSION_KEY = "auth_current_user_id";

function persist(): void {
  forcePersist();
}

/**
 * Initialize auth tables. Must be called after initDB() from local-store.
 */
export async function initAuthTables(): Promise<void> {
  const db = getDB();
  if (!db) {
    console.error("[Atlas Auth] Database not initialized. Call initDB() from local-store first.");
    return;
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

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(32).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, PBKDF2_DIGEST).toString("hex");
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

  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();

  db.run(
    "INSERT INTO users (id, email, full_name, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, email.toLowerCase(), fullName.trim(), hash, salt, now, now]
  );
  forcePersist();

  setConfig(SESSION_KEY, id);
  setEncryptionKey(salt);
  try {
    setCrossDeviceDetails(email, password);
    syncTokensFromCloud().catch(console.error);
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
  if (!verifyPassword(password, row.password_hash, row.salt)) throw new Error("Invalid email or password");

  setConfig(SESSION_KEY, row.id);
  setEncryptionKey(row.salt);
  try {
    setCrossDeviceDetails(email, password);
    syncTokensFromCloud().catch(console.error);
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
    // Login locally
    setConfig(SESSION_KEY, row.id);
    setEncryptionKey(row.salt);
    
    // Only set cross-device details if the password actually matches derivedPassword
    // Otherwise we'd corrupt the user's sync with an incorrect key
    if (verifyPassword(derivedPassword, row.password_hash, row.salt)) {
      try {
        setCrossDeviceDetails(email, derivedPassword);
        syncTokensFromCloud().catch(console.error);
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
  const userId = getConfigVal(SESSION_KEY);
  if (!userId) return null;
  const row = queryOne("SELECT * FROM users WHERE id = ?", [userId]) as UserRow | null;
  if (!row) { deleteConfigKey(SESSION_KEY); return null; }
  setEncryptionKey(row.salt);
  return toPublicUser(row);
}

export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

export function logout(): void {
  deleteConfigKey(SESSION_KEY);
  clearKeys();
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
