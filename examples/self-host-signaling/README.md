# self-host-signaling

A complete GemmaPod signaling broker + pod registry in ~30 lines. No
Firebase, no managed services. Persistence is your choice
(`MemoryRegistry` here; `SqliteRegistry` for a single-box production
self-host; bring-your-own backend for S3/R2/Postgres etc).

## Run

```sh
pnpm install                  # from repo root (once)
pnpm --filter @gemmapod/example-self-host-signaling start
```

You should see:

```
[signal] HTTP listening on http://0.0.0.0:8080
[signal] try it out:
  GET  http://localhost:8080/health
  WS   ws://localhost:8080/signal     (origin + visitor sockets)
  POST http://localhost:8080/pods     (signed .html ingest)
```

## Hook a pod up to it

In another terminal, run your origin daemon against this broker:

```sh
SIGNAL_URL=ws://localhost:8080/signal \
POD_ID=my-pod \
pnpm --filter @gemmapod/origin start
```

Then build a pod whose `pod.toml` has `signal_url = "ws://localhost:8080/signal"`
and open it in a browser — the visitor will rendezvous through this broker
and chat directly with your origin over a WebRTC data channel.

## Upload a signed blob

```sh
curl -X POST -H 'Content-Type: text/html' \
  --data-binary @hello-pod.html \
  http://localhost:8080/pods
# => { "id": "abc123XYZ_-Q", "url": "http://localhost:8080/abc123XYZ_-Q", … }
```

Then anyone can open `http://localhost:8080/abc123XYZ_-Q` and chat with the
pod.

## Swap the storage backend

```ts
import { createSignalServer, SqliteRegistry } from "@gemmapod/cloud";

const registry = new SqliteRegistry({ dataDir: "./gemmapod-data" });
createSignalServer({ registry, port: 8080 });
```

To plug in anything else (S3, R2, Postgres, …), implement the four-method
`Registry` interface from `@gemmapod/cloud`. The broker never sees
unverified blobs — `createPod()` runs the Ed25519 signature check before
calling `registry.putPod()`.
