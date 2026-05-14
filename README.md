# GemmaPod

> Composable, portable AI agent capsules. Bundle an agent's identity,
> persona, tools, and transport into a single signed HTML+JS+WASM file
> (~960 KB) that you can email, embed, or deploy.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm: @gemmapod/browser](https://img.shields.io/npm/v/@gemmapod/browser?label=%40gemmapod%2Fbrowser)](https://www.npmjs.com/package/@gemmapod/browser)
[![Docs](https://img.shields.io/badge/docs-docs.gemmapod.com-58a6ff)](https://docs.gemmapod.com)

**Docs**: <https://docs.gemmapod.com> ·
**Live demo**: <https://gemmapod.com> ·
**Discussions**: <https://github.com/apprider/gemmapod/discussions>

```
┌──────────────────────────────────────────────────────────────────┐
│  POD BLOB  (one .html, ~960 KB)                                  │
│   ├─ signed manifest  (Ed25519 over CBOR)                        │
│   ├─ WASM core        (Rust: sig verify + DARTC signing)         │
│   └─ shim             (Preact UI + runtime + transports)         │
└──────────┬─────────────────────────────────────┬─────────────────┘
   DARTC   │ over WebRTC (primary)    transformers.js │ (fallback)
           ▼                                          ▼
   ┌──────────────────┐                     ┌──────────────────┐
   │ origin daemon    │                     │ Gemma 4 E2B in   │
   │ (owner's box)    │                     │ visitor's browser│
   │  → Ollama        │                     │ (WebGPU, q4)     │
   │  → Gemma 4 E4B   │                     └──────────────────┘
   └──────────┬───────┘
              │ persistent WSS
              ▼
   ┌──────────────────────────────────────────────────┐
   │ @gemmapod/cloud  (signaling broker + registry)   │
   │  • WS  /signal     SDP rendezvous only           │
   │  • POST /pods      upload signed blob            │
   │  • GET  /:id       serve via configured Registry │
   └──────────────────────────────────────────────────┘
```

## What's in this repo

| path                    | what                                                                                          |
|-------------------------|-----------------------------------------------------------------------------------------------|
| [`packages/dartc/`](packages/dartc/README.md)     | `@gemmapod/dartc` — DARTC v0.2 envelope, topic helpers, AG-UI-shaped UI events.    |
| [`packages/core/`](packages/core/README.md)       | `@gemmapod/core` — Rust → WASM. Signed manifest (CBOR + Ed25519). Web + Node.       |
| [`packages/shim/`](packages/shim/README.md)       | `@gemmapod/shim` — Browser runtime + Preact widget. Two IIFEs from one source.      |
| [`packages/browser/`](packages/browser/README.md) | `@gemmapod/browser` — npm/CDN wrapper around the two shim IIFEs.                    |
| [`packages/pack/`](packages/pack/README.md)       | `@gemmapod/pack` — `gemmapod` CLI: `init` / `keygen` / `doctor` / `build`.           |
| [`packages/origin/`](packages/origin/README.md)   | `@gemmapod/origin` — Owner-side daemon. WebRTC + Ollama proxy + signed tool registry. |
| [`packages/cloud/`](packages/cloud/README.md)     | `@gemmapod/cloud` — Signaling broker + pluggable `Registry` interface.              |
| [`apps/docs/`](apps/docs/README.md)               | Fumadocs site → docs.gemmapod.com.                                                  |
| [`examples/`](examples/README.md)                 | hello-pod, script-tag-embed, nextjs-embed, react-headless, copilotkit-style, restaurant-pod, origin-daemon-minimal, self-host-signaling, raj-card. |
| [`dartc.md`](dartc.md)                            | DARTC protocol spec (canonical).                                                    |
| [`runtime.md`](runtime.md)                        | GemmaPodRuntime SDK spec (canonical).                                                |
| [`SECURITY.md`](SECURITY.md)                      | Threat model + vulnerability reporting flow.                                        |

## Install

```sh
# script-tag embed (CDN)
<script src="https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-shim.iife.js"></script>

# Or from npm
npm i @gemmapod/browser     # browser SDK
npm i -D @gemmapod/pack     # `gemmapod` CLI

# Owner daemon + signaling broker
docker run ghcr.io/apprider/gemmapod-origin
docker run ghcr.io/apprider/gemmapod-cloud
```

[Full install guide →](https://docs.gemmapod.com/docs/quickstart/install)

## 60-second hello world

```sh
pnpm dlx @gemmapod/pack init  --dir ./my-pod
pnpm dlx @gemmapod/pack keygen --out  ./my-pod/owner.key
pnpm dlx @gemmapod/pack build  ./my-pod/pod.toml --key ./my-pod/owner.key --out ./my-pod/agent.html
open ./my-pod/agent.html
```

That's a signed `.html` agent capsule, ready to email or embed.

[Full quickstart →](https://docs.gemmapod.com/docs/quickstart/first-pod-cli)

## Build from source

Requires Node 22+, pnpm 9+. Rust toolchain only if rebuilding the WASM
core (committed `packages/core/pkg{,-node}/` artefacts work otherwise).

```sh
pnpm install
pnpm build:core               # rebuilds @gemmapod/core (Rust → WASM)
pnpm -r --filter "./packages/*" build
pnpm test                     # runs @gemmapod/dartc + @gemmapod/cloud tests
```

Run the docs locally:

```sh
pnpm dev:docs                 # http://localhost:3002
```

## The Gemma 4 lineup, used intentionally

| Variant            | Where it runs                                    | Why                                                                |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------ |
| Gemma 4 E2B        | Visitor's browser via transformers.js + WebGPU   | ~1 GB at q4. Fallback when origin is offline.                       |
| Gemma 4 E4B        | Owner's machine via Ollama                       | Primary path over a WebRTC data channel.                            |
| Gemma 4 31B Dense  | Same Ollama endpoint, opt-in per request         | "Heavy mode" for deeper reasoning.                                  |
| Gemma 4 26B MoE    | Optional sidecar                                 | High-throughput planning / RAG / batch tools.                       |

## Cross-cutting design decisions

- **Same Rust code signs and verifies everywhere.** `@gemmapod/core`
  builds twice: `pkg/` for browsers (and the shim's IIFE), `pkg-node/`
  for the CLI and the cloud — so the on-wire signed manifest format
  cannot diverge between encoder and decoder.
- **The WASM is inlined inside the shim IIFE** as a `data:` URL.
  Packed pods and the live widget run literally the same WASM module.
- **Cloud carries SDP only.** Chat bytes flow over the WebRTC data
  channel directly between visitor and owner origin. The cloud is a
  thin rendezvous + a static-blob proxy.
- **DARTC is the data-channel protocol.** Signed JSON envelopes,
  topic-multiplexed. A2A Agent Cards exchanged on `a2a.discovery`; chat
  on signed `gemmapod.chat.*`; UI events on `gemmapod.ui.event`.
- **GemmaPodRuntime is the SDK spine.** Typed event bus + state store +
  capability registry + chat API. The default Preact widget is one
  adapter; CopilotKit-shaped React shells are another.
- **Two IIFE builds from one source.** `gemmapod-shim.iife.js` (full —
  runtime + Preact widget + boot + signing). `gemmapod-runtime.iife.js`
  (runtime + transports only, for bring-your-own-UI hosts).
- **AG-UI-compatible UI events.** Signed `gemmapod.ui.event` envelopes
  carry an AG-UI-shaped lifecycle. Field names match;
  `GemmaPod.mapDartcUiEventToAgUi(event)` rewrites the discriminator
  for CopilotKit-shaped UIs.
- **Manifest signature is enforced before mount.** A tampered blob
  surfaces a visible "gemmapod refused to mount" instead of a silently
  altered persona.
- **Tools are signed and origin-enforced.** Packed pods carry the
  signed manifest inside DARTC hello/chat payloads. The origin daemon
  verifies it again and exposes only locally-registered tools whose
  names appear in the signed manifest.
- **Pluggable signaling backend.** `@gemmapod/cloud`'s `Registry`
  interface is four methods. `MemoryRegistry` + `SqliteRegistry` ship.
  Bring your own for S3 / R2 / Postgres / Firestore / whatever.
- **The fallback never auto-downloads.** When WebRTC fails and the
  fallback transport is configured, the UI renders a panel showing
  cache state and WebGPU availability; the user clicks once to fetch
  transformers.js + the model.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: open an
issue → branch → add a changeset (`pnpm changeset`) for any change that
affects a published package → open the PR. CI runs build, dartc + cloud
tests, `npm pack` dry-runs, and an end-to-end CLI smoke.

## License

MIT — see [`LICENSE`](./LICENSE).
