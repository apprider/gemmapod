// Self-host a GemmaPod signaling broker + pod registry. ~30 lines.
//
// Run:  pnpm start
// Test: curl http://localhost:8080/health
//
// Persistence: this example uses MemoryRegistry, which loses state on
// restart. For a single-box production self-host, swap to SqliteRegistry
// — see commented block below.

import { createSignalServer, MemoryRegistry /*, SqliteRegistry */ } from "@gemmapod/cloud";

const PORT = Number(process.env.PORT ?? 8080);

const registry = new MemoryRegistry();
// const registry = new SqliteRegistry({ dataDir: "./data" });

const server = createSignalServer({
  registry,
  port: PORT,
  hostname: "0.0.0.0",
  onOriginRegistered: (podId) => console.log(`[signal] origin ↑ ${podId}`),
  onOriginDisconnected: (podId) => console.log(`[signal] origin ↓ ${podId}`),
});

console.log(`
[signal] try it out:
  GET  http://localhost:${PORT}/health
  WS   ws://localhost:${PORT}/signal     (origin + visitor sockets)
  POST http://localhost:${PORT}/pods     (signed .html ingest)
`);

const shutdown = (signal: string): void => {
  console.log(`[signal] ${signal} — shutting down`);
  server
    .close()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
