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
  agentCardFromManifest,
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
import { buildToolRuntime, type VerifiedPodManifest } from "./toolRuntime.js";
import { ConversationStore } from "./conversationStore.js";
import { getMastraInstance } from "./mastra/index.js";
import { createDashboardServer, pushEvent, type DashboardState } from "./dashboard/server.js";

type SignalMsg =
  | { t: "register"; podId: string; ownerToken?: string }
  | { t: "registered"; podId: string }
  | { t: "offer"; sessionId: string; sdp: string }
  | { t: "answer"; sessionId: string; sdp: string }
  | { t: "candidate"; sessionId: string; candidate: RTCIceCandidateInit }
  | { t: "error"; sessionId?: string; message: string };

function toWsUrl(url: string): string {
  return url.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONVERSATION_MESSAGES = 80;

const _require = createRequire(import.meta.url);

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

export interface DaemonConfig {
  podId: string;
  signalUrl: string;
  ollamaUrl: string;
  model: string;
  ownerPubkey?: string;
  contactJson?: string;
  dbPath?: string;
}

interface DaemonState {
  ollamaUrl: string;
  signalUrl: string;
  selectedModel: string;
  selectedPodId: string;
  coreModule: GemmaPodCoreModule | null;
  conversations: ConversationStore;
  activePeers: Map<string, RTCPeerConnection>;
  pendingCandidatesBySession: Map<string, RTCIceCandidateInit[]>;
  ws: WebSocket | null;
  reconnectAttempt: number;
  dashboard: DashboardState;
}

async function handleChat(
  req: GemmaPodChatRequest,
  session: DartcPeerSession,
  state: DaemonState,
): Promise<void> {
  const toolRuntime = buildToolRuntime(req.signedManifestB64, state.selectedPodId);
  const modelToUse = state.selectedModel || toolRuntime.manifest?.model || "gemma4:e4b";
  const conversationId = req.conversation_id ?? session.conversationId ?? `session:${session.originKey.publicKey}`;
  const runId = req.request_id;
  const messageId = `${runId}:assistant`;
  const memoryKey = conversationId ? conversationMemoryKey(state.selectedPodId, conversationId) : null;
  const remembered = memoryKey ? state.conversations.get(memoryKey)?.messages ?? [] : [];
  const incomingMessages = req.messages.filter((m) => m.role !== "system");
  const conversationMessages =
    incomingMessages.length > 1 || remembered.length === 0
      ? incomingMessages
      : [...remembered, ...incomingMessages];

  console.log(
    `[origin] chat request using model: ${modelToUse} (${conversationMessages.length} messages, ${toolRuntime.tools.length} signed tools, conversation=${conversationId ?? "none"})`,
  );

  try {
    const prompt = latestUserPrompt(incomingMessages);
    state.dashboard.status = "running";
    state.dashboard.totalMessages += incomingMessages.length;

    // Push user message to dashboard
    const lastUserMsg = incomingMessages[incomingMessages.length - 1];
    if (lastUserMsg?.role === "user") {
      pushEvent({
        id: `user-${runId}`,
        type: "user",
        content: lastUserMsg.content,
        timestamp: Date.now(),
        metadata: { conversationId, runId },
      });
    }

    // ── UI: run started ──
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

    // ── Mastra-powered agent streaming ──
    const systemPrompt = toolRuntime.manifest?.system_prompt ?? "You are a helpful assistant.";

    const mastra = getMastraInstance({
      ollamaUrl: state.ollamaUrl,
      model: modelToUse,
      systemPrompt,
      manifest: toolRuntime.manifest,
      toolRuntime,
    });

    const agent = mastra.getAgent("gemmapod-agent");

    // Convert messages to Mastra format (filter out system since it's in instructions)
    const mastraMessages = conversationMessages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    const response = await agent.stream(mastraMessages);

    let assistantContent = "";
    let chunkCount = 0;

    // Consume the full stream
    const reader = response.fullStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Handle different chunk types
        if (value && typeof value === "object") {
          const chunk = value as any;

          if (chunk.type === "text-delta" && chunk.textDelta) {
            chunkCount++;
            const delta = chunk.textDelta;
            assistantContent += delta;

            if (chunkCount === 1) {
              console.log(`[origin] first content chunk received: ${JSON.stringify(delta)}`);
              await sendCompanionEvent(session, conversationId, runId, "companion.react", {
                mood: "presenting",
                stage: "presenting-left",
                expression: "talking",
                text: "Response is streaming into the page.",
              }, { stream: true, chunk_id: chunkCount, is_final: false });
            }

            await session.sendUiEvent({
              type: "TEXT_MESSAGE_CONTENT",
              threadId: conversationId,
              runId,
              messageId,
              delta,
            }, {
              stream: true,
              chunk_id: chunkCount,
              is_final: false,
            });

            await session.sendDartc<GemmaPodChatDelta>("gemmapod.chat.delta", {
              request_id: runId,
              delta,
            }, {
              stream: true,
              chunk_id: chunkCount,
              is_final: false,
            });
          } else if (chunk.type === "tool-call") {
            console.log(`[origin] tool call: ${chunk.toolName}`);
            pushEvent({
              id: `tool-${chunk.toolCallId}`,
              type: "tool_call",
              content: `Calling tool: ${chunk.toolName}`,
              timestamp: Date.now(),
              metadata: { toolName: chunk.toolName, toolCallId: chunk.toolCallId, conversationId, runId },
            });
            await session.sendUiEvent({
              type: "TOOL_CALL_START",
              threadId: conversationId,
              runId,
              toolCallId: chunk.toolCallId,
              toolCallName: chunk.toolName,
              parentMessageId: messageId,
            }, { stream: true });
          } else if (chunk.type === "tool-result") {
            const resultStr = typeof chunk.result === "string" ? chunk.result : JSON.stringify(chunk.result);
            pushEvent({
              id: `result-${chunk.toolCallId}`,
              type: "tool_result",
              content: resultStr,
              timestamp: Date.now(),
              metadata: { toolName: chunk.toolName, toolCallId: chunk.toolCallId, conversationId, runId },
            });
            await session.sendUiEvent({
              type: "TOOL_CALL_RESULT",
              threadId: conversationId,
              runId,
              messageId: `${runId}:tool:${chunk.toolCallId}`,
              toolCallId: chunk.toolCallId,
              role: "tool",
              content: resultStr,
            }, { stream: true });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    console.log(`[origin] chat done (chunks: ${chunkCount})`);

    // ── UI: finalize ──
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

    await session.sendDartc<GemmaPodChatDone>("gemmapod.chat.done", {
      request_id: runId,
    }, {
      stream: true,
      is_final: true,
    });

    await session.sendUiEvent({ type: "RUN_FINISHED", threadId: conversationId, runId }, {
      stream: true,
      is_final: true,
    });

    // ── Persist conversation ──
    if (memoryKey) {
      state.conversations.set(memoryKey, {
        messages: [...conversationMessages, { role: "assistant", content: assistantContent }]
          .slice(-MAX_CONVERSATION_MESSAGES),
        updatedAt: Date.now(),
      });
    }

    // Push assistant response to dashboard
    if (assistantContent) {
      pushEvent({
        id: `assistant-${runId}`,
        type: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        metadata: { conversationId, runId, chunks: chunkCount },
      });
    }

    state.dashboard.status = "idle";
  } catch (e) {
    console.error(`[origin] mastra agent failed:`, e);
    state.dashboard.status = "error";
    state.dashboard.lastError = (e as Error).message;
    pushEvent({
      id: `error-${runId}`,
      type: "error",
      content: (e as Error).message,
      timestamp: Date.now(),
      metadata: { conversationId, runId, code: "chat_failed" },
    });
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



async function negotiate(
  offerSdp: string,
  sessionId: string,
  sendSignal: (msg: SignalMsg) => void,
  state: DaemonState,
): Promise<{ sdp: string; pc: RTCPeerConnection }> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  state.activePeers.set(sessionId, pc);

  pc.addEventListener("icecandidate", (ev) => {
    const candidate = (ev as RTCPeerConnectionIceEvent).candidate;
    if (!candidate) return;
    const json = typeof candidate.toJSON === "function" ? candidate.toJSON() : candidate;
    sendSignal({ t: "candidate", sessionId, candidate: json });
  });

  pc.addEventListener("datachannel", (ev) => {
    const dc = (ev as RTCDataChannelEvent).channel;
    console.log(`[origin] data channel created: ${dc.label} (${dc.readyState})`);
    const session = createDartcPeerSession(dc, state);
    const sendHello = () => {
      console.log(`[origin] data channel open: ${dc.label}`);
      session.sendDartc<DartcHelloPayload>("dartc.hello", {
        role: "origin",
        pod_id: state.selectedPodId,
        agent_id: `origin:${session.originKey.publicKey}`,
        protocol_versions: { dartc: "0.2", a2a: "0.2.2" },
        supported_topics: ["dartc.*", "gemmapod.chat.*", "gemmapod.ui.event", "a2a.discovery"],
      }, { requires_ack: true }).catch((e) => {
        console.error("[origin] failed to send DARTC hello:", e);
      });
    };
    if (dc.readyState === "open") {
      sendHello();
      pushEvent({
        id: `peer-${sessionId}`,
        type: "system",
        content: `Peer connected: ${sessionId.slice(0, 8)}...`,
        timestamp: Date.now(),
        metadata: { sessionId, podId: state.selectedPodId },
      });
    } else {
      dc.addEventListener("open", () => {
        sendHello();
        pushEvent({
          id: `peer-${sessionId}`,
          type: "system",
          content: `Peer connected: ${sessionId.slice(0, 8)}...`,
          timestamp: Date.now(),
          metadata: { sessionId, podId: state.selectedPodId },
        });
      }, { once: true });
    }

    dc.addEventListener("message", async (msgEv) => {
      await handleDartcFrame(session, (msgEv as MessageEvent).data as string, state);
    });
  });

  await pc.setRemoteDescription({ sdp: offerSdp, type: "offer" });
  const queued = state.pendingCandidatesBySession.get(sessionId);
  if (queued) {
    state.pendingCandidatesBySession.delete(sessionId);
    await Promise.all(queued.map((candidate) => pc.addIceCandidate(candidate)));
  }
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  return { sdp: pc.localDescription!.sdp, pc };
}

function createDartcPeerSession(dc: RTCDataChannel, state: DaemonState): DartcPeerSession {
  const key = generateSessionKey(state);
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
        bytesToB64(loadCore(state).GemmaPodCore.signBytes(bytes, key.secretKey)),
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
        bytesToB64(loadCore(state).GemmaPodCore.signBytes(bytes, key.secretKey)),
      );
      dc.send(JSON.stringify(signed));
    },
  };
  return session;
}

async function handleDartcFrame(session: DartcPeerSession, raw: string, state: DaemonState): Promise<void> {
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
  if (!publicKey || !(await verifyDartc(envelope, publicKey, state))) {
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
    if (payload?.pod_id && payload.pod_id !== state.selectedPodId) {
      await session.sendDartc("dartc.error", {
        code: "pod_mismatch",
        message: `expected pod ${state.selectedPodId}`,
        fatal: true,
      });
      return;
    }
    if (session.signedManifestB64) {
      try {
        session.manifest = buildToolRuntime(session.signedManifestB64, state.selectedPodId).manifest ?? undefined;
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
      card: agentCardForSession(session, state),
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
    console.log(`[origin] DARTC chat request id=${payload.request_id}`);
    await handleChat(payload, session, state);
    return;
  }

  if (envelope.topic === "dartc.ack") return;

  await session.sendDartc("dartc.error", {
    code: "unsupported_topic",
    message: `unsupported DARTC topic: ${envelope.topic}`,
  });
}

function loadCore(state: DaemonState): GemmaPodCoreModule {
  if (!state.coreModule) {
    state.coreModule = _require("@gemmapod/core/node") as GemmaPodCoreModule;
  }
  return state.coreModule;
}

function generateSessionKey(state: DaemonState): SessionKey {
  const key = loadCore(state).GemmaPodCore.generateKey();
  return { publicKey: key.publicKey, secretKey: hexToBytes(key.secretKey) };
}

async function verifyDartc(envelope: DartcEnvelope, publicKeyHex: string, state: DaemonState): Promise<boolean> {
  return verifyEnvelope(envelope, (bytes, signature) =>
    loadCore(state).GemmaPodCore.verifyBytes(bytes, b64ToBytes(signature), hexToBytes(publicKeyHex)),
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

function agentCardForSession(session: DartcPeerSession, state: DaemonState): A2AAgentCard {
  const manifest = session.manifest;
  return agentCardFromManifest(
    manifest ?? { name: state.selectedPodId, model: state.selectedModel },
  );
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

function connect(state: DaemonState): void {
  console.log(`[origin] connecting to ${state.signalUrl} (pod=${state.selectedPodId})…`);

  const signalUrlObj = new URL(state.signalUrl);
  const secure = signalUrlObj.protocol === "wss:" || signalUrlObj.protocol === "https:";
  const origin = `${secure ? "https" : "http"}://${signalUrlObj.host}`;

  state.ws = new WebSocket(toWsUrl(state.signalUrl), {
    headers: {
      origin,
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });

  state.ws.on("open", () => {
    state.reconnectAttempt = 0;
    console.log(`[origin] signaling connected; registering pod ${state.selectedPodId}`);
    state.ws!.send(JSON.stringify({ t: "register", podId: state.selectedPodId } satisfies SignalMsg));
  });

  state.ws.on("message", async (raw) => {
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
          state.ws!.send(JSON.stringify(signal));
        }, state);
        state.ws!.send(JSON.stringify({ t: "answer", sessionId: msg.sessionId, sdp } satisfies SignalMsg));
      } catch (e) {
        state.activePeers.delete(msg.sessionId);
        state.pendingCandidatesBySession.delete(msg.sessionId);
        state.ws!.send(
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
      const pc = state.activePeers.get(msg.sessionId);
      if (!pc || !pc.remoteDescription) {
        const queued = state.pendingCandidatesBySession.get(msg.sessionId) ?? [];
        queued.push(msg.candidate);
        state.pendingCandidatesBySession.set(msg.sessionId, queued);
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

  state.ws.on("close", (code) => {
    console.log(`[origin] signaling closed (${code})`);
    state.ws = null;
    scheduleReconnect(state);
  });

  state.ws.on("error", (e) => {
    console.warn(`[origin] signaling error: ${e.message}`);
  });
}

function scheduleReconnect(state: DaemonState): void {
  state.reconnectAttempt++;
  const wait = Math.min(30_000, 500 * 2 ** Math.min(state.reconnectAttempt, 6));
  setTimeout(() => connect(state), wait);
}

export async function startDaemon(config: DaemonConfig): Promise<string | undefined> {
  if (config.ownerPubkey) process.env.OWNER_PUBKEY = config.ownerPubkey;
  if (config.contactJson) process.env.GEMMAPOD_CONTACT_JSON = config.contactJson;

  const dashboardState: DashboardState = {
    podId: config.podId,
    model: config.model,
    ollamaUrl: config.ollamaUrl,
    signalUrl: config.signalUrl,
    conversations: new ConversationStore(config.dbPath),
    activePeerCount: 0,
    totalMessages: 0,
    status: "idle",
  };

  const state: DaemonState = {
    ollamaUrl: config.ollamaUrl,
    signalUrl: config.signalUrl,
    selectedModel: config.model,
    selectedPodId: config.podId,
    coreModule: null,
    conversations: new ConversationStore(config.dbPath),
    activePeers: new Map(),
    pendingCandidatesBySession: new Map(),
    ws: null,
    reconnectAttempt: 0,
    dashboard: dashboardState,
  };

  // Start dashboard server
  const dashboard = createDashboardServer(dashboardState);
  const dashboardPort = await dashboard.start();
  const dashboardUrl = `http://localhost:${dashboardPort}`;

  console.log(`[origin] proxying to Ollama at ${config.ollamaUrl} using model ${config.model}`);
  connect(state);
  setInterval(() => {
    const now = Date.now();
    for (const [sid, pc] of state.activePeers) {
      if (pc.connectionState === "closed" || pc.connectionState === "failed") {
        state.activePeers.delete(sid);
        state.pendingCandidatesBySession.delete(sid);
      }
    }
    state.conversations.pruneOlderThan(now - CONVERSATION_TTL_MS);
    // Update dashboard stats
    state.dashboard.activePeerCount = state.activePeers.size;
  }, 30_000);

  return dashboardUrl;
}

async function bootstrapInteractive(): Promise<void> {
  const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const signalUrl = process.env.SIGNAL_URL ?? "wss://signal.gemmapod.com/signal";
  console.log(`[origin] checking Ollama at ${ollamaUrl}...`);
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`);
    const data = await res.json() as { models: Array<{ name: string }> };
    const models = data.models.map(m => m.name);
    if (models.length === 0) {
      console.warn("[origin] no models found in Ollama. Please run 'ollama pull gemma4:e4b' first.");
      process.exit(1);
    }
    const modelPrompt = new (enquirer as any).Select({
      name: 'model',
      message: 'Select an Ollama model to serve:',
      choices: models
    });
    const model = await modelPrompt.run() as string;
    console.log(`[origin] selected model: ${model}`);
    let podId = process.env.POD_ID ?? "";
    if (!podId) {
      const input = new (enquirer as any).Input({
        message: 'Enter Pod ID to register (e.g. raj-card):',
        initial: 'raj-card'
      });
      podId = await input.run() as string;
    }
    console.log(`[origin] using Pod ID: ${podId}`);
    await startDaemon({ podId, signalUrl, ollamaUrl, model });
  } catch (e) {
    console.error(`[origin] failed to reach Ollama:`, e);
    process.exit(1);
  }
}

// Run interactively when executed as main script (preserves gemmapod-origin bin behavior)
const _isMain = process.argv[1]?.endsWith("/daemon.js") || process.argv[1]?.endsWith("/daemon.ts");
if (_isMain) {
  bootstrapInteractive().catch((e) => { console.error("[origin]", e); process.exit(1); });
}
