// Registry interface for the cloud broker.
//
// A Registry is the pluggable storage backend for the pod registry — the
// thing behind `POST /pods` and `GET /:id`. The signaling broker is
// transport-only and never touches a Registry; the registry is only
// consulted for the HTTP routes.
//
// Two reference implementations ship in this package:
//
//   - `MemoryRegistry`  — Maps in process. Good for tests, demos, and the
//     `npx @gemmapod/cloud start` ergonomic. State is lost on restart.
//   - `SqliteRegistry`  — Persistent. Uses node:sqlite (built into Node 22)
//     and a filesystem blob directory. Production-grade self-host.
//
// The Firebase-backed registry (Firestore + Cloud Storage) is a separate,
// private implementation in the gemmapod.com deployment repo — it imports
// `Registry` from here and plugs in over the same interface.
//
// `createPod` is the shared verification path: extract the inlined signed
// manifest from the HTML blob, verify it with @gemmapod/core, generate a
// 12-char URL-safe ID, build a `PodRecord`, and hand both to the Registry.
// The verification step is identical regardless of backend, so backends do
// NOT see unverified blobs.

import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

interface CoreShape {
  GemmaPodCore: {
    verifyManifest(bytes: Uint8Array): {
      v: number;
      id: string;
      name: string;
      owner_pubkey: string;
      [k: string]: unknown;
    };
  };
}

let core: CoreShape | null = null;
function loadCore(): CoreShape {
  if (!core) core = require("@gemmapod/core/node") as CoreShape;
  return core;
}

export interface PodRecord {
  id: string;
  name: string;
  ownerPubkey: string;
  manifestSize: number;
  blobSize: number;
  /** ISO timestamp string. Backends MAY store native timestamps internally
   *  but MUST surface ISO strings through this interface for portability. */
  createdAt: string;
  hits: number;
}

/** Storage primitives the signaling server needs. Backends only see
 *  records and blobs the cloud has already verified. */
export interface Registry {
  /** Write a verified pod (record + HTML blob) atomically. */
  putPod(record: PodRecord, blob: Buffer): Promise<void>;
  /** Look up a pod record by id. */
  getRecord(id: string): Promise<PodRecord | null>;
  /** Fetch the HTML blob for an id. */
  getBlob(id: string): Promise<Buffer | null>;
  /** Best-effort hit counter increment. Errors here are non-fatal. */
  bumpHits(id: string): Promise<void>;
  /** Optional cleanup hook. The CLI calls this on SIGINT/SIGTERM. */
  close?(): Promise<void>;
}

const MANIFEST_RE = /__GEMMAPOD_MANIFEST_B64\s*=\s*"([A-Za-z0-9+/=]+)"/;
const MAX_BLOB_BYTES = 50 * 1024 * 1024;

function extractManifest(html: string): Uint8Array {
  const m = html.match(MANIFEST_RE);
  if (!m) throw new Error("blob is missing __GEMMAPOD_MANIFEST_B64");
  return Uint8Array.from(Buffer.from(m[1]!, "base64"));
}

/** 12-char URL-safe slug (~71 bits of entropy). Stable across registries. */
export function newPodId(): string {
  return randomBytes(9).toString("base64url");
}

/**
 * Shared signed-pod ingest path. Verifies the inlined manifest, generates
 * an id, builds a `PodRecord`, and delegates storage to the registry.
 * Throws on missing/invalid manifest, oversize blobs, or registry errors.
 */
export async function createPod(
  registry: Registry,
  html: string,
): Promise<{ id: string; ownerPubkey: string }> {
  const htmlBytes = Buffer.from(html, "utf8");
  if (htmlBytes.byteLength > MAX_BLOB_BYTES) {
    throw new Error("blob too large (>50 MB)");
  }
  const manifestBytes = extractManifest(html);
  const { GemmaPodCore } = loadCore();
  const manifest = GemmaPodCore.verifyManifest(manifestBytes); // throws on bad sig

  const record: PodRecord = {
    id: newPodId(),
    name: manifest.name,
    ownerPubkey: manifest.owner_pubkey,
    manifestSize: manifestBytes.length,
    blobSize: htmlBytes.byteLength,
    createdAt: new Date().toISOString(),
    hits: 0,
  };
  await registry.putPod(record, htmlBytes);
  return { id: record.id, ownerPubkey: record.ownerPubkey };
}

// ---------------------------------------------------------------------------
// MemoryRegistry — in-process Maps. Lost on restart; perfect for tests and
// the zero-config `npx @gemmapod/cloud start` path.
// ---------------------------------------------------------------------------

export class MemoryRegistry implements Registry {
  readonly name = "memory" as const;
  private readonly records = new Map<string, PodRecord>();
  private readonly blobs = new Map<string, Buffer>();

  async putPod(record: PodRecord, blob: Buffer): Promise<void> {
    this.records.set(record.id, { ...record });
    this.blobs.set(record.id, blob);
  }

  async getRecord(id: string): Promise<PodRecord | null> {
    const r = this.records.get(id);
    return r ? { ...r } : null;
  }

  async getBlob(id: string): Promise<Buffer | null> {
    return this.blobs.get(id) ?? null;
  }

  async bumpHits(id: string): Promise<void> {
    const r = this.records.get(id);
    if (r) r.hits += 1;
  }

  /** Snapshot for diagnostics (not part of the Registry interface). */
  size(): number {
    return this.records.size;
  }
}

// ---------------------------------------------------------------------------
// SqliteRegistry — persistent. Records live in a SQLite table, blobs live
// on the filesystem under `<dataDir>/blobs/<id>.html`. Uses node:sqlite
// (Node 22+, built-in) so there's no native build step.
// ---------------------------------------------------------------------------

type SqliteDB = {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
};
type SqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
};

export interface SqliteRegistryOptions {
  /** Directory that holds `cloud.sqlite` + the `blobs/` subdirectory. */
  dataDir: string;
}

export class SqliteRegistry implements Registry {
  readonly name = "sqlite" as const;
  private db: SqliteDB | null = null;
  private readonly dataDir: string;
  private readonly blobDir: string;
  private readonly dbPath: string;

  constructor(opts: SqliteRegistryOptions) {
    this.dataDir = path.resolve(opts.dataDir);
    this.blobDir = path.join(this.dataDir, "blobs");
    this.dbPath = path.join(this.dataDir, "cloud.sqlite");
  }

  private async db_(): Promise<SqliteDB> {
    if (this.db) return this.db;
    await mkdir(this.blobDir, { recursive: true });
    // `node:sqlite` is built in to Node 22+. Importing lazily lets the
    // package load on older Node when only MemoryRegistry is used.
    const { DatabaseSync } = (await import("node:sqlite")) as {
      DatabaseSync: new (path: string) => SqliteDB;
    };
    const db = new DatabaseSync(this.dbPath);
    db.exec(
      `CREATE TABLE IF NOT EXISTS pods (
         id            TEXT PRIMARY KEY,
         name          TEXT NOT NULL,
         owner_pubkey  TEXT NOT NULL,
         manifest_size INTEGER NOT NULL,
         blob_size     INTEGER NOT NULL,
         created_at    TEXT NOT NULL,
         hits          INTEGER NOT NULL DEFAULT 0
       );
       CREATE INDEX IF NOT EXISTS pods_owner ON pods(owner_pubkey);`,
    );
    this.db = db;
    return db;
  }

  private blobPath(id: string): string {
    return path.join(this.blobDir, `${id}.html`);
  }

  async putPod(record: PodRecord, blob: Buffer): Promise<void> {
    const db = await this.db_();
    // Write the blob first; if SQLite insert later fails we'd leave a
    // dangling file, but the alternative (orphan row, no blob) breaks
    // serving. Dangling files are cleaned up on next deploy or by a janitor.
    await writeFile(this.blobPath(record.id), blob);
    db.prepare(
      `INSERT INTO pods
         (id, name, owner_pubkey, manifest_size, blob_size, created_at, hits)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.name,
      record.ownerPubkey,
      record.manifestSize,
      record.blobSize,
      record.createdAt,
      record.hits,
    );
  }

  async getRecord(id: string): Promise<PodRecord | null> {
    const db = await this.db_();
    const row = db.prepare(`SELECT * FROM pods WHERE id = ?`).get(id);
    if (!row) return null;
    return {
      id: row.id as string,
      name: row.name as string,
      ownerPubkey: row.owner_pubkey as string,
      manifestSize: Number(row.manifest_size),
      blobSize: Number(row.blob_size),
      createdAt: row.created_at as string,
      hits: Number(row.hits),
    };
  }

  async getBlob(id: string): Promise<Buffer | null> {
    try {
      return await readFile(this.blobPath(id));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async bumpHits(id: string): Promise<void> {
    const db = await this.db_();
    try {
      db.prepare(`UPDATE pods SET hits = hits + 1 WHERE id = ?`).run(id);
    } catch {
      // best-effort
    }
  }

  /** Delete a pod (record + blob). Not part of the Registry interface;
   *  exposed for admin/janitor use. */
  async deletePod(id: string): Promise<void> {
    const db = await this.db_();
    db.prepare(`DELETE FROM pods WHERE id = ?`).run(id);
    await unlink(this.blobPath(id)).catch(() => undefined);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }
}
