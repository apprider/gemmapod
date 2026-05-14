import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";

export type OriginMessage = {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export interface ConversationMemory {
  messages: OriginMessage[];
  updatedAt: number;
}

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface ConversationRow {
  messages: string;
  updated_at: number;
}

const DEFAULT_DB_PATH = join(homedir(), ".gemmapod", "origin.sqlite");
const require = createRequire(import.meta.url);

export class ConversationStore {
  readonly path: string;
  private readonly memory = new Map<string, ConversationMemory>();
  private db: SqliteDatabase | null = null;
  private upsertStmt?: SqliteStatement;
  private getStmt?: SqliteStatement;
  private deleteOldStmt?: SqliteStatement;

  constructor(path = process.env.GEMMAPOD_ORIGIN_DB ?? DEFAULT_DB_PATH) {
    this.path = path;
    this.open();
  }

  get available(): boolean {
    return this.db !== null;
  }

  get(key: string): ConversationMemory | undefined {
    const remembered = this.memory.get(key);
    if (remembered) return remembered;
    if (!this.getStmt) return undefined;
    const row = this.getStmt.get(key) as ConversationRow | undefined;
    if (!row) return undefined;
    const loaded = parseMemory(row.messages, row.updated_at);
    if (loaded) this.memory.set(key, loaded);
    return loaded;
  }

  set(key: string, memory: ConversationMemory): void {
    this.memory.set(key, memory);
    this.upsertStmt?.run(key, JSON.stringify(memory.messages), memory.updatedAt);
  }

  pruneOlderThan(cutoffMs: number): void {
    for (const [key, memory] of this.memory) {
      if (memory.updatedAt < cutoffMs) this.memory.delete(key);
    }
    this.deleteOldStmt?.run(cutoffMs);
  }

  private open(): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const sqlite = require("node:sqlite") as {
        DatabaseSync: new (path: string) => SqliteDatabase;
      };
      this.db = new sqlite.DatabaseSync(this.path);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          key TEXT PRIMARY KEY,
          messages TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
          ON conversations(updated_at);
      `);
      this.upsertStmt = this.db.prepare(`
        INSERT INTO conversations (key, messages, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          messages = excluded.messages,
          updated_at = excluded.updated_at
      `);
      this.getStmt = this.db.prepare("SELECT messages, updated_at FROM conversations WHERE key = ?");
      this.deleteOldStmt = this.db.prepare("DELETE FROM conversations WHERE updated_at < ?");
      console.log(`[origin] conversation SQLite store: ${this.path}`);
    } catch (e) {
      this.db = null;
      console.warn(
        `[origin] SQLite conversation store unavailable; using memory only: ${(e as Error).message}`,
      );
    }
  }
}

export function defaultConversationDbPath(): string {
  return DEFAULT_DB_PATH;
}

function parseMemory(messagesJson: string, updatedAt: number): ConversationMemory | undefined {
  try {
    const messages = JSON.parse(messagesJson) as unknown;
    if (!Array.isArray(messages)) return undefined;
    return {
      messages: messages.filter(isOriginMessage),
      updatedAt,
    };
  } catch {
    return undefined;
  }
}

function isOriginMessage(value: unknown): value is OriginMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.role === "string" && typeof candidate.content === "string";
}
