/**
 * @jest-environment node
 */

/**
 * Local Store Tests — verifies SQL injection safety, cache invalidation,
 * and persistence behavior.
 */

import * as path from "path";
import * as fs from "fs";

// Mock electron app module
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => {
      const dir = path.join(__dirname, "../../.test-data-store");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return dir;
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

// We test using the actual sql.js-based local-store module
let localStore: typeof import("../../electron/services/local-store");

const TEST_DB_DIR = path.join(__dirname, "../../.test-data-store");

beforeAll(async () => {
  // Clean up any stale test DB
  const dbPath = path.join(TEST_DB_DIR, "atlas-workflows.db");
  try { fs.unlinkSync(dbPath); } catch { /* ok */ }
  try { fs.unlinkSync(dbPath + ".tmp"); } catch { /* ok */ }

  localStore = require("../../electron/services/local-store");
  await localStore.initDB();
});

afterAll(() => {
  // closeDB may have already been called by the persistence test
  if (localStore.getDB()) {
    localStore.closeDB();
  }
  // Clean up test DB
  try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

describe("Local Store", () => {
  describe("SQL Injection Safety", () => {
    it("stores literal SQL injection strings without executing them", () => {
      const maliciousTitle = "test'); DROP TABLE conversations; --";
      const conv = localStore.createConversation(maliciousTitle, "test-user");

      // Read it back
      const conversations = localStore.listConversations(100);
      const found = conversations.find((c: any) => c.id === conv.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe(maliciousTitle);

      // Verify conversations table still exists
      const db = localStore.getDB();
      const tableCheck = db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
      );
      expect(tableCheck.length).toBe(1);
      expect(tableCheck[0].values[0][0]).toBe("conversations");
    });
  });

  describe("Cache Invalidation on updateLocalRecord", () => {
    it("returns updated value after updateLocalRecord (not stale cache)", () => {
      // Insert a conversation
      const conv = localStore.createConversation("Original Title", "test-user");

      // Insert a message to populate messages cache
      const msg = localStore.saveMessage(conv.id, "user", "hello");

      // Read messages to populate cache
      const messages1 = localStore.getConversationHistory(conv.id);
      expect(messages1.length).toBe(1);
      expect(messages1[0].content).toBe("hello");

      // Update the message via updateLocalRecord (simulating cloud sync)
      localStore.updateLocalRecord("messages", {
        id: msg.id,
        conversation_id: conv.id,
        role: "user",
        content: "updated content",
        timestamp: msg.timestamp,
        updated_at: new Date().toISOString(),
      });

      // Read again — should return updated value (cache invalidated)
      const messages2 = localStore.getConversationHistory(conv.id);
      expect(messages2.length).toBe(1);
      expect(messages2[0].content).toBe("updated content");
    });
  });

  describe("Persistence on closeDB", () => {
    it("persists database to disk when closeDB is invoked", () => {
      // The DB was populated by prior tests (SQL injection test, cache test)
      // Ensure the DB has valid data
      const db = localStore.getDB();
      expect(db).not.toBeNull();

      const dbFilePath = path.join(TEST_DB_DIR, "atlas-workflows.db");

      // closeDB should write the DB to disk synchronously
      localStore.closeDB();

      // After closeDB, the file should exist on disk
      expect(fs.existsSync(dbFilePath)).toBe(true);

      // Verify the file is non-empty (contains actual SQLite data)
      const stats = fs.statSync(dbFilePath);
      expect(stats.size).toBeGreaterThan(0);

      // Verify getDB returns null after close
      expect(localStore.getDB()).toBeNull();
    });
  });
});
