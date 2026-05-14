# Embedding cookbook

How to run GemmaPod in the browser: **packed blob** vs **hosted script**, and what “working” means for **WebRTC/DARTC** vs **in-browser fallback**.

## Modes at a glance

| Mode | Visitor needs | Who implements optional UI for local model download |
|------|----------------|-----------------------------------------------------|
| **Packed `.html`** | Open file or URL | Built-in: `GemmaPod.boot()` uses `mountPod` with default fallback host |
| **`<script>` embed** | Your page + config | Default: `GemmaPod.mountPod(el, config)` — or `ui: "none"` + custom UI — or `fallbackUi: "none"` + your own panel |
| **Headless / custom UI** | Your page + **`gemmapod-runtime.iife.js`** | No Preact chat; use `mountPod(null, config, { ui: "none", ... })` or `create()` + `chat` / `events` |
| **Primary chat (owner online)** | Origin daemon + P2P-friendly network | No extra UI |
| **Fallback (owner offline)** | WebGPU; large one-time model download | Default panel unless you opt out |

## 1. Packed blob (CLI)

1. `gemmapod init` — creates `pod.toml`, `.gitignore`, `embed-example.html`
2. `gemmapod keygen --out owner.key`
3. `gemmapod doctor pod.toml` — sanity-check transports
4. `gemmapod build pod.toml --key owner.key --out dist/agent.html`

The artifact runs **`GemmaPod.boot(document.getElementById("pod"))`**, which verifies the manifest, mounts the chat widget (`ui: "chat"`), and (**if** `transport.fallback` is set) inserts the **default** WebGPU prepare panel above the widget.

## 2. Hosted script (`@gemmapod/browser`)

Pin a version in production and prefer **Subresource Integrity** (see [packages/browser/README.md](../packages/browser/README.md)).

### Full shim (`gemmapod-shim.iife.js`)

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
  }).then(function (m) {
    window.addEventListener("pagehide", function () {
      m.destroy();
    });
  });
</script>
```

### Runtime-only IIFE (`gemmapod-runtime.iife.js`)

Smaller bundle **without** the Preact chat widget — use for React / Vue / CopilotKit-style hosts. Import **`@gemmapod/browser/runtime`** (resolves to `dist/gemmapod-runtime.iife.js`). `window.GemmaPod` includes **`create`**, **`mount`**, **`mountPod`**, **`attachBrowserFallbackPrepare`**, **`quickTransportStatus`**, **`mapDartcUiEventToAgUi`** — but **not** **`boot`** or signing (`initCore` / `GemmaPodCore` live in the full shim only).

```html
<script src="https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-runtime.iife.js"></script>
<script>
  GemmaPod.mountPod(null, config, {
    ui: "none",
    fallbackUi: "default",
    fallbackMountParent: document.body,
  }).then(function (m) {
    /* your UI: m.runtime.events, m.runtime.chat.stream, … */
  });
</script>
```

### One-call vs low-level

- **`mountPod(el, config, options?)`** — Default **`ui: "chat"`** mounts the Preact widget into **`el`**. Use **`ui: "none"`** for headless embeds (**`el`** may be **`null`** when chat UI is off). If **`transport.fallback`** exists, **default** is to add the same fallback host as packed blobs unless **`fallbackUi: "none"`**. With **`ui: "none"`** and **`fallbackUi: "default"`**, set **`fallbackMountParent`** (defaults to **`document.body`**) so the prepare panel has a DOM parent.
- **`mount(el, config)`** — Internally **`create` + `mount`**. With the **full** shim, renders chat into **`el`**; with the **runtime** shim, **`mount()`** is a no-op for Preact — prefer **`mountPod(..., { ui: "none" })`** or **`create()`** + your UI.

## 3. Observability (status + events)

```js
const status = GemmaPod.quickTransportStatus(runtime);
console.log(status.phase, status.transportName, status.detail);

runtime.events.on("transport.ready", (e) => console.log("ready", e.transport));
runtime.events.on("transport.fallback", (e) => console.warn("fell back", e.reason));
runtime.events.on("transport.updated", () => console.log("transport object changed"));
runtime.events.on("runtime.error", (e) => console.error(e.error));
runtime.events.on("chat.history", ({ messages }) => renderTranscript(messages));
runtime.events.on("state.changed", ({ state }) => renderState(state));
runtime.events.on("a2a.card", ({ card }) => renderAgentCard(card));

runtime.events.on("ui.event", ({ event }) => {
  const ag = GemmaPod.mapDartcUiEventToAgUi(event);
  console.log("AG-UI-shaped", ag.type, ag);
});
```

The same sequence is emitted whether chat runs over **WebRTC + origin** or **WebGPU fallback**: `RUN_STARTED` → `TEXT_MESSAGE_*` → `RUN_FINISHED` / `RUN_ERROR` (plus `TOOL_CALL_*`, `STATE_*`, `MESSAGES_SNAPSHOT`, `ACTIVITY_*`, `CUSTOM`, `RAW` when present). `STATE_SNAPSHOT`/`STATE_DELTA` are auto-routed into `runtime.state`; `MESSAGES_SNAPSHOT` is auto-routed into `runtime.chat`. Subscribe on the runtime; use [`mapDartcUiEventToAgUi`](../packages/shim/src/agUiMap.ts) only when your UI expects [AG-UI PascalCase event names](https://docs.ag-ui.com/concepts/events).

### Wire vs browser

- **Over DARTC**, the origin sends signed envelopes on topic `gemmapod.ui.event` with `payload.schema === "dartc.ui.event/0.1"` (see [@gemmapod/dartc](../packages/dartc/README.md)).
- **In the browser**, the shim verifies and unwraps these into `DartcUiEvent`, then **`runtime.events` emits `ui.event`** with the same payload shape (fallback synthesizes the matching lifecycle locally).

## 4. Next.js / React

Use **`mountPod`** with **`{ fallbackUi: "none" }`** when your layout already provides a fallback panel (see `apps/web`), to avoid duplicate download UI. Always call **`destroy()`** on the returned handle when unmounting the route.

## See also

- [runtime.md](../runtime.md) — `GemmaPodRuntime` model
- [SECURITY.md](../SECURITY.md) — signing and CSP notes
