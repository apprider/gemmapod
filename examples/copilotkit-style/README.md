# copilotkit-style

The integration pattern for CopilotKit / AG-UI consumers. Renders every
DARTC UI event in **two columns** side-by-side — raw DARTC
(`SCREAMING_SNAKE` `type`) and AG-UI-shaped (`PascalCase` `type`) —
showing exactly what `GemmaPod.mapDartcUiEventToAgUi(event)` does.

## Run

```sh
pnpm install                  # from repo root (once)
pnpm --filter @gemmapod/example-copilotkit-style dev
# open http://localhost:5175
```

## What it shows

- Loading **`gemmapod-runtime.iife.js`** (no Preact UI).
- Headless mount: `mountPod(null, config, { ui: "none", fallbackUi:
  "none" })` — the React app is the UI.
- Subscribing to `runtime.events.on("ui.event", …)` and rendering each
  event twice: once as the raw DARTC event the runtime emits, once
  through `mapDartcUiEventToAgUi(event)`.

Send a message. Watch tool calls, text streaming, state snapshots, and
custom events appear in both columns. Payload fields are identical;
only the `type` discriminator is rewritten:

| DARTC                    | AG-UI                 |
| ------------------------ | --------------------- |
| `RUN_STARTED`            | `RunStarted`          |
| `TEXT_MESSAGE_CONTENT`   | `TextMessageContent`  |
| `TOOL_CALL_START`        | `ToolCallStart`       |
| `TOOL_CALL_RESULT`       | `ToolCallResult`      |
| `STATE_SNAPSHOT`         | `StateSnapshot`       |
| `STATE_DELTA`            | `StateDelta`          |
| `MESSAGES_SNAPSHOT`      | `MessagesSnapshot`    |
| `CUSTOM`                 | `Custom`              |
| `RAW` / *unknown*        | `Raw`                 |

Field names match AG-UI on purpose — `threadId`, `runId`, `messageId`,
`toolCallId`, `delta`, `snapshot`, `patch`, etc. That means a host already
shaped for AG-UI lifecycle events drops in with one mapping call.

## Wiring it into a real CopilotKit host

```ts
import { CopilotKitAgent } from "@copilotkit/react-core"; // example shape

runtime.events.on("ui.event", ({ event }) => {
  copilot.dispatch(GemmaPod.mapDartcUiEventToAgUi(event));
});
```

The mapper is a pure function — call it where it's convenient (inside
the event handler, in a generic adapter, in a React Effect, on a
worker). It does not require any runtime state.

## See also

- [`react-headless`](../react-headless) — same headless mount pattern,
  with the host rendering its own transcript instead of an event
  inspector.
- [`packages/shim/src/agUiMap.ts`](../../packages/shim/src/agUiMap.ts)
  — the mapper source.
- [AG-UI event reference](https://docs.ag-ui.com/concepts/events).
