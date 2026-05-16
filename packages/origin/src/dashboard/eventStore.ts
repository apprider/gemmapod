import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import type { ChatEvent } from "./server.js";

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

const DEFAULT_DB_PATH = join(homedir(), ".gemmapod", "dashboard.sqlite");
const require = createRequire(import.meta.url);

export class EventStore {
  readonly path: string;
  private db: SqliteDatabase | null = null;
  private insertStmt?: SqliteStatement;
  private recentStmt?: SqliteStatement;
  private countStmt?: SqliteStatement;
  private deleteOldStmt?: SqliteStatement;
  private inMemoryCache: ChatEvent[] = [];
  private readonly maxCache = 200;

  constructor(path = process.env.GEMMAPOD_DASHBOARD_DB ?? DEFAULT_DB_PATH) {
    this.path = path;
    this.open();
  }

  get available(): boolean {
    return this.db !== null;
  }

  push(event: ChatEvent): void {
    // Add to in-memory cache for fast SSE delivery
    this.inMemoryCache.push(event);
    if (this.inMemoryCache.length > this.maxCache) {
      this.inMemoryCache.shift();
    }

    if (this.insertStmt) {
      try {
        this.insertStmt.run(
          event.id,
          event.type,
          event.content,
          event.timestamp,
          JSON.stringify(event.metadata ?? {}),
        );
      } catch (e) {
        console.warn("[dashboard] failed to persist event:", (e as Error).message);
      }
    }
  }

  getRecent(limit = 100): ChatEvent[] {
    // Prefer in-memory cache for recent items
    if (this.inMemoryCache.length >= limit) {
      return this.inMemoryCache.slice(-limit);
    }

    if (!this.recentStmt) return this.inMemoryCache.slice(-limit);
    try {
      const rows = this.recentStmt.all(limit) as Array<{
        id: string;
        type: string;
        content: string;
        timestamp: number;
        metadata_json: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        type: r.type as ChatEvent["type"],
        content: r.content,
        timestamp: r.timestamp,
        metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
      }));
    } catch (e) {
      console.warn("[dashboard] failed to load recent events:", (e as Error).message);
      return this.inMemoryCache.slice(-limit);
    }
  }

  getCount(): number {
    if (!this.countStmt) return this.inMemoryCache.length;
    try {
      const row = this.countStmt.get() as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      return this.inMemoryCache.length;
    }
  }

  pruneOlderThan(cutoffMs: number): void {
    this.inMemoryCache = this.inMemoryCache.filter((e) => e.timestamp >= cutoffMs);
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
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          metadata_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE INDEX IF NOT EXISTS events_timestamp_idx ON events(timestamp);
        CREATE INDEX IF NOT EXISTS events_type_idx ON events(type);
      `);
      this.insertStmt = this.db.prepare(
        `INSERT OR REPLACE INTO events (id, type, content, timestamp, metadata_json)
         VALUES (?, ?, ?, ?, ?)`,
      );
      this.recentStmt = this.db.prepare(
        `SELECT id, type, content, timestamp, metadata_json
         FROM events ORDER BY timestamp DESC LIMIT ?`,
      );
      this.countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM events`);
      this.deleteOldStmt = this.db.prepare(`DELETE FROM events WHERE timestamp < ?`);
      console.log(`[dashboard] event SQLite store: ${this.path}`);
    } catch (e) {
      this.db = null;
      console.warn(
        `[dashboard] SQLite event store unavailable; using memory only: ${(e as Error).message}`,
      );
    }
  }
}
