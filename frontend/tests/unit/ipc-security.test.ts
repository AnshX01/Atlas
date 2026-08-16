/**
 * ipc-security.test.ts
 *
 * Tests the hardened IPC handler logic for:
 *   - open-external: URL scheme allowlist (https/http only)
 *   - parse-file: path traversal / home-directory allowlist
 *
 * We test the handler logic directly by extracting the validation
 * logic, since full Electron IPC is not available in Jest.
 */

import * as path from "path";
import * as os from "os";

// ── open-external validation (extracted from main.ts handler) ─────────────────

function validateOpenExternalUrl(url: unknown): void {
  if (typeof url !== "string" || url.length > 10000) {
    throw new Error("invalid input");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("malformed URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`disallowed protocol '${parsed.protocol}'`);
  }
}

// ── parse-file validation (extracted from main.ts handler) ────────────────────

function validateParseFilePath(filePath: unknown): string {
  if (typeof filePath !== "string" || filePath.length > 10000) {
    throw new Error("invalid input");
  }
  const resolved = path.resolve(filePath);
  const homeDir = os.homedir();
  if (!resolved.startsWith(homeDir + path.sep) && resolved !== homeDir) {
    throw new Error(`path '${resolved}' is outside the allowed directory`);
  }
  return resolved;
}

// ── open-external tests ───────────────────────────────────────────────────────

describe("open-external scheme validation", () => {
  test("accepts https:// URLs", () => {
    expect(() => validateOpenExternalUrl("https://github.com")).not.toThrow();
  });

  test("accepts http:// URLs", () => {
    expect(() => validateOpenExternalUrl("http://localhost:3000")).not.toThrow();
  });

  test("rejects file:// protocol", () => {
    expect(() => validateOpenExternalUrl("file:///etc/passwd")).toThrow("disallowed protocol");
  });

  test("rejects javascript: protocol", () => {
    expect(() => validateOpenExternalUrl("javascript:alert(1)")).toThrow("disallowed protocol");
  });

  test("rejects ftp:// protocol", () => {
    expect(() => validateOpenExternalUrl("ftp://example.com")).toThrow("disallowed protocol");
  });

  test("rejects data: URI", () => {
    expect(() => validateOpenExternalUrl("data:text/html,<h1>xss</h1>")).toThrow("disallowed protocol");
  });

  test("rejects non-string input (number)", () => {
    expect(() => validateOpenExternalUrl(42)).toThrow("invalid input");
  });

  test("rejects non-string input (null)", () => {
    expect(() => validateOpenExternalUrl(null)).toThrow("invalid input");
  });

  test("rejects malformed URL", () => {
    expect(() => validateOpenExternalUrl("not a url at all !!")).toThrow();
  });

  test("rejects string longer than 10000 chars", () => {
    expect(() => validateOpenExternalUrl("https://x.com/" + "a".repeat(10000))).toThrow("invalid input");
  });
});

// ── parse-file path traversal tests ──────────────────────────────────────────

describe("parse-file path validation", () => {
  const homeDir = os.homedir();

  test("accepts a path within the home directory", () => {
    const safePath = path.join(homeDir, "Documents", "myfile.txt");
    expect(() => validateParseFilePath(safePath)).not.toThrow();
  });

  test("returns the resolved (normalized) path", () => {
    const safePath = path.join(homeDir, "Documents", "myfile.txt");
    const result = validateParseFilePath(safePath);
    expect(result).toBe(safePath);
  });

  test("rejects /etc/passwd", () => {
    // On Windows this won't resolve to /etc/passwd but resolve() will produce an absolute
    // Windows path not starting with homeDir, so it should still throw
    expect(() => validateParseFilePath("/etc/passwd")).toThrow("outside the allowed directory");
  });

  test("rejects path traversal attack ../../secrets.txt", () => {
    // path.resolve("../../secrets.txt") from cwd won't be in home dir (depends on cwd)
    // We explicitly construct a traversal attempt
    const traversal = path.join(homeDir, "Documents", "..", "..", "Windows", "System32", "config", "SAM");
    expect(() => validateParseFilePath(traversal)).toThrow("outside the allowed directory");
  });

  test("rejects non-string filePath (number)", () => {
    expect(() => validateParseFilePath(99)).toThrow("invalid input");
  });

  test("rejects non-string filePath (undefined)", () => {
    expect(() => validateParseFilePath(undefined)).toThrow("invalid input");
  });

  test("rejects path exceeding 10000 chars", () => {
    expect(() => validateParseFilePath(homeDir + path.sep + "a".repeat(10001))).toThrow("invalid input");
  });
});
