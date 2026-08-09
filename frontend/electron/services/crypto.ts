import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

let globalEncryptionKey = "";

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

/**
 * Encrypts a string using AES-256-GCM and a derived key from the given encryption key.
 * Format: base64( salt + iv + auth_tag + ciphertext )
 */
export function encryptData(data: string, keyString: string): string {
  if (!keyString) {
    throw new Error("Encryption key is required for encryption");
  }

  const salt = randomBytes(SALT_LENGTH);
  const key = pbkdf2Sync(keyString, salt, ITERATIONS, KEY_LENGTH, "sha256");
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

  const key = pbkdf2Sync(keyString, salt, ITERATIONS, KEY_LENGTH, "sha256");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}
