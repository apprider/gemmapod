export const DARTC_VERSION = "0.2" as const;
export const DARTC_UI_EVENT_TOPIC = "gemmapod.ui.event" as const;

export type DartcVersion = typeof DARTC_VERSION;
export type DartcPriority = "low" | "normal" | "high";

export interface DartcMetadata {
  stream?: boolean;
  chunk_id?: number;
  is_final?: boolean;
  priority?: DartcPriority;
  requires_ack?: boolean;
  ack_for?: string;
}

export interface DartcEnvelope<TPayload = unknown, TA2A = unknown> {
  version: DartcVersion;
  msg_id: string;
  from: string;
  to: string;
  topic: string;
  timestamp: number;
  signature: string;
  a2a?: TA2A;
  dartc?: DartcMetadata;
  payload?: TPayload;
}

export interface UnsignedDartcEnvelope<TPayload = unknown, TA2A = unknown>
  extends Omit<DartcEnvelope<TPayload, TA2A>, "signature"> {
  signature?: string;
}

export interface DartcHelloPayload {
  role: "visitor" | "origin" | "agent" | "relay";
  pod_id?: string;
  conversation_id?: string;
  agent_id: string;
  protocol_versions: {
    dartc: DartcVersion | string;
    a2a?: string;
  };
  supported_topics: string[];
  signedManifestB64?: string;
}

export interface GemmaPodChatRequest {
  request_id: string;
  conversation_id?: string;
  model?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  signedManifestB64?: string;
}

export interface GemmaPodChatDelta {
  request_id: string;
  delta: string;
}

export interface GemmaPodChatDone {
  request_id: string;
}

export interface DartcErrorPayload {
  code: string;
  message: string;
  request_id?: string;
  fatal?: boolean;
}

export type JsonPatchOperation =
  | { op: "add" | "replace" | "test"; path: string; value: unknown }
  | { op: "remove"; path: string }
  | { op: "move" | "copy"; from: string; path: string };

export type DartcUiEvent =
  | {
      type: "RUN_STARTED";
      threadId: string;
      runId: string;
      parentRunId?: string;
      input?: unknown;
      timestamp?: number;
    }
  | { type: "RUN_FINISHED"; threadId: string; runId: string; timestamp?: number }
  | {
      type: "RUN_ERROR";
      threadId: string;
      runId: string;
      message: string;
      code?: string;
      timestamp?: number;
    }
  | {
      type: "TEXT_MESSAGE_START";
      threadId: string;
      runId: string;
      messageId: string;
      role: "assistant" | "user" | "system" | "tool" | "reasoning";
      timestamp?: number;
    }
  | {
      type: "TEXT_MESSAGE_CONTENT";
      threadId: string;
      runId: string;
      messageId: string;
      delta: string;
      timestamp?: number;
    }
  | {
      type: "TEXT_MESSAGE_END";
      threadId: string;
      runId: string;
      messageId: string;
      timestamp?: number;
    }
  | {
      type: "TOOL_CALL_START";
      threadId: string;
      runId: string;
      toolCallId: string;
      toolCallName: string;
      parentMessageId?: string;
      timestamp?: number;
    }
  | {
      type: "TOOL_CALL_ARGS";
      threadId: string;
      runId: string;
      toolCallId: string;
      delta: string;
      timestamp?: number;
    }
  | {
      type: "TOOL_CALL_END";
      threadId: string;
      runId: string;
      toolCallId: string;
      timestamp?: number;
    }
  | {
      type: "TOOL_CALL_RESULT";
      threadId: string;
      runId: string;
      messageId: string;
      toolCallId: string;
      content: string;
      role?: "tool";
      timestamp?: number;
    }
  | { type: "STATE_SNAPSHOT"; threadId: string; runId?: string; snapshot: unknown; timestamp?: number }
  | {
      type: "STATE_DELTA";
      threadId: string;
      runId?: string;
      delta: JsonPatchOperation[];
      timestamp?: number;
    }
  | {
      type: "MESSAGES_SNAPSHOT";
      threadId: string;
      messages: Array<{ id?: string; role: string; content?: string; [key: string]: unknown }>;
      timestamp?: number;
    }
  | {
      type: "ACTIVITY_SNAPSHOT";
      threadId: string;
      runId?: string;
      messageId: string;
      activityType: string;
      content: unknown;
      replace?: boolean;
      timestamp?: number;
    }
  | {
      type: "ACTIVITY_DELTA";
      threadId: string;
      runId?: string;
      messageId: string;
      activityType: string;
      patch: JsonPatchOperation[];
      timestamp?: number;
    }
  | {
      type: "CUSTOM";
      threadId: string;
      runId?: string;
      name: string;
      value?: unknown;
      timestamp?: number;
    }
  | { type: "RAW"; threadId?: string; runId?: string; event: unknown; timestamp?: number };

export interface DartcUiEventPayload<TEvent extends DartcUiEvent = DartcUiEvent> {
  schema: "dartc.ui.event/0.1";
  event: TEvent;
}

export interface A2AAgentCard {
  protocolVersion?: string;
  name: string;
  description: string;
  url?: string;
  capabilities?: Record<string, unknown>;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    tags?: string[];
  }>;
  provider?: {
    organization: string;
    url?: string;
  };
  extensions?: Array<Record<string, unknown>>;
}

export interface A2ADiscoveryPayload {
  kind: "AgentCard";
  card: A2AAgentCard;
}

export type DartcSigner = (bytes: Uint8Array) => string | Promise<string>;
export type DartcVerifier = (bytes: Uint8Array, signature: string) => boolean | Promise<boolean>;

const encoder = new TextEncoder();

export function createEnvelope<TPayload = unknown, TA2A = unknown>(
  input: {
    from: string;
    to: string;
    topic: string;
    msg_id?: string;
    timestamp?: number;
    dartc?: DartcMetadata;
    a2a?: TA2A;
    payload?: TPayload;
  },
): UnsignedDartcEnvelope<TPayload, TA2A> {
  return stripUndefined({
    version: DARTC_VERSION,
    msg_id: input.msg_id ?? createMessageId(),
    from: input.from,
    to: input.to,
    topic: input.topic,
    timestamp: input.timestamp ?? Date.now(),
    dartc: input.dartc,
    a2a: input.a2a,
    payload: input.payload,
  }) as UnsignedDartcEnvelope<TPayload, TA2A>;
}

export async function signEnvelope<TPayload = unknown, TA2A = unknown>(
  envelope: UnsignedDartcEnvelope<TPayload, TA2A>,
  signer: DartcSigner,
): Promise<DartcEnvelope<TPayload, TA2A>> {
  const signature = await signer(signingBytes(envelope));
  return { ...envelope, signature };
}

export async function verifyEnvelope(
  envelope: DartcEnvelope,
  verifier: DartcVerifier,
): Promise<boolean> {
  if (!isEnvelope(envelope)) return false;
  return verifier(signingBytes(envelope), envelope.signature);
}

export function parseEnvelope(raw: string | unknown): DartcEnvelope {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!isEnvelope(parsed)) {
    throw new Error("invalid DARTC envelope");
  }
  return parsed;
}

export function isEnvelope(value: unknown): value is DartcEnvelope {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === DARTC_VERSION &&
    typeof v.msg_id === "string" &&
    typeof v.from === "string" &&
    typeof v.to === "string" &&
    typeof v.topic === "string" &&
    typeof v.timestamp === "number" &&
    Number.isFinite(v.timestamp) &&
    typeof v.signature === "string"
  );
}

export function signingBytes(envelope: UnsignedDartcEnvelope | DartcEnvelope): Uint8Array {
  return encoder.encode(canonicalJson(withoutSignature(envelope)));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function withoutSignature<TPayload = unknown, TA2A = unknown>(
  envelope: UnsignedDartcEnvelope<TPayload, TA2A> | DartcEnvelope<TPayload, TA2A>,
): UnsignedDartcEnvelope<TPayload, TA2A> {
  const { signature: _signature, ...rest } = envelope;
  return rest;
}

export function createAck(
  forEnvelope: DartcEnvelope,
  from: string,
): UnsignedDartcEnvelope<{ ok: true }> {
  return createEnvelope({
    from,
    to: forEnvelope.from,
    topic: "dartc.ack",
    dartc: { ack_for: forEnvelope.msg_id },
    payload: { ok: true },
  });
}

export function createErrorEnvelope(
  input: {
    from: string;
    to: string;
    code: string;
    message: string;
    request_id?: string;
    fatal?: boolean;
    ack_for?: string;
  },
): UnsignedDartcEnvelope<DartcErrorPayload> {
  return createEnvelope({
    from: input.from,
    to: input.to,
    topic: "dartc.error",
    dartc: input.ack_for ? { ack_for: input.ack_for } : undefined,
    payload: {
      code: input.code,
      message: input.message,
      request_id: input.request_id,
      fatal: input.fatal,
    },
  });
}

export function createUiEventEnvelope<TEvent extends DartcUiEvent>(
  input: {
    from: string;
    to: string;
    event: TEvent;
    msg_id?: string;
    timestamp?: number;
    dartc?: DartcMetadata;
  },
): UnsignedDartcEnvelope<DartcUiEventPayload<TEvent>> {
  return createEnvelope<DartcUiEventPayload<TEvent>>({
    from: input.from,
    to: input.to,
    topic: DARTC_UI_EVENT_TOPIC,
    msg_id: input.msg_id,
    timestamp: input.timestamp,
    dartc: input.dartc,
    payload: {
      schema: "dartc.ui.event/0.1",
      event: withEventTimestamp(input.event, input.timestamp),
    },
  });
}

export function isDartcUiEventPayload(value: unknown): value is DartcUiEventPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.schema === "dartc.ui.event/0.1" && isDartcUiEvent(v.event);
}

export function isDartcUiEvent(value: unknown): value is DartcUiEvent {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string";
}

export function topicMatches(pattern: string, topic: string): boolean {
  if (pattern === "*" || pattern === topic) return true;
  if (!pattern.endsWith(".*")) return false;
  const prefix = pattern.slice(0, -1);
  return topic.startsWith(prefix);
}

export function isA2ATopic(topic: string): boolean {
  return topic.startsWith("a2a.");
}

export function isReservedTopic(topic: string): boolean {
  return topic.startsWith("dartc.") || topic.startsWith("gemmapod.") || topic.startsWith("a2a.");
}

export function createMessageId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c?.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = canonicalize(v);
  }
  return out;
}

function stripUndefined(value: unknown): unknown {
  return canonicalize(value);
}

function withEventTimestamp<TEvent extends DartcUiEvent>(event: TEvent, timestamp?: number): TEvent {
  if (event.timestamp) return event;
  return { ...event, timestamp: timestamp ?? Date.now() };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
