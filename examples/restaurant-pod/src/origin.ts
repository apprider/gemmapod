// Simulated restaurant origin — prints the DartcUiEvent stream a real
// origin daemon would emit over `gemmapod.ui.event`. The events here are
// the **payloads** (`schema: "dartc.ui.event/0.1"`, `event: DartcUiEvent`);
// in production a real origin wraps each in a signed DARTC envelope and
// sends them on the WebRTC data channel.
//
// Run:  pnpm start
// Then open host.html in a browser to see how a host page consumes the
// same shape via `runtime.events.on("ui.event", …)`.

import type { DartcUiEvent } from "@gemmapod/dartc";

const threadId = "conv_restaurant_demo";
const runId = "run_001";

interface CartItem {
  id: string;
  name: string;
  qty: number;
  priceCents: number;
}
interface Cart {
  items: CartItem[];
  subtotalCents: number;
  status: "open" | "confirmed";
}

const cart: Cart = { items: [], subtotalCents: 0, status: "open" };

function emit(event: DartcUiEvent): void {
  // A real origin would call:
  //   signDartcEnvelope({ topic: "gemmapod.ui.event", payload: { schema: "dartc.ui.event/0.1", event } })
  // and send it over the data channel. Here we just log the event shape.
  console.log(JSON.stringify(event));
}

function recomputeSubtotal(): void {
  cart.subtotalCents = cart.items.reduce((sum, it) => sum + it.qty * it.priceCents, 0);
}

function addItem(item: CartItem): void {
  cart.items.push(item);
  recomputeSubtotal();
  emit({
    type: "STATE_DELTA",
    threadId,
    runId,
    delta: [
      { op: "add", path: `/items/${cart.items.length - 1}`, value: item },
      { op: "replace", path: "/subtotalCents", value: cart.subtotalCents },
    ],
    timestamp: Date.now(),
  });
}

function confirm(): void {
  cart.status = "confirmed";
  emit({
    type: "STATE_DELTA",
    threadId,
    runId,
    delta: [{ op: "replace", path: "/status", value: "confirmed" }],
    timestamp: Date.now(),
  });
  emit({
    type: "CUSTOM",
    threadId,
    runId,
    name: "checkout.requested",
    value: { totalCents: cart.subtotalCents, currency: "USD" },
    timestamp: Date.now(),
  });
}

async function main(): Promise<void> {
  // Run lifecycle around the whole tool/state flow.
  emit({ type: "RUN_STARTED", threadId, runId, timestamp: Date.now() });

  // Initial empty cart snapshot — the host renders this once on connect.
  emit({
    type: "STATE_SNAPSHOT",
    threadId,
    runId,
    snapshot: cart,
    timestamp: Date.now(),
  });

  // A user message arrives — the model decides to add an item.
  emit({
    type: "TEXT_MESSAGE_START",
    threadId,
    runId,
    messageId: "msg_1",
    role: "assistant",
    timestamp: Date.now(),
  });
  for (const delta of ["Sure, ", "adding ", "a margherita pizza."]) {
    await new Promise((r) => setTimeout(r, 80));
    emit({
      type: "TEXT_MESSAGE_CONTENT",
      threadId,
      runId,
      messageId: "msg_1",
      delta,
      timestamp: Date.now(),
    });
  }
  emit({
    type: "TEXT_MESSAGE_END",
    threadId,
    runId,
    messageId: "msg_1",
    timestamp: Date.now(),
  });

  addItem({ id: "pizza-margherita", name: "Margherita pizza", qty: 1, priceCents: 1400 });

  await new Promise((r) => setTimeout(r, 300));

  // Another turn — a drink.
  addItem({ id: "drink-water", name: "Sparkling water", qty: 2, priceCents: 350 });

  await new Promise((r) => setTimeout(r, 300));

  // Customer says "that's it" — model confirms.
  confirm();

  emit({ type: "RUN_FINISHED", threadId, runId, timestamp: Date.now() });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
