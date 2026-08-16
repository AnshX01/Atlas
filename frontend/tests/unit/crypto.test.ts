/**
 * @jest-environment node
 */

/**
 * Crypto Module Tests — verifies encrypt/decrypt roundtrip, tamper detection,
 * key clearing, hashedEmailId determinism, and error handling.
 */

import {
  encryptData,
  decryptData,
  setEncryptionKey,
  getEncryptionKey,
  setCrossDeviceDetails,
  getHashedEmailId,
  getCrossDeviceKey,
  clearKeys,
} from "../../electron/services/crypto";

describe("Crypto Service", () => {
  const testKey = "test-encryption-key-32chars-long!";
  const testData = "Hello, this is sensitive data!";

  beforeEach(() => {
    clearKeys();
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("encrypts and decrypts a string correctly", () => {
      const encrypted = encryptData(testData, testKey);
      expect(encrypted).not.toBe(testData);
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = decryptData(encrypted, testKey);
      expect(decrypted).toBe(testData);
    });

    it("produces different ciphertext for same plaintext (random IV)", () => {
      const encrypted1 = encryptData(testData, testKey);
      const encrypted2 = encryptData(testData, testKey);
      expect(encrypted1).not.toBe(encrypted2);
    });
  });

  describe("tampered ciphertext detection", () => {
    it("throws when ciphertext is tampered with", () => {
      const encrypted = encryptData(testData, testKey);

      // Decode base64, flip a byte in the middle, re-encode
      const buf = Buffer.from(encrypted, "base64");
      const midpoint = Math.floor(buf.length / 2);
      buf[midpoint] ^= 0xff; // flip all bits of one byte
      const tampered = buf.toString("base64");

      expect(() => decryptData(tampered, testKey)).toThrow();
    });

    it("throws when ciphertext is truncated", () => {
      const encrypted = encryptData(testData, testKey);
      const truncated = encrypted.slice(0, 10);
      expect(() => decryptData(truncated, testKey)).toThrow();
    });
  });

  describe("clearKeys", () => {
    it("zeros all keys after clearKeys() is called", () => {
      setEncryptionKey("my-secret-key");
      setCrossDeviceDetails("user@example.com", "password123");

      expect(getEncryptionKey()).toBe("my-secret-key");
      expect(getHashedEmailId()).not.toBe("");
      expect(getCrossDeviceKey()).not.toBe("");

      clearKeys();

      expect(getEncryptionKey()).toBe("");
      expect(getHashedEmailId()).toBe("");
      expect(getCrossDeviceKey()).toBe("");
    });
  });

  describe("hashedEmailId determinism", () => {
    it("produces the same hashedEmailId for the same email and password", () => {
      setCrossDeviceDetails("user@example.com", "password123");
      const hash1 = getHashedEmailId();

      clearKeys();

      setCrossDeviceDetails("user@example.com", "password123");
      const hash2 = getHashedEmailId();

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64); // 32 bytes = 64 hex chars
    });

    it("produces different hashedEmailId for different emails", () => {
      setCrossDeviceDetails("user1@example.com", "password123");
      const hash1 = getHashedEmailId();

      clearKeys();

      setCrossDeviceDetails("user2@example.com", "password123");
      const hash2 = getHashedEmailId();

      expect(hash1).not.toBe(hash2);
    });

    it("is case-insensitive for email", () => {
      setCrossDeviceDetails("User@Example.COM", "password123");
      const hash1 = getHashedEmailId();

      clearKeys();

      setCrossDeviceDetails("user@example.com", "password123");
      const hash2 = getHashedEmailId();

      expect(hash1).toBe(hash2);
    });
  });

  describe("encryptData requires key", () => {
    it("throws when key is empty string", () => {
      expect(() => encryptData(testData, "")).toThrow(/[Ee]ncryption key/);
    });

    it("throws when decryptData is called with empty key", () => {
      const encrypted = encryptData(testData, testKey);
      expect(() => decryptData(encrypted, "")).toThrow(/[Ee]ncryption key/);
    });
  });
});
