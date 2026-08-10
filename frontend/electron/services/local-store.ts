/**
 * Atlas Local Store — SQLite-based persistence for workflow state.
 *
 * Uses sql.js (pure JavaScript SQLite, no native compilation required).
 * Database stored at: app.getPath('userData')/atlas-workflows.db
 * Persists to disk on every write operation.
 *
 * Tables:
 * - conversations: conversation threads
 * - messages: individual messages within conversations
 * - tool_executions: log of MCP tool calls and their results
 * - config: key-value store for user preferences
 */

import { app } from "electron";
import * as path from "path";
import * as fs from "fs";
import { randomUUID } from "crypto";
import { LRUCache } from "./cache";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  user_id: string;
  created_at: string;
  title: string;
  updated_at?: string;
  deleted?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  updated_at?: string;
  deleted?: number;
}

export interface ToolExecution {
  id: string;
  conversation_id: string;
  server: string;
  tool: string;
  params: string;
  result: string;
  timestamp: string;
  updated_at?: string;
  deleted?: number;
}

// ── Database Singleton ─────────────────────────────────────────────────────────

let db: any = null;
let dbPath: string = "";
let SQL: any = null;

const conversationCache = new LRUCache<Conversation>(100);
const messagesCache = new LRUCache<Message[]>(100);

function getDbPath(): string {
  try {
    return path.join(app.getPath("userData"), "atlas-workflows.db");
  } catch {
    return path.join(process.cwd(), "atlas-workflows.db");
  }
}

let isPersisting = false;
let pendingPersist = false;

async function persistToDisk(): Promise<void> {
  if (!db) return;
  if (isPersisting) {
    pendingPersist = true;
    return;
  }
  isPersisting = true;
  pendingPersist = false;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = dbPath + '.tmp';
    await fs.promises.writeFile(tmpPath, buffer);
    await fs.promises.rename(tmpPath, dbPath);
  } catch (err) {
    console.error("[Atlas Store] Failed to persist database:", err);
  } finally {
    isPersisting = false;
    if (pendingPersist) {
      persistToDisk();
    }
  }
}

function persistToDiskSync(): void {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const tmpPath = dbPath + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, dbPath);
  } catch (err) {
    console.error("[Atlas Store] Failed to persist database synchronously:", err);
  }
}

/**
 * Initialize the database, creating tables if they don't exist.
 * Must be called once at app startup (after app.whenReady()).
 */
export async function initDB(): Promise<void> {
  if (db) return;

  // Dynamic import of sql.js
  const initSqlJs = require("sql.js");
  SQL = await initSqlJs();

  dbPath = getDbPath();

  // Load existing database from file, or create new one
  try {
    if (fs.existsSync(dbPath)) {
      const fileBuffer = fs.readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }
  } catch (err) {
    console.error("[Atlas Store] CRITICAL: Database load failed, creating backup:", err);
    try {
      const backupPath = dbPath + `.backup-${Date.now()}`;
      fs.copyFileSync(dbPath, backupPath);
    } catch (e) {}
    db = new SQL.Database();
  }

  // Create tables
  db.run("BEGIN IMMEDIATE");
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Conversation',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tool_executions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        server TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT NOT NULL DEFAULT '{}',
        result TEXT NOT NULL DEFAULT '{}',
        timestamp TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversationId ON messages(conversation_id);
    `);
    
    // Add columns to existing tables if missing (ignore errors if they exist)
    const tables = ['conversations', 'messages', 'tool_executions', 'config'];
    for (const table of tables) {
      try { db.run(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`); } catch (e) {}
      try { db.run(`ALTER TABLE ${table} ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
    }
    
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  persistToDisk();
}

/**
 * Close the database connection. Call on app quit.
 */
export function closeDB(): void {
  if (db) {
    persistToDiskSync();
    db.close();
    db = null;
  }
}

// ── Conversation Operations ────────────────────────────────────────────────────

import { syncManager } from "./cloud-sync";

export function createConversation(title: string, userId: string = "local"): Conversation {
  if (!db) throw new Error("Database not initialized");
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.run("BEGIN IMMEDIATE");
  try {
    db.run(
      "INSERT INTO conversations (id, user_id, created_at, title) VALUES (?, ?, ?, ?)",
      [id, userId, createdAt, title]
    );
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  persistToDisk();

  const conv = { id, user_id: userId, created_at: createdAt, title };
  syncManager.queueDelta({
    table: "conversations",
    operation: "INSERT",
    data: conv,
    timestamp: createdAt
  });

  return conv;
}

export function listConversations(limit: number = 50): Conversation[] {
  if (!db) return [];
  const stmt = db.prepare("SELECT * FROM conversations ORDER BY created_at DESC LIMIT ?");
  try {
    stmt.bind([limit]);
    const results: Conversation[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as Conversation);
    }
    return results;
  } finally {
    stmt.free();
  }
}



export function saveMessage(
  conversationId: string,
  role: "user" | "assistant" | "system" | "tool",
  content: string
): Message {
  if (!db) throw new Error("Database not initialized");
  const id = randomUUID();
  const timestamp = new Date().toISOString();

  db.run("BEGIN IMMEDIATE");
  try {
    db.run(
      "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)",
      [id, conversationId, role, content, timestamp]
    );
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  persistToDisk();

  messagesCache.clear();

  const msg = { id, conversation_id: conversationId, role, content, timestamp };
  syncManager.queueDelta({
    table: "messages",
    operation: "INSERT",
    data: msg,
    timestamp
  });

  return msg;
}

export function getConversationHistory(
  conversationId: string,
  limit: number = 100
): Message[] {
  if (!db) return [];

  const cacheKey = `${conversationId}:${limit}`;
  const cached = messagesCache.get(cacheKey);
  if (cached) return cached;

  const stmt = db.prepare(
    "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?"
  );
  try {
    stmt.bind([conversationId, limit]);
    const results: Message[] = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject() as unknown as Message);
    }
    messagesCache.set(cacheKey, results);
    return results;
  } finally {
    stmt.free();
  }
}

// ── Tool Execution Operations ──────────────────────────────────────────────────

export function saveToolExecution(
  conversationId: string,
  server: string,
  tool: string,
  params: Record<string, unknown>,
  result: unknown
): ToolExecution {
  if (!db) throw new Error("Database not initialized");
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const paramsJson = JSON.stringify(params);
  const resultJson = JSON.stringify(result);

  db.run("BEGIN IMMEDIATE");
  try {
    db.run(
      "INSERT INTO tool_executions (id, conversation_id, server, tool, params, result, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, conversationId, server, tool, paramsJson, resultJson, timestamp]
    );
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }
  persistToDisk();

  const exec = {
    id,
    conversation_id: conversationId,
    server,
    tool,
    params: paramsJson,
    result: resultJson,
    timestamp,
  };
  syncManager.queueDelta({
    table: "tool_executions",
    operation: "INSERT",
    data: exec,
    timestamp
  });

  return exec;
}


