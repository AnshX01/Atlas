import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 600000;
// ENCRYPT_ITERATIONS raised from 1,000 → 210,000 (NIST SP 800-132 / 2024 minimum for PBKDF2-SHA256).
// The legacy value of 1,000 was 210× below minimum. decryptData falls back to 1,000 for
// backward-compatibility, so existing stores are transparently re-encrypted on next write.
const ENCRYPT_ITERATIONS = 210_000;
const LEGACY_ENCRYPT_ITERATIONS = 1_000;

let globalEncryptionKey = "";
let crossDeviceKey = "";
let hashedEmailId = "";

/**
 * Set the encryption key (derived from auth session token) to be used for encryption/decryption of tokens.
 */
export function setEncryptionKey(key: string): void {
  globalEncryptionKey = key;
}

/**
 * Get the current encryption key.
 */
export function getEncryptionKey(): string {
  return globalEncryptionKey;
}

// Constant application-level salt for hashed email ID derivation.
// Must NOT use the email as salt — that made the hash deterministic and precomputable.
const EMAIL_ID_DERIVATION_SALT = "atlas-app-v1-email-id-derivation";
const CROSS_DEVICE_SALT_PEPPER = "atlas-cross-device-salt";

export function setCrossDeviceDetails(email: string, password: string): void {
  const salt = Buffer.from(email.toLowerCase() + CROSS_DEVICE_SALT_PEPPER, "utf-8");
  const key = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
  crossDeviceKey = key.toString("hex");
  // Derive a stable per-email ID using a constant app-level salt (not the email itself)
  hashedEmailId = pbkdf2Sync(email.toLowerCase(), EMAIL_ID_DERIVATION_SALT, ITERATIONS, 32, "sha256").toString("hex");
}

export function getCrossDeviceKey(): string {
  return crossDeviceKey;
}

export function getHashedEmailId(): string {
  return hashedEmailId;
}

export function clearKeys(): void {
  globalEncryptionKey = "";
  crossDeviceKey = "";
  hashedEmailId = "";
}

/**
 * Encrypts a string using AES-256-GCM and a derived key from the given encryption key.
 * Format: base64( salt + iv + auth_tag + ciphertext )
 */
export function encryptData(data: string, keyString: string): string {
  if (!keyString) {
    throw new Error("Encryption key is required for encryption");
  }

  const salt = randomBytes(SALT_LENGTH);
  const key = pbkdf2Sync(keyString, salt, ENCRYPT_ITERATIONS, KEY_LENGTH, "sha256");
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a base64 encoded string previously encrypted with encryptData.
 */
export function decryptData(encryptedBase64: string, keyString: string): string {
  if (!keyString) {
    throw new Error("Encryption key is required for decryption");
  }

  const buf = Buffer.from(encryptedBase64, "base64");
  
  if (buf.length < SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted data format");
  }

  const salt = buf.subarray(0, SALT_LENGTH);
  const iv = buf.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buf.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  let key: Buffer;
  // Backward-compat: try current iteration count first, then legacy 1,000.
  // This enables transparent migration: legacy-encrypted tokens decrypt here,
  // then the next write call re-encrypts them at ENCRYPT_ITERATIONS (210,000).
  try {
    key = pbkdf2Sync(keyString, salt, ENCRYPT_ITERATIONS, KEY_LENGTH, "sha256");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // First attempt failed (likely legacy data) — try the legacy iteration count
    key = pbkdf2Sync(keyString, salt, LEGACY_ENCRYPT_ITERATIONS, KEY_LENGTH, "sha256");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  }
}
