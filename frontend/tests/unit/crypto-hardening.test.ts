/**
 * crypto-hardening.test.ts
 *
 * Verifies:
 *   1. AES-256-GCM encrypt/decrypt round-trip
 *   2. Different keys produce different ciphertext (random IV)
 *   3. Tampered ciphertext throws on decryption (GCM auth tag)
 *   4. Empty key guard on encrypt and decrypt
 *   5. setCrossDeviceDetails no longer uses email as both key AND salt
 *   6. clearKeys() wipes all in-memory key state
 */

jest.mock("electron", () => ({ app: { getPath: () => "/tmp" } }));

import {
  encryptData,
  decryptData,
  setEncryptionKey,
  getEncryptionKey,
  setCrossDeviceDetails,
  getCrossDeviceKey,
  getHashedEmailId,
  clearKeys,
} from "../../electron/services/crypto";
import { pbkdf2Sync } from "crypto";

const KEY_A = "super-secret-key-for-testing-only";
const KEY_B = "a-different-key-that-must-not-match";
const PLAINTEXT = JSON.stringify({ github: { token: "ghp_test123" } });

describe("encryptData / decryptData round-trip", () => {
  test("decrypted output equals original plaintext", () => {
    expect(decryptData(encryptData(PLAINTEXT, KEY_A), KEY_A)).toBe(PLAINTEXT);
  });

  test("same plaintext + key produces different ciphertext each call (random IV)", () => {
    expect(encryptData(PLAINTEXT, KEY_A)).not.toBe(encryptData(PLAINTEXT, KEY_A));
  });

  test("wrong key cannot decrypt", () => {
    expect(() => decryptData(encryptData(PLAINTEXT, KEY_A), KEY_B)).toThrow();
  });

  test("bit-flipped ciphertext fails GCM auth tag", () => {
    const buf = Buffer.from(encryptData(PLAINTEXT, KEY_A), "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptData(buf.toString("base64"), KEY_A)).toThrow();
  });

  test("truncated input throws format error", () => {
    expect(() => decryptData("aGVsbG8=", KEY_A)).toThrow("Invalid encrypted data format");
  });
});

describe("key guards", () => {
  test("encryptData throws on empty key", () => {
    expect(() => encryptData(PLAINTEXT, "")).toThrow("Encryption key is required");
  });

  test("decryptData throws on empty key", () => {
    expect(() => decryptData(encryptData(PLAINTEXT, KEY_A), "")).toThrow("Encryption key is required");
  });
});

describe("setCrossDeviceDetails - email-as-salt elimination", () => {
  const EMAIL = "test@example.com";
  const PASS = "correct-horse-battery-staple";
  const APP_SALT = "atlas-app-v1-email-id-derivation";

  beforeEach(() => clearKeys());

  test("hashedEmailId uses constant app salt, NOT email as salt", () => {
    setCrossDeviceDetails(EMAIL, PASS);
    const actual = getHashedEmailId();
    const correct = pbkdf2Sync(EMAIL, APP_SALT, 600_000, 32, "sha256").toString("hex");
    expect(actual).toBe(correct);
  });

  test("crossDeviceKey salt uses pepper", () => {
    setCrossDeviceDetails(EMAIL, PASS);
    const actual = getCrossDeviceKey();
    const vulnerable = pbkdf2Sync(PASS, Buffer.from(EMAIL, "utf-8"), 600_000, 32, "sha256").toString("hex");
    const correct = pbkdf2Sync(PASS, Buffer.from(EMAIL + "atlas-cross-device-salt", "utf-8"), 600_000, 32, "sha256").toString("hex");
    expect(actual).toBe(correct);
    expect(actual).not.toBe(vulnerable);
  });

  test("different emails produce different hashed IDs", () => {
    setCrossDeviceDetails("a@x.com", PASS);
    const a = getHashedEmailId();
    clearKeys();
    setCrossDeviceDetails("b@x.com", PASS);
    expect(getHashedEmailId()).not.toBe(a);
  });

  test("crossDeviceKey is 64 hex chars (32 bytes)", () => {
    setCrossDeviceDetails(EMAIL, PASS);
    expect(getCrossDeviceKey()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("setEncryptionKey / clearKeys", () => {
  test("roundtrip set/get", () => {
    setEncryptionKey("my-key");
    expect(getEncryptionKey()).toBe("my-key");
    clearKeys();
  });

  test("clearKeys wipes all state", () => {
    setCrossDeviceDetails("u@t.com", "pw");
    setEncryptionKey("session");
    clearKeys();
    expect(getEncryptionKey()).toBe("");
    expect(getCrossDeviceKey()).toBe("");
    expect(getHashedEmailId()).toBe("");
  });
});
