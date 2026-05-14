# `@gemmapod/cloud`

> Reference signaling broker + pod registry for GemmaPod. One npm package.
> One Hono process. Pluggable storage via a small `Registry` interface.

Why this exists: a GemmaPod pod is a portable HTML blob that phones home
over WebRTC. For that to work, **something** has to broker the SDP
exchange between the visitor and the owner's machine. This package is the
reference implementation — runnable as one command, swappable for any
storage backend you want.

## Install

```sh
pnpm add @gemmapod/cloud
# or run with no install:
npx @gemmapod/cloud
```

## Run it

In-memory (zero config, state lost on restart — perfect for dev):

```sh
npx @gemmapod/cloud
# [cloud] registry: in-memory (state lost on restart)
# [cloud] HTTP listening on http://0.0.0.0:8080
```

Persistent SQLite + filesystem blobs:

```sh
npx @gemmapod/cloud --registry sqlite --data-dir ./gemmapod-data --port 8080
```

Then point an origin daemon at it:

```sh
SIGNAL_URL=ws://localhost:8080/signal POD_ID=my-pod \
  npx @gemmapod/origin
```

…and a packed pod whose manifest's `[transport.webrtc] signal_url` matches.

### Docker

```sh
docker run --rm -p 8080:8080 \
  -v $(pwd)/gemmapod-data:/data \
  ghcr.io/apprider/gemmapod-cloud:latest \
  --registry sqlite --data-dir /data
```

## What it does

| Route                                | Purpose                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `GET  /health`                       | Liveness + currently-registered origins + active sessions |
| `WS   /signal`                       | Signaling broker (origins register, visitors negotiate)   |
| `POST /pods`                         | Verify a signed `.html` blob, store it, return public URL |
| `GET  /:id`                          | Serve the signed pod blob with CSP + counters             |
| `GET  /:id/meta`                     | JSON record (no blob bytes)                               |

Chat envelopes never traverse this broker. Once a WebRTC data channel
opens, the conversation is peer-to-peer signed DARTC — see
[`@gemmapod/dartc`](../dartc/README.md).

## Programmatic use

```ts
import {
  createSignalServer,
  MemoryRegistry,
  SqliteRegistry,
} from "@gemmapod/cloud";

const registry = new SqliteRegistry({ dataDir: "./data" });
const server = createSignalServer({ registry, port: 8080 });

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});
```

## Plug in your own storage

Implement `Registry` and pass it to `createSignalServer({ registry })`.
The interface is intentionally tiny — four methods + optional `close`:

```ts
interface Registry {
  putPod(record: PodRecord, blob: Buffer): Promise<void>;
  getRecord(id: string): Promise<PodRecord | null>;
  getBlob(id: string): Promise<Buffer | null>;
  bumpHits(id: string): Promise<void>;
  close?(): Promise<void>;
}
```

Backends only ever see records and blobs the cloud has **already
verified**. `createPod()` extracts the inlined signed manifest, verifies
it against the Rust/WASM core, generates a 12-char URL-safe id, and only
then hands the record off to `putPod`.

Reference implementations:

| Class             | Persistence            | When to use                                   |
| ----------------- | ---------------------- | --------------------------------------------- |
| `MemoryRegistry`  | None                   | Tests, demos, ephemeral self-host             |
| `SqliteRegistry`  | `node:sqlite` + files  | Single-box production self-host               |
| Custom            | Anything (S3 / R2 / …) | Bring-your-own infra (see `Registry` interface) |

The gemmapod.com production deployment runs a private `FirebaseRegistry`
(Firestore + Cloud Storage) that satisfies the same interface — the
broker code never sees Firebase.

## Security headers

Every served pod blob ships with a strict CSP, `nosniff`,
`Referrer-Policy`, and a tight `Permissions-Policy`. Override via
`createSignalServer({ podHeaderOptions })` when self-hosting under a
different model-CDN allow-list. The defaults are tuned for the public
gemmapod.com fallback path (jsDelivr for `transformers.js`, Hugging Face
for model files).

## Status

`v0.1` of the public API. The `Registry` interface and `SignalMsg`
protocol are the surfaces we'll treat with semver care; everything else
is implementation detail.

License: MIT.
