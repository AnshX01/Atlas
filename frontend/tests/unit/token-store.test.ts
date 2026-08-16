/**
 * @jest-environment node
 */

/**
 * Token Store Tests — verifies corrupted file backup, error handling,
 * and basic set/get/remove operations.
 */

import * as path from "path";
import * as fs from "fs";

const TEST_DIR = path.join(__dirname, "../../.test-data-tokens");
const TEST_STORE_PATH = path.join(TEST_DIR, "token-store.json");

// Mock electron app module
jest.mock("electron", () => ({
  app: {
    getPath: jest.fn(() => {
      if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
      return TEST_DIR;
    }),
  },
  BrowserWindow: {
    getFocusedWindow: jest.fn(() => null),
    getAllWindows: jest.fn(() => []),
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

// We need crypto functions to work properly
// The token-store uses encryptData/decryptData with an encryption key
jest.mock("../../electron/services/crypto", () => {
  const actual = jest.requireActual("../../electron/services/crypto");
  let mockKey = "test-encryption-key";
  return {
    ...actual,
    getEncryptionKey: jest.fn(() => mockKey),
    setEncryptionKey: jest.fn((k: string) => { mockKey = k; }),
    getHashedEmailId: jest.fn(() => "test-hashed-email"),
    getCrossDeviceKey: jest.fn(() => "test-cross-device-key"),
  };
});

let tokenStore: typeof import("../../electron/services/token-store");

function cleanTestDir() {
  try {
    if (fs.existsSync(TEST_STORE_PATH)) fs.unlinkSync(TEST_STORE_PATH);
    if (fs.existsSync(TEST_STORE_PATH + ".corrupted")) fs.unlinkSync(TEST_STORE_PATH + ".corrupted");
    if (fs.existsSync(TEST_STORE_PATH + ".tmp")) fs.unlinkSync(TEST_STORE_PATH + ".tmp");
  } catch { /* ok */ }
}

beforeAll(() => {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true });
  cleanTestDir();
  tokenStore = require("../../electron/services/token-store");
});

afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

beforeEach(() => {
  cleanTestDir();
});

describe("Token Store", () => {
  describe("Corrupted file handling", () => {
    it("creates a .corrupted backup file when store is corrupted", () => {
      // Write garbage data to the token store
      fs.writeFileSync(TEST_STORE_PATH, "THIS_IS_NOT_VALID_ENCRYPTED_DATA_OR_JSON!!!");

      // Call getToken which internally calls readStore
      const result = tokenStore.getToken("github");

      // Should return null (empty store)
      expect(result).toBeNull();

      // Verify backup file was created
      const backupPath = TEST_STORE_PATH + ".corrupted";
      expect(fs.existsSync(backupPath)).toBe(true);
      const backupContent = fs.readFileSync(backupPath, "utf-8");
      expect(backupContent).toBe("THIS_IS_NOT_VALID_ENCRYPTED_DATA_OR_JSON!!!");
    });

    it("returns empty object (null for getToken) when file is corrupted", () => {
      fs.writeFileSync(TEST_STORE_PATH, "corrupted_garbage_data_here");

      const result = tokenStore.getToken("github");
      expect(result).toBeNull();
    });

    it("does not throw an exception when the file is corrupted", () => {
      fs.writeFileSync(TEST_STORE_PATH, Buffer.from([0xFF, 0xFE, 0xFD, 0xAB, 0xCD]));

      expect(() => {
        tokenStore.getToken("github");
      }).not.toThrow();
    });
  });

  describe("Set and get token roundtrip", () => {
    it("stores and retrieves a github token correctly", () => {
      const credentials = {
        access_token: "ghp_test123456789",
        token_type: "bearer",
      };

      tokenStore.setToken("github", credentials);
      const result = tokenStore.getToken("github");

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result!.access_token).toBe("ghp_test123456789");
      expect(result!.token_type).toBe("bearer");
    });
  });

  describe("Remove token", () => {
    it("removes a token so getToken returns null", () => {
      const credentials = { access_token: "to-be-removed" };

      tokenStore.setToken("github", credentials);
      expect(tokenStore.getToken("github")).not.toBeNull();

      tokenStore.removeToken("github");
      const result = tokenStore.getToken("github");
      expect(result).toBeNull();
    });
  });

  describe("listConfigured", () => {
    it("lists only providers with stored credentials", () => {
      tokenStore.setToken("github", { token: "abc" });
      tokenStore.setToken("notion", { token: "xyz" });

      const configured = tokenStore.listConfigured();
      expect(configured).toContain("github");
      expect(configured).toContain("notion");
      expect(configured).not.toContain("slack");
    });
  });
});
