/**
 * @jest-environment node
 */

/**
 * Local Auth Tests — verifies PBKDF2 iteration upgrade, session token randomness,
 * and logout invalidation.
 */

import * as path from "path";
import * as fs from "fs";
import { pbkdf2Sync, randomBytes } from "crypto";

const TEST_DB_DIR = path.join(__dirname, "../../.test-data-auth");

// Mock electron app module
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => {
      if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });
      return TEST_DB_DIR;
    }),
  },
}));

// Mock cloud-sync module
jest.mock("../../electron/services/cloud-sync", () => ({
  syncManager: {
    queueDelta: jest.fn(),
    pullFromCloud: jest.fn().mockResolvedValue(undefined),
    pullSecret: jest.fn(),
  },
}));

// Mock token-store to avoid file system conflicts
jest.mock("../../electron/services/token-store", () => ({
  syncTokensFromCloud: jest.fn().mockResolvedValue(undefined),
  clearAllTokens: jest.fn(),
}));

let localStore: typeof import("../../electron/services/local-store");
let localAuth: typeof import("../../electron/services/local-auth");

beforeAll(async () => {
  // Clean up any stale test DB
  const dbPath = path.join(TEST_DB_DIR, "atlas-workflows.db");
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + ".tmp"); } catch { /* ok */ }

  localStore = require("../../electron/services/local-store");
  await localStore.initDB();

  localAuth = require("../../electron/services/local-auth");
  await localAuth.initAuthTables();
});

afterAll(() => {
  localStore.closeDB();
  try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("Local Auth", () => {
  const testEmail = "test-auth@example.com";
  const testPassword = "securepassword123";
  const testName = "Test User";

  describe("PBKDF2 Iteration Upgrade", () => {
    it("upgrades hash from old iterations (10k) to new (600k) on login", () => {
      const email = "upgrade-test@example.com";
      const password = "oldpassword123";

      // Directly insert a user with old 10000 iterations
      const db = localStore.getDB();
      const salt = randomBytes(32).toString("hex");
      const oldHash = pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex");
      const userId = "test-upgrade-user-id";
      const now = new Date().toISOString();

      db.run(
        "INSERT INTO users (id, email, full_name, password_hash, salt, iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [userId, email, "Upgrade User", oldHash, salt, 10000, now, now]
      );

      // Login — should trigger iteration upgrade
      const user = localAuth.login(email, password);
      expect(user).toBeDefined();
      expect(user.email).toBe(email);

      // Verify iterations have been upgraded
      const stmt = db.prepare("SELECT iterations, password_hash, salt FROM users WHERE id = ?");
      stmt.bind([userId]);
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();

      expect(row.iterations).toBe(600000);
      // Verify the new hash is valid with new iterations
      const newHash = pbkdf2Sync(password, row.salt as string, 600000, 64, "sha512").toString("hex");
      expect(row.password_hash).toBe(newHash);
    });
  });

  describe("Session Token Security", () => {
    let firstSessionToken: string | null = null;

    it("generates 64-char hex session tokens (32 bytes)", () => {
      // Register a fresh user
      const user = localAuth.register(testEmail, testPassword, testName);
      expect(user).toBeDefined();

      // Get session token from config
      const db = localStore.getDB();
      const stmt = db.prepare("SELECT value FROM config WHERE key = 'auth_session_token'");
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();

      const token = row.value as string;
      expect(token).toMatch(/^[a-f0-9]{64}$/);
      firstSessionToken = token;
    });

    it("changes session token on each login", () => {
      // Logout first
      localAuth.logout();

      // Login again
      localAuth.login(testEmail, testPassword);

      // Get new session token
      const db = localStore.getDB();
      const stmt = db.prepare("SELECT value FROM config WHERE key = 'auth_session_token'");
      stmt.step();
      const row = stmt.getAsObject();
      stmt.free();

      const newToken = row.value as string;
      expect(newToken).toMatch(/^[a-f0-9]{64}$/);
      expect(newToken).not.toBe(firstSessionToken);
    });

    it("invalidates session on logout — getCurrentUser returns null", () => {
      // Ensure we're logged in
      const user = localAuth.login(testEmail, testPassword);
      expect(user).toBeDefined();

      // Verify getCurrentUser works while logged in
      const currentBefore = localAuth.getCurrentUser();
      expect(currentBefore).not.toBeNull();

      // Logout
      localAuth.logout();

      // getCurrentUser should now return null
      const currentAfter = localAuth.getCurrentUser();
      expect(currentAfter).toBeNull();
    });
  });
});
