/**
 * Atlas Local Authentication Service.
 *
 * Provides fully local user authentication without any backend dependency.
 * Uses the existing SQLite database (better-sqlite3) for user storage
 * and Node.js built-in crypto (pbkdf2) for secure password hashing.
 *
 * Session management uses the SQLite config table to persist the
 * currently logged-in user ID across app restarts.
 */

import { randomUUID, pbkdf2Sync, randomBytes } from "crypto";
import Database from "better-sqlite3";
import { app } from "electron";
import * as path from "path";

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

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 64;
const PBKDF2_DIGEST = "sha512";
const SESSION_KEY = "auth_current_user_id";

// ── Database Access ────────────────────────────────────────────────────────────

let db: ReturnType<typeof Database> | null = null;

/**
 * Get the database path (same location as local-store.ts).
 */
function getDbPath(): string {
  try {
    return path.join(app.getPath("userData"), "atlas-workflows.db");
  } catch {
    return path.join(process.cwd(), "atlas-workflows.db");
  }
}

/**
 * Get or create the database connection.
 * Reuses the same database file as local-store.ts.
 */
function getDB(): ReturnType<typeof Database> {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

/**
 * Initialize the auth tables. Call once at app startup (after initDB from local-store).
 */
export function initAuthTables(): void {
  const d = getDB();

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  console.log("[Atlas Auth] Auth tables initialized");
}

/**
 * Close the auth database connection (call on app quit if needed).
 */
export function closeAuthDB(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Password Hashing ───────────────────────────────────────────────────────────

/**
 * Hash a password with a random salt using PBKDF2.
 */
function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(32).toString("hex");
  const hash = pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST
  ).toString("hex");
  return { hash, salt };
}

/**
 * Verify a password against a stored hash and salt.
 */
function verifyPassword(password: string, storedHash: string, salt: string): boolean {
  const hash = pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERATIONS,
    PBKDF2_KEY_LENGTH,
    PBKDF2_DIGEST
  ).toString("hex");
  // Constant-time comparison to prevent timing attacks
  if (hash.length !== storedHash.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) {
    mismatch |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Session Management ─────────────────────────────────────────────────────────

/**
 * Store the current session (logged-in user ID) in the config table.
 */
function setSession(userId: string): void {
  const d = getDB();
  d.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(SESSION_KEY, userId);
}

/**
 * Clear the current session.
 */
function clearSession(): void {
  const d = getDB();
  d.prepare("DELETE FROM config WHERE key = ?").run(SESSION_KEY);
}

/**
 * Get the current session user ID, or null if not logged in.
 */
function getSessionUserId(): string | null {
  const d = getDB();
  const row = d.prepare("SELECT value FROM config WHERE key = ?").get(SESSION_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Strip sensitive fields from a user row for external use.
 */
function toPublicUser(row: UserRow): LocalUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Register a new local user.
 *
 * @throws Error if email is already taken or input is invalid.
 */
export function register(email: string, password: string, fullName: string): LocalUser {
  const d = getDB();

  // Validate inputs
  if (!email || !email.includes("@")) {
    throw new Error("Invalid email address");
  }
  if (!password || password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  if (!fullName || fullName.trim().length === 0) {
    throw new Error("Full name is required");
  }

  // Check if email already exists
  const existing = d.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  // Hash password and create user
  const { hash, salt } = hashPassword(password);
  const id = randomUUID();
  const now = new Date().toISOString();

  d.prepare(
    "INSERT INTO users (id, email, full_name, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, email.toLowerCase(), fullName.trim(), hash, salt, now, now);

  const user: LocalUser = {
    id,
    email: email.toLowerCase(),
    full_name: fullName.trim(),
    created_at: now,
    updated_at: now,
  };

  // Auto-login after registration
  setSession(id);

  console.log(`[Atlas Auth] User registered: ${email}`);
  return user;
}

/**
 * Login with email and password.
 *
 * @throws Error if credentials are invalid.
 */
export function login(email: string, password: string): LocalUser {
  const d = getDB();

  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  const row = d.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase()) as
    | UserRow
    | undefined;

  if (!row) {
    throw new Error("Invalid email or password");
  }

  if (!verifyPassword(password, row.password_hash, row.salt)) {
    throw new Error("Invalid email or password");
  }

  // Set session
  setSession(row.id);

  console.log(`[Atlas Auth] User logged in: ${email}`);
  return toPublicUser(row);
}

/**
 * Get the currently logged-in user, or null if no session.
 */
export function getCurrentUser(): LocalUser | null {
  const userId = getSessionUserId();
  if (!userId) return null;

  const d = getDB();
  const row = d.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;

  if (!row) {
    // User was deleted but session remains — clean up
    clearSession();
    return null;
  }

  return toPublicUser(row);
}

/**
 * Check if a user is currently authenticated.
 */
export function isAuthenticated(): boolean {
  return getCurrentUser() !== null;
}

/**
 * Log out the current user (clear session).
 */
export function logout(): void {
  const userId = getSessionUserId();
  clearSession();
  if (userId) {
    console.log(`[Atlas Auth] User logged out`);
  }
}

/**
 * Update the current user's profile.
 *
 * @throws Error if not authenticated or input is invalid.
 */
export function updateProfile(data: {
  email?: string;
  full_name?: string;
  password?: string;
}): LocalUser {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    throw new Error("Not authenticated");
  }

  const d = getDB();
  const now = new Date().toISOString();

  // Validate email if provided
  if (data.email !== undefined) {
    if (!data.email || !data.email.includes("@")) {
      throw new Error("Invalid email address");
    }
    // Check uniqueness (exclude current user)
    const existing = d
      .prepare("SELECT id FROM users WHERE email = ? AND id != ?")
      .get(data.email.toLowerCase(), currentUser.id);
    if (existing) {
      throw new Error("An account with this email already exists");
    }
  }

  // Validate full_name if provided
  if (data.full_name !== undefined && data.full_name.trim().length === 0) {
    throw new Error("Full name cannot be empty");
  }

  // Validate password if provided
  if (data.password !== undefined && data.password.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }

  // Build update query dynamically
  const updates: string[] = ["updated_at = ?"];
  const values: (string | undefined)[] = [now];

  if (data.email !== undefined) {
    updates.push("email = ?");
    values.push(data.email.toLowerCase());
  }

  if (data.full_name !== undefined) {
    updates.push("full_name = ?");
    values.push(data.full_name.trim());
  }

  if (data.password !== undefined) {
    const { hash, salt } = hashPassword(data.password);
    updates.push("password_hash = ?");
    values.push(hash);
    updates.push("salt = ?");
    values.push(salt);
  }

  values.push(currentUser.id);

  d.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

  // Return updated user
  const updatedRow = d.prepare("SELECT * FROM users WHERE id = ?").get(currentUser.id) as UserRow;
  console.log(`[Atlas Auth] Profile updated for user: ${updatedRow.email}`);
  return toPublicUser(updatedRow);
}
