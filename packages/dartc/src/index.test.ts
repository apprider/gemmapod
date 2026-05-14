import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  canonicalJson,
  createAck,
  createEnvelope,
  createErrorEnvelope,
  createUiEventEnvelope,
  DARTC_UI_EVENT_TOPIC,
  isA2ATopic,
  isDartcUiEventPayload,
  parseEnvelope,
  signEnvelope,
  signingBytes,
  topicMatches,
  verifyEnvelope,
} from "./index";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("base64");
}

test("canonicalJson sorts object keys recursively", () => {
  assert.equal(
    canonicalJson({ z: 1, a: { c: 3, b: 2 }, list: [{ y: true, x: false }] }),
    '{"a":{"b":2,"c":3},"list":[{"x":false,"y":true}],"z":1}',
  );
});

test("signEnvelope signs the envelope without signature", async () => {
  const unsigned = createEnvelope({
    msg_id: "msg-1",
    timestamp: 123,
    from: "alice",
    to: "bob",
    topic: "gemmapod.chat.request",
    payload: { b: 2, a: 1 },
  });

  const signed = await signEnvelope(unsigned, digest);

  assert.equal(signed.signature, digest(signingBytes(unsigned)));
  assert.equal(await verifyEnvelope(signed, (bytes, signature) => digest(bytes) === signature), true);
  assert.equal(
    await verifyEnvelope({ ...signed, payload: { a: 2 } }, (bytes, signature) => digest(bytes) === signature),
    false,
  );
});

test("parseEnvelope rejects non-DARTC messages", () => {
  assert.throws(() => parseEnvelope(JSON.stringify({ t: "req" })), /invalid DARTC envelope/);
});

test("topic helpers support exact and prefix wildcard matching", () => {
  assert.equal(topicMatches("gemmapod.chat.*", "gemmapod.chat.delta"), true);
  assert.equal(topicMatches("gemmapod.chat.*", "gemmapod.tool.call"), false);
  assert.equal(topicMatches("a2a.discovery", "a2a.discovery"), true);
  assert.equal(isA2ATopic("a2a.message"), true);
});

test("ack and error helpers preserve routing metadata", () => {
  const base = {
    version: "0.2" as const,
    msg_id: "msg-2",
    from: "alice",
    to: "bob",
    topic: "dartc.hello",
    timestamp: 123,
    signature: "sig",
  };

  assert.deepEqual(createAck(base, "bob").dartc, { ack_for: "msg-2" });
  assert.deepEqual(
    createErrorEnvelope({
      from: "bob",
      to: "alice",
      code: "bad_topic",
      message: "topic not allowed",
      request_id: "req-1",
      ack_for: "msg-2",
    }).payload,
    { code: "bad_topic", message: "topic not allowed", request_id: "req-1" },
  );
});

test("ui event helper wraps AG-UI-style events in a signed DARTC topic", () => {
  const envelope = createUiEventEnvelope({
    msg_id: "msg-3",
    timestamp: 123,
    from: "origin:key",
    to: "visitor:key",
    event: {
      type: "RUN_STARTED",
      threadId: "conv-1",
      runId: "run-1",
    },
  });

  assert.equal(envelope.topic, DARTC_UI_EVENT_TOPIC);
  assert.equal(envelope.payload?.schema, "dartc.ui.event/0.1");
  assert.equal(envelope.payload?.event.type, "RUN_STARTED");
  assert.equal(envelope.payload?.event.timestamp, 123);
  assert.equal(isDartcUiEventPayload(envelope.payload), true);
});
