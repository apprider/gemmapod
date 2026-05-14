# restaurant-pod

A worked example of **headless state**: the origin emits `STATE_SNAPSHOT`
+ `STATE_DELTA` events over DARTC, and the visitor's page renders a live
cart beside the chat — **without** minting a new DARTC topic or building
a parallel websocket.

This is the canonical pattern for any pod that has structured shared state
(carts, booking forms, support tickets, negotiation terms, dashboards).
The runtime auto-applies snapshots and JSON-Patch deltas; you subscribe to
one `state.changed` event and re-render.

## Run

Two halves:

**1. The origin event simulator** — emits the DARTC UI event payloads a
real origin daemon would send:

```sh
pnpm --filter @gemmapod/example-restaurant-pod start
```

You'll see JSON like:

```json
{ "type": "STATE_SNAPSHOT", "threadId": "conv_restaurant_demo", "snapshot": { "items": [], "subtotalCents": 0, "status": "open" } }
{ "type": "TEXT_MESSAGE_START", … }
{ "type": "TEXT_MESSAGE_CONTENT", "delta": "Sure, " }
…
{ "type": "STATE_DELTA", "delta": [{ "op": "add", "path": "/items/0", "value": { "id": "pizza-margherita", "qty": 1, "priceCents": 1400, … } }, { "op": "replace", "path": "/subtotalCents", "value": 1400 }] }
```

**2. The host page** — open `host.html` in a browser. It mounts a pod
widget on the left and renders the cart on the right. The cart updates in
real time as the origin emits state changes.

## What you're seeing

`runtime.events.on("state.changed", …)` fires whenever the runtime's
internal state store changes — either from a `STATE_SNAPSHOT` (replaces
the whole tree) or a `STATE_DELTA` (RFC 6902 JSON Patch operations
applied to the tree). The host doesn't see the wire envelopes; it sees a
single typed snapshot per change.

Custom UI events ride the same channel via `CUSTOM`:

```ts
runtime.events.on("ui.event", ({ event }) => {
  if (event.type === "CUSTOM" && event.name === "checkout.requested") {
    showCheckoutSheet(event.value);
  }
});
```

## Wire it into a real origin

The simulator script is shaped exactly like a real origin daemon's UI
event emit path. To make it real:

1. Take the same `emit(event)` calls from `src/origin.ts`.
2. Inside your `@gemmapod/origin` setup (or your own DARTC peer),
   wrap each event in a signed envelope on topic `gemmapod.ui.event`
   with `payload.schema = "dartc.ui.event/0.1"`.
3. Send over the data channel — the shim verifies signatures and
   routes the typed event into `runtime.events`.

See [`packages/dartc/README.md`](../../packages/dartc/README.md) for the
helper `createUiEventEnvelope(...)`.

## Why this pattern matters

The alternative would be:
- a second WebSocket from origin to browser for "out-of-band" state
- or a polling endpoint
- or a custom topic per feature

DARTC + the runtime state store give you snapshot/delta semantics over the
same signed channel that's already moving chat traffic. The same pattern
scales from a cart of three items to a thousand-row dashboard.
