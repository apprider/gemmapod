# `@gemmapod/shim` (browser SDK)

The runtime that turns a pod manifest into a live chat widget. Preact UI +
WASM core + DARTC/WebRTC + fallback transports + the `boot()` entry that packed `.html`
blobs invoke.

This package is currently the browser SDK surface. The first
`GemmaPodRuntime` implementation now lives in `src/runtime/`, based on the
SDK spine documented in [`../../runtime.md`](../../runtime.md): typed event
bus, state store, capability registry, conversation identity, DARTC transport
ownership, and browser widget mounting.

Built as **two IIFEs** from the same source tree:

- **`dist/gemmapod-shim.iife.js`** — full capsule: Preact chat + WASM + `boot()` + signing helpers exposed from `entry.ts`.
- **`dist/gemmapod-runtime.iife.js`** — runtime-only: transport, `events`, `chat`, `mountPod({ ui: "none" })`, **no** Preact/`ChatWidget` (see `entry-runtime.ts`).

The WASM core is inlined as a `data:application/wasm;base64` URL inside each browser bundle. Packed `.html` blobs and turnkey sites use **only** the full shim so a single inlined `<script>` is enough.

## What's inside

- **`src/entry.ts`** — public surface for the **full** build: `createRuntime()`, `mount()`,
  `boot()`, `attachBrowserFallbackPrepare()`, `GemmaPodCore`, `initCore()`. Everything goes through
  `window.GemmaPod`.
- **`src/entry-runtime.ts`** — **runtime-only** IIFE: same `GemmaPod` helpers except **no** `boot` / signing; `mount()` does not render Preact — use **`mountPod(..., { ui: "none" })`** or your own UI.
- **`src/runtime/`** — `GemmaPodRuntime`: typed event bus, state store,
  capability registry, conversation persistence, transport connection,
  DARTC UI-event consumption, and chat API.
- **`src/index.ts`** — `mount(el, config)` for direct embedding (used by
  apps/web's live demo widget and the dev playgrounds). It renders the
  default widget and returns a `Promise<GemmaPodRuntime>`.
- **`src/boot.ts`** — reads `__GEMMAPOD_WASM_B64` + `__GEMMAPOD_MANIFEST_B64`
  globals, inits WASM, verifies the manifest, refuses to render on a
  failed signature, then **`mountPod(..., { fallbackUi: "default" })`** so packed blobs include the default WebGPU host UI when fallback is configured.
- **`src/core.ts`** — thin TypeScript wrapper over the WASM bindings.
- **`src/transports/`** — `direct` (HTTP to local Ollama),
  `webrtc` (DARTC v0.2 over a P2P data channel via the cloud signaling broker),
  `fallback` (in-browser Gemma 4 via transformers.js + WebGPU).
  `index.ts` walks a fixed order: `webrtc → fallback → direct`, using
  whichever blocks are present in the manifest. The `[transport].preferred`
  list in `pod.toml` is currently advisory only.
- **`src/ui.tsx`** — Preact chat widget only (rendezvous + transcript + composer). It does not render the in-browser model download / prepare flow.
- **`src/host/attachBrowserFallbackPrepare.ts`** — optional DOM helper for embedders: model picker, cache hint, explicit prepare/cancel. Pass a sibling element next to the pod mount, or build your own UI and call `FallbackTransport.prepare()` yourself.

Packed pods keep the verified signed manifest in memory and attach it to
the DARTC `dartc.hello` / `gemmapod.chat.request` payloads as
`signedManifestB64`. The owner origin verifies it again before exposing
any local tools to the model, so the browser shim does not get to invent
tool permissions at runtime.

The runtime creates a stable pod-scoped `conversationId` and stores it with
visible chat messages in `localStorage`. A page refresh still creates a new
WebRTC peer, but the next DARTC session carries the same `conversation_id`
so the origin daemon can attach that peer to the same logical conversation.

The shim understands signed `gemmapod.ui.event` envelopes and feeds them
into the runtime event bus. Browser embedders can subscribe through
`runtime.events.on("ui.event", ...)`; the WebGPU `FallbackTransport` emits
the same `DartcUiEvent` sequence locally and additionally republishes
each event as a browser `window.dispatchEvent("gemmapod:ui-event", ...)`
for compatibility with non-runtime hosts — so consumers see one stream
regardless of transport.

The runtime ingests UI events as follows:

- `STATE_SNAPSHOT` → `runtime.state.replace(snapshot)`
- `STATE_DELTA` → `runtime.state.apply(delta)` (RFC 6902)
- `MESSAGES_SNAPSHOT` → `runtime.chat.setHistory(messages)`
- `CUSTOM name="a2a.card"` → populates `runtime.a2a.card` and emits
  `a2a.card` on the bus

Use **`GemmaPod.mapDartcUiEventToAgUi(event)`** to adapt discriminators to
[AG-UI](https://docs.ag-ui.com/concepts/events) PascalCase `type` strings
(payload fields unchanged; unknown DARTC types map to `Raw`).

The shipped capability registry is a simple string set
(`has`/`list`/`grant`/`revoke`). Default grants: `storage.local`,
`transport.webrtc`, `transport.direct`, `transport.browser-fallback`; the
full shim additionally grants `ui.render` (the runtime-only build does not,
because it ships no Preact widget). See [`../../runtime.md`](../../runtime.md)
§10 for the roadmap.

## Runtime API

Recommended embed (chat + default WebGPU fallback host when `transport.fallback` is set):

```ts
const { runtime, destroy } = await window.GemmaPod.mountPod(el, config);
// await destroy() when unmounting
```

Headless (full or runtime IIFE):

```ts
const { runtime, destroy } = await window.GemmaPod.mountPod(null, config, {
  ui: "none",
  fallbackUi: "none", // or "default" + fallbackMountParent
});
```

Lower-level (chat only, **full shim**):

```ts
const runtime = await window.GemmaPod.mount(el, config);

runtime.events.on("ui.event", ({ event }) => {
  console.log(event.type, event);
});

runtime.events.on("state.changed", ({ state }) => {
  renderCustomState(state);
});

for await (const chunk of runtime.chat.stream("hello")) {
  console.log(chunk.delta);
}
```

For headless / custom UI without `mountPod`:

```ts
const runtime = window.GemmaPod.create(config);
// First chat.send/stream calls connect() for you
const text = await runtime.chat.send("hello");
```

## DARTC on the data channel

The WebRTC data channel label is `dartc.v0`. After the channel opens, the
shim:

1. Generates an ephemeral Ed25519 DARTC session key with the same WASM
   core used for manifest signing.
2. Sends a signed `dartc.hello` envelope with supported topics and the
   signed manifest plus the stable `conversation_id` when available.
3. Waits for the origin's signed `dartc.hello` so future origin frames can
   be verified.
4. Exchanges A2A-shaped Agent Cards on `a2a.discovery`.
5. Sends chat through signed `gemmapod.chat.request` envelopes carrying
   the same `conversation_id`, and accepts
   signed `gemmapod.chat.delta`, `gemmapod.chat.done`, and `dartc.error`
   responses.
6. Receives signed `gemmapod.ui.event` envelopes for run lifecycle,
   message, tool, state, activity, and custom UI updates, then dispatches
   them on `window` as `gemmapod:ui-event`.

There is no legacy `{t:"req"}` data-channel protocol.

## Transport selection (runtime)

1. Try `webrtc` if configured — opens WS to the signaling URL, exchanges
   SDP, waits for the data channel to open, then completes DARTC hello
   and A2A discovery.
2. On failure (`origin offline`, timeout, no WebGPU detected for fallback,
   etc.) drop to the next transport in fixed order: `fallback` (requires
   `navigator.gpu`), then `direct`.
3. `fallback` is returned **unprepared**; use **`mountPod`** (default host), **`attachBrowserFallbackPrepare`**, or your own UI calling `prepare()` on user gesture. Nothing auto-downloads —
   transformers.js (~3 MB) is fetched from jsDelivr at that moment, the
   model from Hugging Face on first use, both then cached in the browser.

The signaling socket stays open during setup so both sides can trickle ICE
candidates as they are discovered. That keeps the cloud service in the
rendezvous role while improving the odds of a direct P2P path.

## Run locally

```sh
pnpm --filter @gemmapod/shim build   # dist/gemmapod-shim.iife.js + dist/gemmapod-runtime.iife.js
pnpm dev:shim                  # http://localhost:5173

# Playgrounds:
#   /            — full transport chain (webrtc → fallback → direct)
#   /fallback.html — fallback-only host panel + pod chat shell
#   /selftest.html — exercises the WASM sign/verify/tamper round-trip
```

For the WebRTC playground to talk to a real model:

```sh
# in a second shell
pnpm dev:cloud                 # :8080 (signaling)
pnpm dev:origin                # connects to cloud, proxies to Ollama
ollama serve                   # if not already running
```

## Build

```sh
pnpm --filter @gemmapod/shim build
# dist/gemmapod-shim.iife.js  ≈ 350 KB
```

The pack CLI and apps/web both consume this bundle:

- `apps/web/scripts/copy-shim.mjs` copies it to `apps/web/public/vendor/`.
- `packages/pack/src/bundle.ts` reads it and inlines it into packed `.html`.

## No deploy

Library. Distributed as a `<script>`-droppable IIFE.
