# GemmaPodRuntime SDK

Status: Browser runtime shipped (two IIFEs + npm `@gemmapod/browser`). CLI / server / worker adapters are next-phase.
Date: May 14, 2026
Audience: pod authors, SDK users, embed developers, runtime implementers

## 1. Goal

`GemmaPodRuntime` is the spine of GemmaPod. A pod should be the same signed
agent capsule whether it is opened as an HTML blob, embedded in a website,
mounted into a React/CopilotKit-style app shell, run from a terminal, or
hosted as a cloud endpoint.

The runtime provides one stable SDK surface around:

- signed manifest verification (browser only today)
- DARTC session setup and signed topic routing
- A2A Agent Card discovery
- conversation continuity
- UI/runtime event streaming (DARTC `gemmapod.ui.event`)
- capability registry
- environment-specific adapters

The pod remains portable. The host environment decides which capabilities are
available, what UI to render, and where to put download/prepare UX.

```txt
signed pod manifest + WASM core
  -> GemmaPodRuntime
  -> DARTC transport session
  -> owner origin daemon / browser fallback / direct endpoint
  -> environment adapter: browser UI, CopilotKit-style shell, terminal, cloud
```

## 2. Distribution Today

The browser runtime ships as **two IIFEs built from one source tree**
(`packages/shim`) and is republished as the npm package
**`@gemmapod/browser`**. Both files expose the same `window.GemmaPod` global;
they differ in what they bundle.

| File | Bundles | `window.GemmaPod` surface |
| --- | --- | --- |
| `dist/gemmapod-shim.iife.js` (full) | Runtime + Preact chat widget + WASM core (inlined) + `boot` + signing helpers | `create`, `mount`, `mountPod`, `boot`, `attachBrowserFallbackPrepare`, `quickTransportStatus`, `mapDartcUiEventToAgUi`, `initCore`, `GemmaPodCore`, `wasmInit` |
| `dist/gemmapod-runtime.iife.js` (runtime-only) | Runtime + transports only (no Preact, no `boot`, no signing) | `create`, `mount`, `mountPod`, `attachBrowserFallbackPrepare`, `quickTransportStatus`, `mapDartcUiEventToAgUi` |

Rules:

- Packed `.html` pods always use the **full** shim — they need `boot` and the
  in-memory verification path.
- Apps that bring their own UI (React/Vue/CopilotKit hosts, custom chat
  shells) should prefer the **runtime-only** IIFE. `mount()` in that build is
  a no-op for chat (and warns); use `mountPod(..., { ui: "none" })` or
  `create()` plus `runtime.events` / `runtime.chat`.
- npm consumers reference `@gemmapod/browser` (full) or
  `@gemmapod/browser/runtime` (runtime-only).

## 3. Runtime Object

The SDK exposes a runtime handle. The chat widget is one optional adapter
over that runtime, not the primary surface.

```ts
type GemmaPodMountTarget = HTMLElement | null;

interface GemmaPodRuntime {
  readonly id: string;
  readonly podId: string;
  readonly conversationId: string;
  readonly manifest: PodConfig;            // the resolved config the runtime is using
  readonly transport: RuntimeTransportState;
  readonly capabilities: RuntimeCapabilityRegistry;
  readonly events: RuntimeEventBus;
  readonly state: RuntimeStateStore;
  readonly chat: RuntimeChatApi;
  readonly a2a: RuntimeA2AApi;             // populated after `a2a.card` arrives

  connect(): Promise<void>;
  mount(target: GemmaPodMountTarget): Promise<void>;
  destroy(): Promise<void>;
  getTransport(): Transport | null;
}
```

`mount()` renders the default Preact chat widget into `target` when the full
shim is in use; the runtime-only build's `mount()` is a no-op (it warns once
and leaves the host to wire its own UI to `events`/`chat`).
`connect()` is callable from headless flows; chat APIs auto-connect on first
use.

### `manifest` vs. a verified-manifest type

In the browser runtime, `manifest` is the resolved `PodConfig` the runtime
operates on. Packed pods construct that config from a *verified* signed
manifest (`boot.ts` calls `GemmaPodCore.verifyManifest` before constructing
the runtime — verification fails closed with a visible error). Embedders
that call `mountPod`/`create` directly are responsible for any pre-mount
verification they want; the resulting `manifest` is whatever they supplied.
A formal `VerifiedPodManifest` type remains future work for CLI/server
adapters that don't share the browser's boot path.

## 4. Public Entry Points

Browser (one-call embed — chat + WebGPU fallback panel together):

```ts
const { runtime, destroy } = await GemmaPod.mountPod(el, config);
// runtime.events.on("ui.event", ...) etc.
// await destroy() when unmounting
```

Headless (no Preact chat; host renders its own composer / transcript):

```ts
const { runtime, destroy } = await GemmaPod.mountPod(null, config, {
  ui: "none",
  fallbackUi: "default",            // optional auto-host
  fallbackMountParent: document.body,
});
```

Lower-level (chat only; you wire `attachBrowserFallbackPrepare` separately
if you want a fallback host):

```ts
const runtime = await GemmaPod.mount(el, config);
```

Object-style (full programmatic control; common from CopilotKit-shaped apps):

```ts
const runtime = GemmaPod.create(config);
await runtime.connect();
for await (const chunk of runtime.chat.stream("hello")) {
  process.stdout.write(chunk.delta);
}
```

Packed HTML boot (full shim only; verification + `mountPod` with default
fallback host):

```ts
const mounted = await GemmaPod.boot(el);
const runtime = mounted?.runtime;
```

### `mountPod` options

```ts
interface MountPodOptions {
  ui?: "chat" | "none";                         // default: "chat"
  fallbackUi?: "default" | "none" | HTMLElement; // default: "default" if config.transport.fallback is set
  fallbackPlacement?: "before" | "after" | "prepend"; // default: "before"
  fallbackMountParent?: HTMLElement;            // for ui:'none' + fallbackUi:'default'
}
```

Behavior:

- `ui: "chat"` requires `el` (TypeError otherwise).
- `ui: "none"` is the headless contract; `el` may be `null`.
- `fallbackUi: "default"` builds a panel through `attachBrowserFallbackPrepare`
  and places it relative to `el` (when chat UI is mounted) or under
  `fallbackMountParent` (when headless).
- `fallbackUi: HTMLElement` skips the auto-placement and treats your node as
  the host directly.
- `fallbackUi: "none"` keeps the runtime headless on the fallback side too —
  do this when your app already renders its own prepare/download UX (see
  `apps/web` hero menu).

## 5. Layering

The browser `CustomEvent` bridge is an outer integration hook, not the core
spine.

```txt
DARTC signed frames
  -> transport adapter (webrtc / fallback / direct)
  -> verifier + router
  -> RuntimeEventBus
  -> RuntimeStateStore / chat history / capability registry
  -> default UI (full shim) / custom UI (runtime-only) / host bridge
  -> optional `window.dispatchEvent("gemmapod:ui-event")`
```

This matches how serious client runtimes work: typed internal model +
event bus first, public host bridge second.

## 6. Runtime Event Bus

The event bus is typed and local to the runtime instance.

```ts
interface RuntimeEventBus {
  on<T extends RuntimeEvent["type"]>(
    type: T,
    handler: (event: Extract<RuntimeEvent, { type: T }>) => void,
  ): () => void;

  once<T extends RuntimeEvent["type"]>(
    type: T,
    handler: (event: Extract<RuntimeEvent, { type: T }>) => void,
  ): () => void;

  emit(event: RuntimeEvent): void;
}
```

Shipped event surface (`packages/shim/src/runtime/events.ts`):

| `type` | When |
| --- | --- |
| `runtime.ready` | After `connect()` succeeds and a transport is bridged. |
| `runtime.destroyed` | After `destroy()`. |
| `runtime.error` | Any runtime-level error (transport failure, UI event ingestion crash). |
| `transport.connecting` | Connection attempt started (`transport` is `"auto"` for the multi-transport selector). |
| `transport.ready` | A transport opened and is ready to chat. |
| `transport.updated` | Internal transport object mutated (e.g. fallback `state` flipped) — UIs poll-driven before this can rerender on a single event. |
| `transport.fallback` | Selector fell through from `from` to `to` (e.g. `webrtc` → `fallback`). |
| `transport.webrtc` | Stage events from the WebRTC connection ladder (signaling open, hello, etc.). |
| `a2a.card` | A2A Agent Card discovered (over `a2a.discovery` or via `CUSTOM name="a2a.card"`). |
| `ui.event` | A verified `DartcUiEvent` (run lifecycle, text message, tool call, state, activity, custom, raw). |
| `chat.history` | History changed (after `stream`/`send`/`clear`/`setHistory`/`MESSAGES_SNAPSHOT`). |
| `state.changed` | The state store emitted a new snapshot. |

Optional browser compatibility hook (the WebGPU fallback transport
republishes its own UI events as `window` events automatically; embedders
can wire the same bridge for WebRTC):

```ts
runtime.events.on("ui.event", ({ event }) => {
  window.dispatchEvent(new CustomEvent("gemmapod:ui-event", { detail: event }));
});
```

The same `DartcUiEvent` lifecycle is emitted regardless of which transport
is active (WebRTC + origin **or** WebGPU fallback): `RUN_STARTED` →
`TEXT_MESSAGE_*` → `RUN_FINISHED` / `RUN_ERROR`, with tool, state, activity,
custom, and messages-snapshot events interleaved.

### AG-UI bridge

`runtime.events.on("ui.event", ...)` payloads use SCREAMING_SNAKE `type`
strings (`TEXT_MESSAGE_CONTENT`, `STATE_DELTA`, …) with payload fields named
to match [AG-UI](https://docs.ag-ui.com/concepts/events). For hosts that
expect the AG-UI PascalCase discriminator (`TextMessageContent`,
`StateDelta`, …), call `GemmaPod.mapDartcUiEventToAgUi(event)`. Payload
fields are unchanged; only the `type` is rewritten. Unknown DARTC types fall
back to `Raw`.

## 7. Chat API

The chat API is environment-neutral.

```ts
interface RuntimeChatApi {
  stream(input: string | RuntimeChatInput): AsyncIterable<ChatChunk>;
  send(input: string | RuntimeChatInput): Promise<string>;     // resolves to assembled assistant text
  history(): ChatMessage[];
  setHistory(messages: ChatMessage[]): void;                    // also fired by MESSAGES_SNAPSHOT
  clear(): Promise<void>;
}

interface RuntimeChatInput {
  messages?: ChatMessage[];
  text?: string;
  model?: string;
  conversationId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}
```

- String input is a convenience: it appends `{ role: "user", content: input }`
  to the current history and streams the reply.
- The runtime auto-connects on first `stream`/`send`.
- `send` returns the full assistant text once the stream finishes (no
  separate `ChatResult` object today — the streamed chunks carry the same
  data via `ui.event`).

The default Preact widget, the home-page headless composer, and the
CopilotKit-style demo all use the same `chat` API.

## 8. Conversation Model

Identity layers:

| field | lifetime | purpose |
| --- | --- | --- |
| `connectionId` | one transport connection | WebRTC/socket attempt |
| `sessionKey` | one DARTC session | ephemeral message signing |
| `conversationId` / `threadId` | durable logical chat | refresh continuity |
| `runId` | one model/tool execution | streaming and tracing |
| `messageId` | one rendered message/activity | UI reconciliation |

The browser runtime stores `conversationId` plus the visible messages in
`localStorage` under `gemmapod:<podId>:conversation:v1`. A page refresh
creates a fresh WebRTC peer and a new ephemeral DARTC session key, but the
runtime sends the stored `conversationId` in `dartc.hello` and
`gemmapod.chat.request` so the origin reattaches to the existing thread.

The origin daemon persists conversation memory in SQLite keyed by
`podId + conversation_id` (default `~/.gemmapod/origin.sqlite`,
override with `GEMMAPOD_ORIGIN_DB`). Browser refresh continuity and daemon
restart continuity are intentionally separate from short-lived WebRTC peers.

## 9. State Store

AG-UI's strongest idea is snapshot/delta state. GemmaPod uses that inside
DARTC, not as a replacement for DARTC.

```ts
interface RuntimeStateStore {
  get<T = unknown>(path?: string): T;
  set(path: string, value: unknown): Promise<void>;
  replace(value: unknown): Promise<void>;                      // STATE_SNAPSHOT path
  apply(delta: JsonPatchOperation[]): Promise<void>;           // STATE_DELTA path
  subscribe(handler: (state: unknown) => void): () => void;
}
```

The runtime consumes:

- `STATE_SNAPSHOT` → `state.replace(snapshot)`
- `STATE_DELTA` → `state.apply(delta)` (RFC 6902 add/replace/remove)
- `MESSAGES_SNAPSHOT` → `chat.setHistory(messages)`
- `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` → re-emitted via `ui.event` for the
  host to project (no built-in activity store yet).

Use cases:

- restaurant cart and checkout status
- booking form progress
- negotiation terms
- support ticket context
- generated dashboards or work queues

## 10. Capabilities

Capabilities are a string registry today. Future versions will add
host-approval flows for risky capabilities — the shape below is the shipped
minimum.

```ts
interface RuntimeCapabilityRegistry {
  has(name: string): boolean;
  list(): string[];
  grant(name: string): void;
  revoke(name: string): void;
}
```

Default grants today:

| Capability | Browser (full shim) | Browser (runtime-only) | Reason |
| --- | --- | --- | --- |
| `ui.render` | granted | **not granted** | Only full shim ships the Preact widget. |
| `storage.local` | granted | granted | `localStorage` for conversation state. |
| `transport.webrtc` | granted | granted | WebRTC DataChannel transport available. |
| `transport.direct` | granted | granted | Direct HTTP transport available. |
| `transport.browser-fallback` | granted | granted | WebGPU + transformers.js fallback available (subject to `navigator.gpu`). |

Planned capability families (manifest-declared, host-approved) — not shipped
yet:

| capability | purpose |
| --- | --- |
| `ui.prompt` | ask the user for approval/input |
| `network.fetch` | host-approved HTTP requests |
| `file.open` / `file.save` | user-approved file IO |
| `clipboard.write` | copy generated output |
| `payment.intent` / `calendar.intent` | checkout / booking handoff |
| `notification.show` | user-visible alerts |
| `model.local` | local model execution (WebGPU / Ollama) |

When those land they will gain a `request<T>(name, input?)` API and a
declarative manifest section.

## 11. Manifest Extensions

`pod.toml` already declares signed tools as an allow-list. Future
extensions:

```toml
[[capabilities]]
name = "ui.render"
required = true

[[capabilities]]
name = "storage.local"
required = true

[[capabilities]]
name = "payment.intent"
required = false
risk = "high"

[ui]
entry = "ui/order-taking.js"
mode = "widget"
```

For the current build, the default widget and CUSTOM-event-driven host UIs
(see `apps/web` hero) cover everything we need.

## 12. Environment Adapters

The same runtime is intended to run in different environments through
adapters. Today only the **browser** adapter is shipped.

```ts
interface RuntimeAdapter {
  readonly environment: "browser" | "cli" | "server" | "worker";
  storage: StorageAdapter;
  crypto: CryptoAdapter;
  transport: TransportAdapterFactory;
  ui?: UiAdapter;
  capabilities: RuntimeCapability[];
}
```

Browser adapter (shipped):

- renders the default widget when the full shim is loaded (`ui.render`
  granted)
- uses `localStorage` / IndexedDB
- WebRTC DataChannel as primary
- WebGPU + transformers.js as fallback
- direct HTTP as a dev convenience
- republishes UI events as `window.dispatchEvent("gemmapod:ui-event")`
  from the fallback transport; embedders can wire the same bridge for
  WebRTC by subscribing to `runtime.events.on("ui.event", …)`

CLI adapter (planned, `@gemmapod/cli`):

- no DOM
- terminal stdin/stdout
- conversations under `~/.gemmapod`
- DARTC over WebRTC where possible, otherwise direct HTTP/WS

Server adapter (planned):

- no default UI
- REST / SSE / WebSocket endpoints
- can host a packed pod behind DNS
- preserves signed DARTC frames where possible

Worker adapter (planned):

- no DOM
- background tasks, service-worker caches

## 13. Transport Contract

Transports are implementation details behind the runtime.

```ts
interface RuntimeTransport {
  readonly name: string;
  readonly state: "idle" | "connecting" | "ready" | "closed" | "error";
  connect(): Promise<void>;
  send(envelope: DartcEnvelope): Promise<void>;
  subscribe(handler: (envelope: DartcEnvelope) => void): () => void;
  close(): Promise<void>;
}
```

Current shipped transports (`packages/shim/src/transports/`):

- `webrtc`: DARTC over WebRTC DataChannel (`dartc.v0`) via cloud signaling
- `fallback`: in-browser local model via transformers.js + WebGPU
- `direct`: local HTTP endpoint for development

Selector behavior (`selectTransport`):

1. Try `webrtc` if configured. Wait for the data channel to open.
2. On failure, return `fallback` if it's configured **and** `navigator.gpu`
   exists. The fallback is returned **unprepared** — UIs must call
   `prepare()` on a user gesture.
3. Otherwise, return `direct` if configured (dev convenience).
4. Otherwise, throw with the trace of attempted transports.

> The `preferred = [...]` field in `pod.toml` is currently informational —
> it is parsed by the pack CLI but the browser selector uses the fixed
> order above. Wire-up to a real preference list is a future task.

Future transports:

- `relay-ws`: signed DARTC frames over cloud WebSocket when P2P fails
- `stdio`: CLI or local process bridge
- `http-sse`: server endpoint for non-browser clients

## 14. Security Model

Rules:

1. Verify the signed manifest before exposing persona, prompt, tools, or UI.
   Packed pods do this in `boot.ts` before constructing the runtime.
2. Verify every DARTC frame before routing it into the runtime bus
   (origin-side).
3. Keep DARTC session keys ephemeral.
4. Treat browser `CustomEvent` as untrusted integration output, not a trust
   boundary.
5. Gate high-risk capabilities through manifest policy and host approval
   (planned).
6. Keep cloud optional for rendezvous and deployment; it should not need
   chat plaintext for the normal P2P path.

## 15. Package Shape

Shipped:

```txt
@gemmapod/shim     # browser runtime + Preact widget; builds the two IIFEs
@gemmapod/browser  # npm wrapper that republishes both IIFEs + .d.ts
@gemmapod/dartc    # signed envelope, UI event, A2A discovery types + helpers
@gemmapod/core     # Rust → WASM. Manifest CBOR + Ed25519. Built for web and node.
@gemmapod/pack     # pod packaging CLI (init / keygen / doctor / build)
@gemmapod/origin   # owner daemon (DARTC over WebRTC, Ollama proxy, SQLite memory)
@gemmapod/cloud    # Hono signaling broker + pod registry (Firebase App Hosting)
```

Planned:

```txt
@gemmapod/runtime  # environment-neutral runtime carved out of @gemmapod/shim
@gemmapod/cli      # terminal adapter
```

The current `@gemmapod/shim` is the source of truth and contains both the
runtime spine and the default browser widget. The eventual
`@gemmapod/runtime` split will extract everything in `runtime/`, `transports/`,
`agUiMap`, `status`, and `host/` into an environment-neutral package, leaving
`@gemmapod/shim` (or its successor `@gemmapod/browser-widget`) as the
Preact-bearing browser adapter.

## 16. Minimal Browser Example

```html
<div id="pod"></div>
<script src="/gemmapod-shim.iife.js"></script>
<script>
  GemmaPod.mountPod(document.getElementById("pod"), {
    name: "Order Pod",
    persona: "Takes restaurant orders",
    systemPrompt: "You take orders and maintain a cart.",
    model: "gemma4:e4b",
    transport: {
      webrtc: {
        signalUrl: "wss://cloud.gemmapod.com/signal",
        podId: "restaurant-demo",
      },
      fallback: { model: "onnx-community/gemma-4-E2B-it-ONNX" },
    },
  }).then(({ runtime, destroy }) => {
    runtime.events.on("ui.event", ({ event }) => {
      if (event.type === "STATE_SNAPSHOT") renderCart(event.snapshot);
    });
    window.addEventListener("pagehide", () => destroy());
  });
</script>
```

## 17. Minimal Headless / CopilotKit-Style Example

```html
<script src="/gemmapod-runtime.iife.js"></script>
<script>
  GemmaPod.mountPod(null, config, {
    ui: "none",
    fallbackUi: "default",
    fallbackMountParent: document.getElementById("fallback-host"),
  }).then(({ runtime }) => {
    runtime.events.on("ui.event", ({ event }) => projectIntoMyUi(event));
    document.getElementById("send").addEventListener("click", async () => {
      for await (const chunk of runtime.chat.stream(input.value)) {
        appendToMyTranscript(chunk.delta);
      }
    });
  });
</script>
```

## 18. Minimal CLI Example (planned)

```sh
gemmapod chat ./dist/restaurant.html
```

Expected behavior:

1. verify the packed pod
2. restore or create a conversation id
3. connect to the owner origin through the pod's transport config
4. stream text to stdout
5. show tool/state/activity events in a terminal-friendly way

The same pod can therefore run as a website widget, a shareable HTML file,
a CopilotKit-style headless embed, a terminal agent, or a cloud-hosted
endpoint.

## 19. Implementation Phases

Phase 1 — browser runtime handle (shipped):

- `GemmaPod.create` / `mount` / `mountPod` / `boot` return a `GemmaPodRuntime`
- typed event bus with the shipped events listed in §6
- default widget unchanged for packed pods
- browser `gemmapod:ui-event` bridge available from the fallback transport
- two-IIFE split (full vs runtime-only) shipping
- AG-UI mapping helper (`mapDartcUiEventToAgUi`)

Phase 2 — state + capability modules (partial):

- `RuntimeStateStore` shipped (`get`/`set`/`replace`/`apply`/`subscribe`)
- DARTC `STATE_SNAPSHOT` / `STATE_DELTA` / `MESSAGES_SNAPSHOT` routed into
  runtime state + chat history
- Capability registry shipped as a string set (`has`/`list`/`grant`/`revoke`)
- Risk-tier capability requests + manifest declarations are next

Phase 3 — CLI runtime (planned):

- `@gemmapod/cli`
- open packed pod / manifest from terminal
- DARTC chat to stdout
- conversation id under `~/.gemmapod`

Phase 4 — richer pod UI modules (planned):

- manifest-declared UI modules
- expose `runtime` to custom UI code
- signed manifest + capability policy still the boundary

Phase 5 — origin persistence (mostly shipped):

- SQLite behind the origin conversation map (`~/.gemmapod/origin.sqlite`)
- persist message / run / tool event log
- restart recovery and audit/debug timelines

Phase 6 — runtime/browser split (planned):

- carve `@gemmapod/runtime` out of `@gemmapod/shim`
- `@gemmapod/browser` becomes Preact-only adapter over `@gemmapod/runtime`
