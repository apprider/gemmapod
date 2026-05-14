// Registry contract test — runs against both shipped implementations.
//
// We exercise the read/write/bump path with a synthetic record so the test
// doesn't depend on @gemmapod/core or a real signed manifest. The
// signed-blob path (createPod) is covered by the end-to-end CLI smoke in CI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  MemoryRegistry,
  SqliteRegistry,
  type PodRecord,
  type Registry,
} from "../src/registry.js";

function syntheticRecord(id: string): PodRecord {
  return {
    id,
    name: "test-pod",
    ownerPubkey: "ab".repeat(32),
    manifestSize: 1234,
    blobSize: 9999,
    createdAt: new Date("2026-05-15T00:00:00Z").toISOString(),
    hits: 0,
  };
}

async function withRegistry(name: string, build: () => Promise<Registry>) {
  await test(`${name}: putPod + getRecord + getBlob round-trip`, async () => {
    const reg = await build();
    const rec = syntheticRecord("abcDEF123_-X");
    const blob = Buffer.from("<html>hello</html>");
    await reg.putPod(rec, blob);

    const read = await reg.getRecord(rec.id);
    assert.deepEqual(read, rec);

    const fetched = await reg.getBlob(rec.id);
    assert.ok(fetched && fetched.equals(blob));

    const missing = await reg.getRecord("missingxxxxxxx");
    assert.equal(missing, null);

    await reg.close?.();
  });

  await test(`${name}: bumpHits increments`, async () => {
    const reg = await build();
    const rec = syntheticRecord("hitsXYZ12345");
    await reg.putPod(rec, Buffer.from("x"));
    await reg.bumpHits(rec.id);
    await reg.bumpHits(rec.id);
    const after = await reg.getRecord(rec.id);
    assert.equal(after?.hits, 2);
    await reg.close?.();
  });
}

await withRegistry("MemoryRegistry", async () => new MemoryRegistry());
await withRegistry("SqliteRegistry", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "gemmapod-cloud-test-"));
  const reg = new SqliteRegistry({ dataDir });
  // Clean up the temp dir after the test process exits.
  process.on("exit", () => void rm(dataDir, { recursive: true, force: true }));
  return reg;
});
