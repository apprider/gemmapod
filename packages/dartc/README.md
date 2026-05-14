# `@gemmapod/dartc` (real-time agent protocol)

The shared TypeScript package for **DARTC v0.2**: Distributed Agent
Real-Time Communication.

DARTC is the signed, topic-multiplexed envelope GemmaPod speaks over
WebRTC DataChannels. It is not a replacement for A2A; it is the real-time
binding that carries GemmaPod chat topics and A2A-compatible topics such
as `a2a.discovery`.

## What it does

- Defines the `DartcEnvelope` shape used by the shim and origin daemon.
- Canonicalizes envelopes by sorting object keys recursively before
  signing.
- Produces the byte payload covered by Ed25519 signatures.
- Exposes signer/verifier adapters so callers can use `gemmapod-core`
  without this package depending on WASM directly.
- Provides helpers for `dartc.ack`, `dartc.error`, topic matching, and
  A2A Agent Card discovery payloads.
- Defines `gemmapod.ui.event`, an AG-UI-shaped signed event stream
  (versioned `dartc.ui.event/0.1`) covering:

  - run lifecycle (`RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`)
  - assistant text (`TEXT_MESSAGE_START` / `_CONTENT` / `_END`)
  - tool calls (`TOOL_CALL_START` / `_ARGS` / `_END` / `_RESULT`)
  - state (`STATE_SNAPSHOT` / `STATE_DELTA` — RFC 6902 JSON Patch)
  - chat history rehydration (`MESSAGES_SNAPSHOT`)
  - activity panels (`ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA`)
  - app-specific actions (`CUSTOM`) and a `RAW` escape hatch
- Field names match [AG-UI](https://docs.ag-ui.com/concepts/events)
  (`threadId`, `runId`, `messageId`, `delta`, `snapshot`, …). The
  discriminator differs: DARTC uses SCREAMING_SNAKE; the shim's
  `mapDartcUiEventToAgUi(event)` converts to PascalCase for CopilotKit
  hosts (fields unchanged).

## Topics currently used

| topic | direction | purpose |
|-------|-----------|---------|
| `dartc.hello` | both ways | Session key and topic negotiation. |
| `dartc.ack` | both ways | Control-message acknowledgement. |
| `dartc.error` | both ways | Signed protocol/application error. |
| `a2a.discovery` | both ways | A2A-shaped Agent Card exchange. |
| `gemmapod.chat.request` | browser -> origin | Signed chat request. |
| `gemmapod.chat.delta` | origin -> browser | Streamed model text/reasoning delta. |
| `gemmapod.chat.done` | origin -> browser | End of chat stream. |
| `gemmapod.ui.event` | both ways | Signed UI/runtime event stream. |

## Run locally

```sh
pnpm --filter @gemmapod/dartc build
pnpm --filter @gemmapod/dartc test
```

## Runtime ingestion (browser shim)

`@gemmapod/shim` consumes UI events identically across transports:

| `DartcUiEvent.type` | Runtime effect |
| --- | --- |
| `STATE_SNAPSHOT` | `runtime.state.replace(snapshot)` |
| `STATE_DELTA` | `runtime.state.apply(delta)` |
| `MESSAGES_SNAPSHOT` | `runtime.chat.setHistory(messages)` + `chat.history` event |
| `CUSTOM name="a2a.card"` | populate `runtime.a2a.card` + `a2a.card` event |
| any | re-emit as `runtime.events` `ui.event` |

## Security boundary

This package defines the bytes to sign and verify. It does not hold keys
and does not choose trust policy. The browser shim and origin daemon
generate ephemeral DARTC session keys, while the signed pod manifest
remains the authority for pod identity, system prompt, model preference,
transport config, and tool allow-list.

Logical continuity is carried as payload data, not as WebRTC identity.
The browser may include a stable `conversation_id` in `dartc.hello` and
`gemmapod.chat.request`; origin runtimes can use that id to attach a new
peer connection to an existing conversation after refresh.
