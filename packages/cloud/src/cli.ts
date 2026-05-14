#!/usr/bin/env node
// `gemmapod-signal` — one-command launcher for the GemmaPod signaling
// broker and pod registry.
//
// Example flows:
//   npx @gemmapod/cloud                       # MemoryRegistry on :8080
//   npx @gemmapod/cloud --registry sqlite \
//                       --data-dir ./data \
//                       --port 8080
//
// For the Firebase-backed gemmapod.com deployment, see the private
// `apps/cloud-firebase` entry — it imports `createSignalServer` from this
// package and plugs in a custom Registry.

import { Command } from "commander";
import { MemoryRegistry, SqliteRegistry, type Registry } from "./registry.js";
import { createSignalServer } from "./server.js";

interface CliOptions {
  port: string;
  hostname: string;
  registry: "memory" | "sqlite";
  dataDir: string;
}

const program = new Command();
program
  .name("gemmapod-signal")
  .description("GemmaPod signaling broker + pod registry (self-host).")
  .option("-p, --port <port>", "HTTP port to listen on", String(process.env.PORT ?? 8080))
  .option("-H, --hostname <host>", "Bind hostname", process.env.HOST ?? "0.0.0.0")
  .option(
    "-r, --registry <kind>",
    "Pod registry backend: 'memory' (volatile) or 'sqlite' (persistent)",
    (process.env.GEMMAPOD_CLOUD_REGISTRY as "memory" | "sqlite" | undefined) ?? "memory",
  )
  .option(
    "-d, --data-dir <dir>",
    "Persistent data dir (sqlite registry only)",
    process.env.GEMMAPOD_CLOUD_DATA ?? "./gemmapod-cloud-data",
  );

program.parse(process.argv);
const opts = program.opts<CliOptions>();

const port = Number(opts.port);
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error(`[cloud] invalid --port: ${opts.port}`);
  process.exit(2);
}

let registry: Registry;
if (opts.registry === "memory") {
  registry = new MemoryRegistry();
  console.log("[cloud] registry: in-memory (state lost on restart)");
} else if (opts.registry === "sqlite") {
  registry = new SqliteRegistry({ dataDir: opts.dataDir });
  console.log(`[cloud] registry: sqlite at ${opts.dataDir}`);
} else {
  console.error(`[cloud] unknown --registry: ${opts.registry} (expected memory | sqlite)`);
  process.exit(2);
}

const server = createSignalServer({
  registry,
  port,
  hostname: opts.hostname,
});

function shutdown(signal: string): void {
  console.log(`[cloud] received ${signal}, shutting down`);
  server
    .close()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error("[cloud] shutdown error:", e);
      process.exit(1);
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
