/**
 * Atlas Local Store — SQLite-based persistence for workflow state.
 *
 * Uses better-sqlite3 (synchronous, fast, Electron-friendly).
 * Database stored at: app.getPath('userData')/atlas-workflows.db
 *
 * Tables:
 * - conversations: conversation threads
 * - messages: individual messages within conversations
 * - tool_executions: log of MCP tool calls and their results
 * - config: key-value store for user preferences
 */

import { app } from "electron";
import * as path from "path";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  created_at: string;
  title: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
}

export interface ToolExecution {
  id: string;
  conversation_id: string;
  server: string;
  tool: string;
  params: string; // JSON string
  result: string; // JSON string
  timestamp: string;
}

// ── Database Singleton ─────────────────────────────────────────────────────────

let db: ReturnType<typeof Database> | null = null;

/**
 * Get the database path. Uses app.getPath('userData') for persistent storage.
 * Falls back to a temp path if app is not ready (shouldn't happen in practice).
 */
function getDbPath(): string {
  try {
    return path.join(app.getPath("userData"), "atlas-workflows.db");
  } catch {
    // Fallback for unit testing outside of Electron
    return path.join(process.cwd(), "atlas-workflows.db");
  }
}

/**
 * Initialize the database, creating tables if they don't exist.
 * Must be called once at app startup (after app.whenReady()).
 */
export function initDB(): void {
  if (db) return;

  const dbPath = getDbPath();
  console.log(`[Atlas Store] Opening database at: ${dbPath}`);

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      title TEXT NOT NULL DEFAULT 'New Conversation'
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      server TEXT NOT NULL,
      tool TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '{}',
      result TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversation_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_tool_executions_conversation
      ON tool_executions(conversation_id, timestamp);

    CREATE INDEX IF NOT EXISTS idx_conversations_created
      ON conversations(created_at DESC);
  `);

  console.log("[Atlas Store] Database initialized successfully");
}

/**
 * Close the database connection. Call on app quit.
 */
export function closeDB(): void {
  if (db) {
    db.close();
    db = null;
    console.log("[Atlas Store] Database closed");
  }
}

/**
 * Get the database instance. Throws if not initialized.
 */
function getDB(): ReturnType<typeof Database> {
  if (!db) {
    throw new Error("[Atlas Store] Database not initialized. Call initDB() first.");
  }
  return db;
}

// ── Conversation Operations ────────────────────────────────────────────────────

/**
 * Create a new conversation and return its ID.
 */
export function createConversation(title: string, userId: string = "local"): Conversation {
  const d = getDB();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  d.prepare(
    "INSERT INTO conversations (id, user_id, created_at, title) VALUES (?, ?, ?, ?)"
  ).run(id, userId, createdAt, title);

  return { id, user_id: userId, created_at: createdAt, title };
}

/**
 * List conversations, most recent first.
 */
export function listConversations(limit: number = 50): Conversation[] {
  const d = getDB();
  return d
    .prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?")
    .all(limit) as Conversation[];
}

/**
 * Get a single conversation by ID.
 */
export function getConversation(id: string): Conversation | undefined {
  const d = getDB();
  return d.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as
    | Conversation
    | undefined;
}

/**
 * Update conversation title.
 */
export function updateConversationTitle(id: string, title: string): void {
  const d = getDB();
  d.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}

// ── Message Operations ─────────────────────────────────────────────────────────

/**
 * Save a message to a conversation.
 */
export function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string
): Message {
  const d = getDB();
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  d.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
  ).run(id, conversationId, role, content, timestamp);

  return { id, conversation_id: conversationId, role, content, timestamp };
}

/**
 * Get conversation history (messages) ordered by timestamp.
 */
export function getConversationHistory(
  conversationId: string,
  limit: number = 100
): Message[] {
  const d = getDB();
  return d
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?"
    )
    .all(conversationId, limit) as Message[];
}

// ── Tool Execution Operations ──────────────────────────────────────────────────

/**
 * Log a tool execution (MCP tool call + result).
 */
export function saveToolExecution(
  conversationId: string,
  server: string,
  tool: string,
  params: Record<string, unknown>,
  result: unknown
): ToolExecution {
  const d = getDB();
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const paramsJson = JSON.stringify(params);
  const resultJson = JSON.stringify(result);

  d.prepare(
    "INSERT INTO tool_executions (id, conversation_id, server, tool, params, result, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, conversationId, server, tool, paramsJson, resultJson, timestamp);

  return {
    id,
    conversation_id: conversationId,
    server,
    tool,
    params: paramsJson,
    result: resultJson,
    timestamp,
  };
}

/**
 * Get tool executions for a conversation.
 */
export function getToolExecutions(
  conversationId: string,
  limit: number = 50
): ToolExecution[] {
  const d = getDB();
  return d
    .prepare(
      "SELECT * FROM tool_executions WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?"
    )
    .all(conversationId, limit) as ToolExecution[];
}

// ── Config Operations ──────────────────────────────────────────────────────────

/**
 * Get a config value by key. Returns undefined if not set.
 */
export function getConfig(key: string): string | undefined {
  const d = getDB();
  const row = d.prepare("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

/**
 * Set a config key-value pair (upserts).
 */
export function setConfig(key: string, value: string): void {
  const d = getDB();
  d.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/**
 * Delete a config key.
 */
export function deleteConfig(key: string): void {
  const d = getDB();
  d.prepare("DELETE FROM config WHERE key = ?").run(key);
}
