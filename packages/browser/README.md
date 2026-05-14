# `@gemmapod/browser`

Two browser IIFEs:

| File | Use |
| --- | --- |
| **`dist/gemmapod-shim.iife.js`** (default export) | Packed-style turnkey: **`boot`**, signing helpers, Preact chat, **`mountPod`**. |
| **`dist/gemmapod-runtime.iife.js`** (`@gemmapod/browser/runtime`) | Smaller: transport + **`runtime.events`** + **`chat`**; **no** Preact widget, **no** **`boot`**. |

After the script loads, use **`window.GemmaPod`**.

Build this package from the monorepo (copies the shim build):

```bash
pnpm --filter @gemmapod/shim build
pnpm --filter @gemmapod/browser build
```

## Quick start (vanilla HTML)

```html
<div id="pod"></div>
<script src="https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-shim.iife.js"></script>
<script>
  GemmaPod.mountPod(document.getElementById("pod"), {
    name: "Demo",
    persona: "Helper",
    systemPrompt: "You are concise.",
    model: "gemma4:e4b",
    transport: {
      webrtc: { signalUrl: "wss://cloud.gemmapod.com/signal", podId: "my-pod" },
      fallback: { model: "onnx-community/gemma-4-E2B-it-ONNX" },
    },
  }).then(({ runtime, destroy }) => {
    window.addEventListener("pagehide", () => destroy());
  });
</script>
```

- **`mountPod(el, config, options?)`** — default `transport.fallback` panel is included when configured. Options: **`ui: "chat" | "none"`** (default `"chat"`), **`fallbackUi: "default" | "none" | HTMLElement`** (default `"default"` when fallback configured), **`fallbackPlacement: "before" | "after" | "prepend"`** (default `"before"`), **`fallbackMountParent`** (only used with `ui: "none"` + `fallbackUi: "default"`; defaults to `document.body`).
- **`mount(el, config)`** — **full shim:** Preact chat into **`el`** (returns the runtime). **Runtime IIFE:** no-op Preact mount that warns; prefer **`mountPod(..., { ui: "none" })`** or **`create()`**.
- **`create(config)`** — programmatic: returns a `GemmaPodRuntime` without mounting; first `chat.stream`/`send` will call `connect()` for you.
- **`boot(el)`** — **full shim only** — packed `.html` blobs from the `gemmapod` CLI (returns **`Promise<MountedPod | undefined>`** — `undefined` on a tampered manifest or missing globals).
- **`mapDartcUiEventToAgUi(event)`** — bridge from `runtime.events` `ui.event` payloads to [AG-UI](https://docs.ag-ui.com/concepts/events) PascalCase `type` strings (same fields; unknown DARTC types map to `Raw`).
- **`quickTransportStatus(runtime)`** — compact `{ phase, transportName, detail }` snapshot for status badges.
- **`attachBrowserFallbackPrepare(el, runtime)`** — DOM helper that renders the model picker / cache hint / explicit prepare/cancel UX for the WebGPU fallback. `mountPod`'s `fallbackUi: "default"` path uses it internally.

The `runtime` returned from `mountPod` / `mount` / `create` exposes a typed event bus, state store, capability registry, and chat API — see [`../../runtime.md`](../../runtime.md). Minimum useful subscriptions:

```js
runtime.events.on("transport.ready", (e) => console.log("ready via", e.transport));
runtime.events.on("transport.fallback", (e) => console.warn("fell back:", e.reason));
runtime.events.on("ui.event", ({ event }) => projectEvent(event));
runtime.events.on("a2a.card", ({ card }) => renderAgentCard(card));
runtime.events.on("state.changed", ({ state }) => renderCart(state));
```

## TypeScript

```bash
npm add -D @gemmapod/browser
```

```ts
/// <reference types="@gemmapod/browser/dist/gemmapod-browser" />
```

Or copy [`dist/gemmapod-browser.d.ts`](./dist/gemmapod-browser.d.ts) into your project.

## Subresource Integrity (production)

After choosing a pinned version, compute SHA-384 of the file you serve:

```bash
curl -fsSL "https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-shim.iife.js" \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Then:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-shim.iife.js"
  integrity="sha384-PASTE_HASH_HERE"
  crossorigin="anonymous"
></script>
```

## See also

- [Embedding cookbook](../../docs/EMBEDDING.md) in this repo (packed blob vs script tag, WebRTC vs fallback).
- [runtime.md](../../runtime.md) for the `GemmaPodRuntime` model.
