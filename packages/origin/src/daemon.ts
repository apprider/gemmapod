#!/usr/bin/env node
// gemmapod-origin: owner-side daemon.
//
// Connects to the gemmapod-cloud signaling server over a persistent
// WebSocket and registers itself for one or more pod IDs. When a visitor's
// pod opens a session through the cloud, this daemon completes the WebRTC
// handshake locally and streams Ollama responses across the resulting data
// channel.
//
// Data-channel wire protocol: DARTC v0.2 envelopes only.

import {
  createEnvelope,
  createUiEventEnvelope,
  parseEnvelope,
  signEnvelope,
  verifyEnvelope,
  type A2ADiscoveryPayload,
  type A2AAgentCard,
  type DartcEnvelope,
  type DartcHelloPayload,
  type DartcMetadata,
  type DartcUiEvent,
  type GemmaPodChatDelta,
  type GemmaPodChatDone,
  type GemmaPodChatRequest,
} from "@gemmapod/dartc";
import WebSocket from "ws";
import { RTCPeerConnection } from "node-datachannel/polyfill";
import enquirer from "enquirer";
import { createRequire } from "node:module";
import { buildToolRuntime, type ToolCall, type VerifiedPodManifest } from "./toolRuntime";
import { ConversationStore, type OriginMessage } from "./conversationStore";

type SignalMsg =
  | { t: "register"; podId: string; ownerToken?: string }
  | { t: "registered"; podId: string }
  | { t: "offer"; sessionId: string; sdp: string }
  | { t: "answer"; sessionId: string; sdp: string }
  | { t: "candidate"; sessionId: string; candidate: RTCIceCandidateInit }
  | { t: "error"; sessionId?: string; message: string };

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const SIGNAL_URL = process.env.SIGNAL_URL ?? "ws://localhost:8080/signal";
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];
const MAX_TOOL_ROUNDS = 2;
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 80;

type GemmaPodCoreModule = {
  GemmaPodCore: {
    generateKey(): { publicKey: string; secretKey: string };
    signBytes(payload: Uint8Array, secretKey: Uint8Array): Uint8Array;
    verifyBytes(payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean;
  };
};

interface SessionKey {
  publicKey: string;
  secretKey: Uint8Array;
}

interface DartcPeerSession {
  originKey: SessionKey;
  visitorPublicKey?: string;
  conversationId?: string;
  signedManifestB64?: string;
  manifest?: VerifiedPodManifest;
  peerAgentCard?: A2AAgentCard;
  sendDartc<TPayload>(topic: string, payload?: TPayload, dartc?: DartcMetadata): Promise<void>;
  sendUiEvent(event: DartcUiEvent, dartc?: DartcMetadata): Promise<void>;
}

let selectedModel = "";
let selectedPodId = process.env.POD_ID ?? "";
const require = createRequire(import.meta.url);
let coreModule: GemmaPodCoreModule | null = null;
const conversations = new ConversationStore();

async function bootstrap() {
  console.log(`[origin] checking Ollama at ${OLLAMA_URL}...`);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await res.json() as { models: Array<{ name: string }> };
    const models = data.models.map(m => m.name);

    if (models.length === 0) {
      console.warn("[origin] no models found in Ollama. Please run 'ollama pull gemma4:e4b' first.");
      process.exit(1);
    }

    const prompt = new (enquirer as any).Select({
      name: 'model',
      message: 'Select an Ollama model to serve:',
      choices: models
    });

    selectedModel = await prompt.run();
    console.log(`[origin] selected model: ${selectedModel}`);

    if (!selectedPodId) {
      const input = new (enquirer as any).Input({
        message: 'Enter Pod ID to register (e.g. raj-card):',
        initial: 'raj-card'
      });
      selectedPodId = await input.run();
    }
    console.log(`[origin] using Pod ID: ${selectedPodId}`);

    connect();
  } catch (e) {
    console.error(`[origin] failed to reach Ollama:`, e);
    process.exit(1);
  }
}

async function handleChat(
  req: GemmaPodChatRequest,
  session: DartcPeerSession,
): Promise<void> {
  const toolRuntime = buildToolRuntime(req.signedManifestB64, selectedPodId);
  const modelToUse = selectedModel || toolRuntime.manifest?.model || req.model || "gemma4:e4b";
  const conversationId = req.conversation_id ?? session.conversationId ?? `session:${session.originKey.publicKey}`;
  const runId = req.request_id;
  const messageId = `${runId}:assistant`;
  const memoryKey = conversationId ? conversationMemoryKey(selectedPodId, conversationId) : null;
  const remembered = memoryKey ? conversations.get(memoryKey)?.messages ?? [] : [];
  const incomingMessages = req.messages.filter((m) => m.role !== "system");
  const conversationMessages =
    incomingMessages.length > 1 || remembered.length === 0
      ? incomingMessages
      : [...remembered, ...incomingMessages];
  const messages = toolRuntime.manifest
    ? [
        { role: "system" as const, content: toolRuntime.manifest.system_prompt },
        ...conversationMessages,
      ]
    : conversationMessages;

  console.log(
    `[origin] chat request using model: ${modelToUse} (${messages.length} messages, ${toolRuntime.tools.length} signed tools, conversation=${conversationId ?? "none"})`,
  );
  try {
    const prompt = latestUserPrompt(incomingMessages);
    await session.sendUiEvent({
      type: "RUN_STARTED",
      threadId: conversationId,
      runId,
      input: { model: modelToUse, messages: incomingMessages },
    }, { stream: true });
    await sendCompanionEvent(session, conversationId, runId, "companion.react", {
      mood: "thinking",
      stage: "center",
      expression: "thinking",
      text: prompt ? "I am shaping this into a quick view." : "I am checking with the owner origin.",
    });
    await sendCompanionEvent(session, conversationId, runId, "presentation.show", {
      title: prompt ? presentationTitle(prompt) : "Working on it",
      body: "The origin is preparing a signed presentation event.",
      items: ["Receiving the request", "Running Gemma", "Preparing the response"],
      status: "working",
    });
    await session.sendUiEvent({
      type: "TEXT_MESSAGE_START",
      threadId: conversationId,
      runId,
      messageId,
      role: "assistant",
    }, { stream: true });

    let assistantContent = "";
    if (toolRuntime.tools.length > 0) {
      const finalMessages = await runToolRounds(modelToUse, messages, toolRuntime, session, conversationId, runId, messageId);
      assistantContent = await streamCompletion(modelToUse, finalMessages, session, req.request_id, conversationId, runId, messageId);
    } else {
      assistantContent = await streamCompletion(modelToUse, messages, session, req.request_id, conversationId, runId, messageId);
    }
    await sendCompanionEvent(session, conversationId, runId, "presentation.show", {
      title: prompt ? presentationTitle(prompt) : "GemmaPod response",
      body: summarySentence(assistantContent),
      items: presentationItems(assistantContent),
      status: "ready",
    }, { stream: true, is_final: true });
    await sendCompanionEvent(session, conversationId, runId, "companion.react", {
      mood: "presenting",
      stage: "presenting-left",
      expression: "happy",
      text: "I prepared a small presentation from the origin response.",
    });
    await session.sendUiEvent({
      type: "TEXT_MESSAGE_END",
      threadId: conversationId,
      runId,
      messageId,
    }, { stream: true, is_final: true });
    await session.sendUiEvent({ type: "RUN_FINISHED", threadId: conversationId, runId }, {
      stream: true,
      is_final: true,
    });
    if (memoryKey) {
      conversations.set(memoryKey, {
        messages: [...conversationMessages, { role: "assistant", content: assistantContent }]
          .slice(-MAX_CONVERSATION_MESSAGES),
        updatedAt: Date.now(),
      });
    }
  } catch (e) {
    console.error(`[origin] fetch/tool failed:`, e);
    await session.sendUiEvent({
      type: "RUN_ERROR",
      threadId: conversationId,
      runId,
      message: (e as Error).message,
      code: "chat_failed",
    }, { stream: true, is_final: true });
    await sendCompanionEvent(session, conversationId, runId, "companion.react", {
      mood: "fallback",
      expression: "muted",
      text: "The origin hit an error while preparing that.",
    }).catch(() => {});
    await session.sendDartc("dartc.error", {
      code: "chat_failed",
      message: (e as Error).message,
      request_id: req.request_id,
    });
  }
}

async function sendCompanionEvent(
  session: DartcPeerSession,
  threadId: string,
  runId: string,
  name: string,
  value: unknown,
  dartc: DartcMetadata = { stream: true },
): Promise<void> {
  await session.sendUiEvent({
    type: "CUSTOM",
    threadId,
    runId,
    name,
    value,
  }, dartc);
}

function latestUserPrompt(messages: Array<{ role: string; content: string }>): string {
  return [...messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
}

function presentationTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, " ").trim();
  if (!clean) return "GemmaPod response";
  return clean.length > 56 ? `${clean.slice(0, 53).trim()}...` : clean;
}

function summarySentence(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (!clean) return "The origin returned an empty response.";
  const sentence = clean.match(/.*?[.!?](\s|$)/)?.[0]?.trim() ?? clean;
  return sentence.length > 180 ? `${sentence.slice(0, 177).trim()}...` : sentence;
}

function presentationItems(content: string): string[] {
  const bulletLines = content
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, ""))
    .filter((line) => line.length > 0 && line.length <= 160);
  const candidates = bulletLines.length >= 2
    ? bulletLines
    : content
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+/)
        .map((line) => line.trim())
        .filter(Boolean);
  return candidates.slice(0, 4).map((item) => item.length > 140 ? `${item.slice(0, 137).trim()}...` : item);
}

async function streamCompletion(
  model: string,
  messages: OriginMessage[],
  session: DartcPeerSession,
  requestId: string,
  threadId: string,
  runId: string,
  messageId: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  console.log(`[origin] Ollama response status: ${res.status} ${res.statusText}`);
  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => "");
    console.error(`[origin] Ollama error: ${res.status} ${errBody}`);
    await session.sendDartc("dartc.error", {
      code: "ollama_error",
      message: `ollama ${res.status}`,
      request_id: requestId,
    });
    return "";
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let chunkCount = 0;
  let assistantContent = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") {
        console.log(`[origin] chat done (chunks: ${chunkCount})`);
        await session.sendDartc<GemmaPodChatDone>("gemmapod.chat.done", { request_id: requestId }, {
          stream: true,
          is_final: true,
        });
        return assistantContent;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.delta?.reasoning;
        if (delta) {
          chunkCount++;
          assistantContent += delta;
          if (chunkCount === 1) {
            console.log(
              `[origin] first content/reasoning chunk received: ${JSON.stringify(delta)}`,
            );
            await sendCompanionEvent(session, threadId, runId, "companion.react", {
              mood: "presenting",
              stage: "presenting-left",
              expression: "talking",
              text: "Response is streaming into the page.",
            }, { stream: true, chunk_id: chunkCount, is_final: false });
          }
          await session.sendUiEvent({
            type: "TEXT_MESSAGE_CONTENT",
            threadId,
            runId,
            messageId,
            delta,
          }, {
            stream: true,
            chunk_id: chunkCount,
            is_final: false,
          });
          await session.sendDartc<GemmaPodChatDelta>("gemmapod.chat.delta", {
            request_id: requestId,
            delta,
          }, {
            stream: true,
            chunk_id: chunkCount,
            is_final: false,
          });
        }
      } catch (e) {
        console.warn(`[origin] failed to parse chunk: ${payload}`, e);
      }
    }
  }
  console.log(`[origin] chat finished stream (chunks: ${chunkCount})`);
  await session.sendDartc<GemmaPodChatDone>("gemmapod.chat.done", { request_id: requestId }, {
    stream: true,
    is_final: true,
  });
  return assistantContent;
}

async function runToolRounds(
  model: string,
  initialMessages: Array<{ role: string; content: string }>,
  toolRuntime: ReturnType<typeof buildToolRuntime>,
  session: DartcPeerSession,
  threadId: string,
  runId: string,
  parentMessageId: string,
): Promise<OriginMessage[]> {
  const messages: OriginMessage[] = [...initialMessages];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools: toolRuntime.tools, stream: false }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);
    const json = await res.json() as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string;
          tool_calls?: ToolCall[];
        };
      }>;
    };
    const assistant = json.choices?.[0]?.message;
    const toolCalls = assistant?.tool_calls ?? [];
    if (toolCalls.length === 0) return messages;

    messages.push({
      role: "assistant",
      content: assistant?.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      console.log(`[origin] executing signed tool: ${call.function.name}`);
      await session.sendUiEvent({
        type: "TOOL_CALL_START",
        threadId,
        runId,
        toolCallId: call.id,
        toolCallName: call.function.name,
        parentMessageId,
      }, { stream: true });
      await session.sendUiEvent({
        type: "TOOL_CALL_ARGS",
        threadId,
        runId,
        toolCallId: call.id,
        delta: typeof call.function.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function.arguments ?? {}),
      }, { stream: true });
      await session.sendUiEvent({ type: "TOOL_CALL_END", threadId, runId, toolCallId: call.id }, {
        stream: true,
      });
      const result = await toolRuntime.run(call);
      await session.sendUiEvent({
        type: "TOOL_CALL_RESULT",
        threadId,
        runId,
        messageId: `${runId}:tool:${call.id}`,
        toolCallId: call.id,
        role: "tool",
        content: result,
      }, { stream: true });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  messages.push({
    role: "system",
    content: "Tool call limit reached. Give the user the best answer from the tool results already available.",
  });
  return messages;
}



async function negotiate(
  offerSdp: string,
  sessionId: string,
  sendSignal: (msg: SignalMsg) => void,
): Promise<{ sdp: string; pc: RTCPeerConnection }> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  activePeers.set(sessionId, pc);

  pc.addEventListener("icecandidate", (ev) => {
    const candidate = (ev as RTCPeerConnectionIceEvent).candidate;
    if (!candidate) return;
    const json = typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
    sendSignal({ t: "candidate", sessionId, candidate: json });
  });

  pc.addEventListener("datachannel", (ev) => {
    const dc = (ev as RTCDataChannelEvent).channel;
    console.log(`[origin] data channel created: ${dc.label} (${dc.readyState})`);
    const session = createDartcPeerSession(dc);
    const sendHello = () => {
      console.log(`[origin] data channel open: ${dc.label}`);
      session.sendDartc<DartcHelloPayload>("dartc.hello", {
        role: "origin",
        pod_id: selectedPodId,
        agent_id: `origin:${session.originKey.publicKey}`,
        protocol_versions: { dartc: "0.2", a2a: "0.2.2" },
        supported_topics: ["dartc.*", "gemmapod.chat.*", "gemmapod.ui.event", "a2a.discovery"],
      }, { requires_ack: true }).catch((e) => {
        console.error("[origin] failed to send DARTC hello:", e);
      });
    };
    if (dc.readyState === "open") {
      sendHello();
    } else {
      dc.addEventListener("open", sendHello, { once: true });
    }

    dc.addEventListener("message", async (msgEv) => {
      await handleDartcFrame(session, (msgEv as MessageEvent).data as string);
    });
  });

  await pc.setRemoteDescription({ sdp: offerSdp, type: "offer" });
  const queued = pendingCandidatesBySession.get(sessionId);
  if (queued) {
    pendingCandidatesBySession.delete(sessionId);
    await Promise.all(queued.map((candidate) => pc.addIceCandidate(candidate)));
  }
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  return { sdp: pc.localDescription!.sdp, pc };
}

function createDartcPeerSession(dc: RTCDataChannel): DartcPeerSession {
  const key = generateSessionKey();
  const session: DartcPeerSession = {
    originKey: key,
    async sendDartc<TPayload>(topic: string, payload?: TPayload, dartc?: DartcMetadata) {
      if (dc.readyState !== "open") return;
      const envelope = createEnvelope<TPayload>({
        from: `origin:${key.publicKey}`,
        to: session.visitorPublicKey ? `visitor:${session.visitorPublicKey}` : "*",
        topic,
        dartc,
        payload,
      });
      const signed = await signEnvelope(envelope, (bytes) =>
        bytesToB64(loadCore().GemmaPodCore.signBytes(bytes, key.secretKey)),
      );
      dc.send(JSON.stringify(signed));
    },
    async sendUiEvent(event: DartcUiEvent, dartc?: DartcMetadata) {
      if (dc.readyState !== "open") return;
      const envelope = createUiEventEnvelope({
        from: `origin:${key.publicKey}`,
        to: session.visitorPublicKey ? `visitor:${session.visitorPublicKey}` : "*",
        event,
        dartc,
      });
      const signed = await signEnvelope(envelope, (bytes) =>
        bytesToB64(loadCore().GemmaPodCore.signBytes(bytes, key.secretKey)),
      );
      dc.send(JSON.stringify(signed));
    },
  };
  return session;
}

async function handleDartcFrame(session: DartcPeerSession, raw: string): Promise<void> {
  let envelope: DartcEnvelope;
  try {
    envelope = parseEnvelope(raw);
  } catch (e) {
    console.warn("[origin] rejected non-DARTC frame:", (e as Error).message);
    await session.sendDartc("dartc.error", {
      code: "invalid_frame",
      message: "invalid DARTC frame",
      fatal: true,
    });
    return;
  }

  const publicKey = session.visitorPublicKey ?? publicKeyFromAgent(envelope.from, envelope.payload);
  if (!publicKey || !(await verifyDartc(envelope, publicKey))) {
    console.warn("[origin] rejected DARTC frame: invalid visitor signature");
    await session.sendDartc("dartc.error", {
      code: "bad_signature",
      message: "invalid DARTC signature",
      fatal: true,
    });
    return;
  }
  session.visitorPublicKey = publicKey;

  if (envelope.topic === "dartc.hello") {
    const payload = envelope.payload as DartcHelloPayload | undefined;
    session.conversationId = payload?.conversation_id;
    session.signedManifestB64 = payload?.signedManifestB64;
    if (session.conversationId) {
      console.log(`[origin] attached DARTC peer to conversation ${session.conversationId}`);
    }
    if (payload?.pod_id && payload.pod_id !== selectedPodId) {
      await session.sendDartc("dartc.error", {
        code: "pod_mismatch",
        message: `expected pod ${selectedPodId}`,
        fatal: true,
      });
      return;
    }
    if (session.signedManifestB64) {
      try {
        session.manifest = buildToolRuntime(session.signedManifestB64, selectedPodId).manifest ?? undefined;
      } catch (e) {
        await session.sendDartc("dartc.error", {
          code: "manifest_rejected",
          message: (e as Error).message,
          fatal: true,
        });
        return;
      }
    }
    await session.sendDartc("dartc.ack", { ok: true }, { ack_for: envelope.msg_id });
    await session.sendDartc<A2ADiscoveryPayload>("a2a.discovery", {
      kind: "AgentCard",
      card: agentCardForSession(session),
    });
    return;
  }

  if (envelope.topic === "a2a.discovery") {
    const payload = envelope.payload as A2ADiscoveryPayload | undefined;
    if (payload?.kind === "AgentCard") {
      session.peerAgentCard = payload.card;
      console.log(`[origin] received A2A Agent Card: ${payload.card.name}`);
    }
    return;
  }

  if (envelope.topic === "gemmapod.chat.request") {
    const payload = envelope.payload as GemmaPodChatRequest | undefined;
    if (!payload?.request_id || !Array.isArray(payload.messages)) {
      await session.sendDartc("dartc.error", {
        code: "bad_chat_request",
        message: "invalid chat request payload",
      });
      return;
    }
    payload.signedManifestB64 ??= session.signedManifestB64;
    console.log(`[origin] DARTC chat request id=${payload.request_id} model=${payload.model}`);
    await handleChat(payload, session);
    return;
  }

  if (envelope.topic === "dartc.ack") return;

  await session.sendDartc("dartc.error", {
    code: "unsupported_topic",
    message: `unsupported DARTC topic: ${envelope.topic}`,
  });
}

function loadCore(): GemmaPodCoreModule {
  if (!coreModule) {
    coreModule = require("@gemmapod/core/node") as GemmaPodCoreModule;
  }
  return coreModule;
}

function generateSessionKey(): SessionKey {
  const key = loadCore().GemmaPodCore.generateKey();
  return { publicKey: key.publicKey, secretKey: hexToBytes(key.secretKey) };
}

async function verifyDartc(envelope: DartcEnvelope, publicKeyHex: string): Promise<boolean> {
  return verifyEnvelope(envelope, (bytes, signature) =>
    loadCore().GemmaPodCore.verifyBytes(bytes, b64ToBytes(signature), hexToBytes(publicKeyHex)),
  );
}

function publicKeyFromAgent(from: string, payload: unknown): string | null {
  const fromKey = from.split(":").at(-1);
  if (fromKey && /^[0-9a-f]{64}$/i.test(fromKey)) return fromKey;
  const agentId = (payload as DartcHelloPayload | undefined)?.agent_id;
  const payloadKey = agentId?.split(":").at(-1);
  return payloadKey && /^[0-9a-f]{64}$/i.test(payloadKey) ? payloadKey : null;
}

function conversationMemoryKey(podId: string, conversationId: string): string {
  return `${podId}:${conversationId}`;
}

function agentCardForSession(session: DartcPeerSession): A2AAgentCard {
  const manifest = session.manifest;
  return {
    protocolVersion: "0.2.2",
    name: manifest?.name ?? selectedPodId,
    description: manifest?.persona ?? "A GemmaPod origin agent reachable over DARTC/WebRTC.",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: "gemmapod-chat",
        name: "GemmaPod chat",
        description: "Accepts signed chat requests and returns streamed model responses.",
        tags: ["gemmapod", "dartc", "webrtc", "gemma"],
      },
      ...(manifest?.tools ?? []).map((tool) => ({
        id: `tool:${tool.name}`,
        name: tool.name,
        description: tool.description,
        tags: ["tool", "signed-manifest"],
      })),
    ],
    provider: {
      organization: "GemmaPod Project",
      url: "https://gemmapod.com",
    },
    extensions: [
      {
        uri: "https://gemmapod.com/protocols/dartc",
        version: "0.2",
        topics: ["dartc.hello", "a2a.discovery", "gemmapod.chat.request", "gemmapod.ui.event"],
      },
      {
        uri: "https://gemmapod.com/extensions/signed-manifest",
        version: "1",
        pod_id: manifest?.transport?.webrtc?.pod_id ?? manifest?.id ?? selectedPodId,
        owner_pubkey: manifest?.owner_pubkey,
      },
    ],
  };
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

let activePeers = new Map<string, RTCPeerConnection>();
let pendingCandidatesBySession = new Map<string, RTCIceCandidateInit[]>();
let ws: WebSocket | null = null;
let reconnectAttempt = 0;

function connect(): void {
  console.log(`[origin] connecting to ${SIGNAL_URL} (pod=${selectedPodId})…`);
  
  const signalUrlObj = new URL(SIGNAL_URL);
  const origin = signalUrlObj.protocol === "wss:" ? `https://${signalUrlObj.host}` : `http://${signalUrlObj.host}`;
  
  ws = new WebSocket(SIGNAL_URL, {
    headers: {
      origin,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });



  ws.on("open", () => {
    reconnectAttempt = 0;
    console.log(`[origin] signaling connected; registering pod ${selectedPodId}`);
    ws!.send(JSON.stringify({ t: "register", podId: selectedPodId } satisfies SignalMsg));
  });

  ws.on("message", async (raw) => {
    let msg: SignalMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.t === "registered") {
      console.log(`[origin] registered for pod ${msg.podId}`);
      return;
    }
    if (msg.t === "offer") {
      console.log(`[origin] offer session=${msg.sessionId} (${msg.sdp.length} bytes)`);
      try {
        const { sdp } = await negotiate(msg.sdp, msg.sessionId, (signal) => {
          ws!.send(JSON.stringify(signal));
        });
        ws!.send(JSON.stringify({ t: "answer", sessionId: msg.sessionId, sdp } satisfies SignalMsg));
      } catch (e) {
        activePeers.delete(msg.sessionId);
        pendingCandidatesBySession.delete(msg.sessionId);
        ws!.send(
          JSON.stringify({
            t: "error",
            sessionId: msg.sessionId,
            message: (e as Error).message,
          } satisfies SignalMsg),
        );
      }
      return;
    }
    if (msg.t === "candidate") {
      const pc = activePeers.get(msg.sessionId);
      if (!pc || !pc.remoteDescription) {
        const queued = pendingCandidatesBySession.get(msg.sessionId) ?? [];
        queued.push(msg.candidate);
        pendingCandidatesBySession.set(msg.sessionId, queued);
        return;
      }
      pc.addIceCandidate(msg.candidate).catch((e) => {
        console.warn(`[origin] failed to add ICE candidate session=${msg.sessionId}:`, e);
      });
      return;
    }
    if (msg.t === "error") {
      console.warn(`[origin] cloud error: ${msg.message}`);
    }
  });

  ws.on("close", (code) => {
    console.log(`[origin] signaling closed (${code})`);
    ws = null;
    scheduleReconnect();
  });

  ws.on("error", (e) => {
    console.warn(`[origin] signaling error: ${e.message}`);
  });
}

function scheduleReconnect(): void {
  reconnectAttempt++;
  const wait = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempt, 6));
  setTimeout(connect, wait);
}

bootstrap();

// Periodic prune of closed peers to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [sid, pc] of activePeers) {
    if (pc.connectionState === "closed" || pc.connectionState === "failed") {
      activePeers.delete(sid);
      pendingCandidatesBySession.delete(sid);
    }
  }
  conversations.pruneOlderThan(now - CONVERSATION_TTL_MS);
}, 30_000);

console.log(`[origin] proxying to Ollama at ${OLLAMA_URL} using model ${selectedModel}`);
