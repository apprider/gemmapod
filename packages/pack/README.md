# `@gemmapod/pack` (CLI)

`gemmapod` — turn a `pod.toml` manifest and an owner key into a single
self-contained `.html` blob.

Signs through the same Rust core the browser verifies with
(`packages/core/pkg-node`), so encoder/decoder mismatch is impossible by
construction. The build step does a round-trip verify before emitting the
artifact.

## Commands

```sh
# New project: pod.toml, .gitignore, embed-example.html
gemmapod init --dir ./my-agent

# generate a fresh Ed25519 keypair (0600 JSON file)
gemmapod keygen --out owner.key

# validate pod.toml before building
gemmapod doctor path/to/pod.toml

# package a pod
gemmapod build path/to/pod.toml \
  --key  path/to/owner.key \
  --out  dist/my-pod.html
```

See also **[`../../docs/EMBEDDING.md`](../../docs/EMBEDDING.md)** for script-tag embeds and **`@gemmapod/browser`**.

Output is ~650 KB:

- ~350 KB inlined shim IIFE
- ~305 KB base64-inlined WASM (228 KB raw)
- ~3 KB CBOR signed manifest
- HTML chrome

The resulting pod speaks DARTC v0.2 over its WebRTC data channel. At
runtime it sends signed `dartc.hello` and `gemmapod.chat.request`
envelopes, receives signed streaming responses, and exchanges A2A-shaped
Agent Cards on `a2a.discovery`. Packed pods boot via `GemmaPod.boot()`
into a full `GemmaPodRuntime` (typed event bus, state store, chat API,
A2A discovery, capability registry) and mount the default Preact widget;
embedders can subscribe to `runtime.events` instead of the default UI.
Future CLI / server / worker adapters reuse the same runtime contract —
see [`../../runtime.md`](../../runtime.md).

## `pod.toml` schema

```toml
name = "my-pod"                  # required; also the default id
persona = "AI business card"
model = "gemma4:e4b"

system_prompt = """
You are…
"""

[transport]
preferred = ["webrtc", "fallback"]    # informational today (see note)

[transport.webrtc]
signal_url = "https://…/signal"
pod_id = "my-pod"

[transport.fallback]
tier = "e2b"

[[tools]]
name = "share_contact"
description = "…"
```

Note: `owner_pubkey` is **not** written in `pod.toml`. The CLI fills it in
from the `--key` file's `publicKey`, so the manifest can't drift from
the signing identity.

> **`[transport].preferred` is currently advisory.** The browser shim's
> selector uses a fixed order — `webrtc → fallback → direct` — and uses
> whichever transport blocks are present in the manifest. Wire-up to a
> real preference order is tracked under the runtime roadmap
> (see [`../../runtime.md`](../../runtime.md) §13).

The signed manifest is also the authority DARTC sessions carry back to
the origin daemon. The origin re-verifies it before using the signed
system prompt or exposing signed tools.

## Run locally

```sh
# build the shim first (one-time / on shim change)
pnpm --filter @gemmapod/shim build

# from anywhere (the bin is wired through pnpm)
pnpm --filter @gemmapod/pack exec tsx src/cli.ts keygen \
  --out /absolute/path/owner.key

pnpm --filter @gemmapod/pack exec tsx src/cli.ts build \
  /absolute/path/pod.toml \
  --key /absolute/path/owner.key \
  --out /absolute/path/out.html
```

(Absolute paths because `pnpm --filter` changes cwd to the package.)

For convenience, an example pod lives at `examples/raj-card/pod.toml`.

## No deploy

CLI. Run wherever you build pods.
