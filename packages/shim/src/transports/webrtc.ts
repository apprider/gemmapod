import {
  createEnvelope,
  parseEnvelope,
  signEnvelope,
  verifyEnvelope,
  type A2ADiscoveryPayload,
  type A2AAgentCard,
  type DartcEnvelope,
  type DartcHelloPayload,
  DARTC_UI_EVENT_TOPIC,
  isDartcUiEventPayload,
  type DartcUiEvent,
  type GemmaPodChatDelta,
  type GemmaPodChatDone,
  type GemmaPodChatRequest,
} from "@gemmapod/dartc";
import { coreReady, generateKey, signBytes, verifyBytes } from "../core";
import type { ChatChunk, ChatMessage, Transport } from "../types";

type SignalMsg =
  | { t: "offer"; podId: string; sessionId: string; sdp: string }
  | { t: "answer"; sessionId: string; sdp: string }
  | { t: "candidate"; podId?: string; sessionId: string; candidate: RTCIceCandidateInit }
  | { t: "error"; sessionId?: string; message: string };

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];
const SIGNAL_TIMEOUT_MS = 20_000;
const DATA_CHANNEL_TIMEOUT_MS = 15_000;
const DARTC_HELLO_TIMEOUT_MS = 10_000;
const A2A_DISCOVERY_TIMEOUT_MS = 10_000;

export type WebRtcConnectStage =
  | "webrtc-offer"
  | "ice-gathering"
  | "signaling"
  | "data-channel-open"
  | "dartc-hello-sent"
  | "dartc-origin-hello"
  | "signed-frame-verified"
  | "a2a-card-sent"
  | "a2a-card-received"
  | "ready";

export interface WebRtcConnectEvent {
  stage: WebRtcConnectStage;
  detail?: string;
}

export type WebRtcConnectObserver = (event: WebRtcConnectEvent) => void;
export type DartcUiEventObserver = (event: DartcUiEvent) => void;
export type A2AAgentCardObserver = (card: A2AAgentCard) => void;

interface Pending {
  push(chunk: ChatChunk): void;
  fail(err: Error): void;
}

interface SessionKey {
  publicKey: string;
  secretKey: Uint8Array;
}

export class WebRtcTransport implements Transport {
  readonly name = "webrtc";
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel;
  private pending = new Map<string, Pending>();
  private opened: Promise<void>;
  private nextId = 0;
  private signedManifestB64?: string;
  private sessionKey?: SessionKey;
  private originPublicKey?: string;
  private readonly podId: string;
  private readonly conversationId?: string;
  private peerAgentCard?: A2AAgentCard;
  private readonly observe?: WebRtcConnectObserver;
  private readonly uiEventObservers = new Set<DartcUiEventObserver>();
  private readonly agentCardObservers = new Set<A2AAgentCardObserver>();
  private inboundFrames: Promise<void> = Promise.resolve();
  private originHello: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  };
  private originAgentCard: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (err: Error) => void;
  };

  constructor(
    signalUrl: string,
    podId: string,
    conversationId?: string,
    signedManifestB64?: string,
    observe?: WebRtcConnectObserver,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.dc = this.pc.createDataChannel("dartc.v0");
    this.podId = podId;
    this.conversationId = conversationId;
    this.signedManifestB64 = signedManifestB64;
    this.observe = observe;
    let resolveOriginHello!: () => void;
    let rejectOriginHello!: (err: Error) => void;
    this.originHello = {
      promise: new Promise<void>((resolve, reject) => {
        resolveOriginHello = resolve;
        rejectOriginHello = reject;
      }),
      resolve: resolveOriginHello,
      reject: rejectOriginHello,
    };
    let resolveOriginAgentCard!: () => void;
    let rejectOriginAgentCard!: (err: Error) => void;
    this.originAgentCard = {
      promise: new Promise<void>((resolve, reject) => {
        resolveOriginAgentCard = resolve;
        rejectOriginAgentCard = reject;
      }),
      resolve: resolveOriginAgentCard,
      reject: rejectOriginAgentCard,
    };
    this.dc.addEventListener("message", (e) => this.enqueueMessage(e.data));
    this.opened = this.handshake(signalUrl, podId).then(() => this.openDartcSession());
  }

  private async handshake(signalUrl: string, podId: string): Promise<void> {
    this.emit("webrtc-offer", "creating browser offer");
    const sessionId = crypto.randomUUID();
    const ws = new WebSocket(signalUrl);
    await new Promise<void>((resolve, reject) => {
      const pendingSignals: SignalMsg[] = [];
      let offerSent = false;
      let remoteReady = false;
      const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
      const sendSignal = (msg: SignalMsg) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        } else {
          pendingSignals.push(msg);
        }
      };
      const flushPendingSignals = () => {
        for (const msg of pendingSignals.splice(0)) {
          sendSignal(msg);
        }
      };
      const addRemoteCandidate = async (candidate: RTCIceCandidateInit) => {
        if (!remoteReady) {
          pendingRemoteCandidates.push(candidate);
          return;
        }
        await this.pc.addIceCandidate(candidate);
      };

      const timer = setTimeout(() => {
        reject(new Error("signal timeout"));
        try {
          ws.close();
        } catch {
          /* noop */
        }
      }, SIGNAL_TIMEOUT_MS);

      this.pc.addEventListener("icecandidate", (ev) => {
        if (!ev.candidate) return;
        this.emit("ice-gathering", "trickling ICE candidate");
        const msg: SignalMsg = {
          t: "candidate",
          podId,
          sessionId,
          candidate: ev.candidate.toJSON(),
        };
        if (offerSent) {
          sendSignal(msg);
        } else {
          pendingSignals.push(msg);
        }
      });

      ws.addEventListener("open", () => {
        this.pc.createOffer()
          .then((offer) => this.pc.setLocalDescription(offer))
          .then(() => {
            const local = this.pc.localDescription;
            if (!local) throw new Error("no local description");
            this.emit("signaling", "sending offer to origin");
            sendSignal({ t: "offer", podId, sessionId, sdp: local.sdp });
            offerSent = true;
            flushPendingSignals();
          })
          .catch((err) => reject(err));
      });
      ws.addEventListener("message", (ev) => {
        let msg: SignalMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.t === "answer" && msg.sessionId === sessionId) {
          clearTimeout(timer);
          this.pc.setRemoteDescription({ sdp: msg.sdp, type: "answer" })
            .then(async () => {
              remoteReady = true;
              await Promise.all(
                pendingRemoteCandidates.splice(0).map((candidate) => this.pc.addIceCandidate(candidate)),
              );
              resolve();
            })
            .catch((err) => reject(err));
        } else if (msg.t === "candidate" && msg.sessionId === sessionId) {
          addRemoteCandidate(msg.candidate).catch((err) => reject(err));
        } else if (msg.t === "error") {
          clearTimeout(timer);
          ws.close();
          reject(new Error(msg.message));
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("signaling socket error"));
      });
    });

    await new Promise<void>((resolve, reject) => {
      if (this.dc.readyState === "open") return resolve();
      this.dc.addEventListener("open", () => resolve(), { once: true });
      this.dc.addEventListener("error", () => reject(new Error("dc error")), { once: true });
      setTimeout(() => reject(new Error("dc open timeout")), DATA_CHANNEL_TIMEOUT_MS);
    });
    ws.close();
    this.emit("data-channel-open", "WebRTC data channel open");
  }

  private async openDartcSession(): Promise<void> {
    await coreReady();
    const key = generateKey();
    this.sessionKey = { publicKey: key.publicKey, secretKey: hexToBytes(key.secretKey) };
    await this.sendSigned(
      createEnvelope<DartcHelloPayload>({
        from: `visitor:${key.publicKey}`,
        to: `pod:${this.podId}:origin`,
        topic: "dartc.hello",
        dartc: { requires_ack: true },
        payload: {
          role: "visitor",
          pod_id: this.podId,
          conversation_id: this.conversationId,
          agent_id: `visitor:${key.publicKey}`,
          protocol_versions: { dartc: "0.2", a2a: "0.2.2" },
          supported_topics: ["dartc.*", "gemmapod.chat.*", "gemmapod.ui.event", "a2a.discovery"],
          signedManifestB64: this.signedManifestB64,
        },
      }),
    );
    this.emit("dartc-hello-sent", "sent signed visitor hello");
    await withTimeout(this.originHello.promise, DARTC_HELLO_TIMEOUT_MS, "origin DARTC hello timeout");
    await this.sendVisitorAgentCard();
    this.emit("a2a-card-sent", "sent browser Agent Card");
    await withTimeout(this.originAgentCard.promise, A2A_DISCOVERY_TIMEOUT_MS, "origin A2A Agent Card timeout");
    this.emit("ready", this.peerAgentCard ? `ready with ${this.peerAgentCard.name}` : "ready");
  }

  private async sendSigned<TPayload>(envelope: ReturnType<typeof createEnvelope<TPayload>>): Promise<void> {
    if (!this.sessionKey) throw new Error("DARTC session key not ready");
    const signed = await signEnvelope(envelope, (bytes) =>
      bytesToB64(signBytes(bytes, this.sessionKey!.secretKey)),
    );
    this.dc.send(JSON.stringify(signed));
  }

  private enqueueMessage(raw: unknown): void {
    this.inboundFrames = this.inboundFrames
      .then(() => this.onMessage(raw))
      .catch((e) => {
        console.error("[shim] DARTC message handler failed", e);
      });
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: DartcEnvelope;
    try {
      msg = parseEnvelope(raw);
    } catch (e) {
      console.error("[shim] invalid DARTC frame", e);
      return;
    }

    if (msg.topic === "dartc.hello") {
      const publicKey = publicKeyFromAgent(msg.from, msg.payload);
      if (!publicKey || !(await verifyDartc(msg, publicKey))) {
        console.error("[shim] rejected origin hello: invalid signature");
        return;
      }
      this.originPublicKey = publicKey;
      this.emit("signed-frame-verified", "verified origin hello signature");
      this.originHello.resolve();
      this.emit("dartc-origin-hello", "DARTC hello from origin");
      return;
    }

    if (!this.originPublicKey || !(await verifyDartc(msg, this.originPublicKey))) {
      console.error("[shim] rejected DARTC frame: invalid origin signature");
      return;
    }

    if (msg.topic === "dartc.ack") return;

    if (msg.topic === DARTC_UI_EVENT_TOPIC) {
      if (isDartcUiEventPayload(msg.payload)) {
        this.emitUiEvent(msg.payload.event);
      }
      return;
    }

    if (msg.topic === "a2a.discovery") {
      const payload = msg.payload as A2ADiscoveryPayload | undefined;
      if (payload?.kind === "AgentCard") {
        this.peerAgentCard = payload.card;
        console.log("[shim] received A2A Agent Card:", payload.card.name);
        this.emitAgentCard(payload.card);
        this.emit("a2a-card-received", `received ${payload.card.name}`);
        this.originAgentCard.resolve();
      }
      return;
    }

    if (msg.topic === "gemmapod.chat.delta") {
      const payload = msg.payload as GemmaPodChatDelta | undefined;
      if (!payload) return;
      this.pending.get(payload.request_id)?.push({ delta: payload.delta, done: false });
      return;
    }

    if (msg.topic === "gemmapod.chat.done") {
      const payload = msg.payload as GemmaPodChatDone | undefined;
      if (!payload) return;
      const pending = this.pending.get(payload.request_id);
      pending?.push({ delta: "", done: true });
      this.pending.delete(payload.request_id);
      return;
    }

    if (msg.topic === "dartc.error") {
      const payload = msg.payload as { message?: string; request_id?: string } | undefined;
      const err = new Error(payload?.message ?? "DARTC error");
      if (payload?.request_id) {
        this.pending.get(payload.request_id)?.fail(err);
        this.pending.delete(payload.request_id);
      } else {
        for (const [id, pending] of this.pending) {
          pending.fail(err);
          this.pending.delete(id);
        }
      }
    }
  }

  async *chat(messages: ChatMessage[], model: string): AsyncIterable<ChatChunk> {
    await this.opened;
    const id = String(++this.nextId);

    const queue: ChatChunk[] = [];
    let waiter: ((v: IteratorResult<ChatChunk>) => void) | null = null;
    let error: Error | null = null;
    let closed = false;

    const flush = () => {
      if (!waiter) return;
      if (error || closed || queue.length > 0) {
        const w = waiter;
        waiter = null;
        w({ value: undefined as any, done: true });
      }
    };

    this.pending.set(id, {
      push: (c) => {
        queue.push(c);
        if (c.done) closed = true;
        flush();
      },
      fail: (e) => {
        error = e;
        closed = true;
        flush();
      },
    });

    await this.sendSigned(
      createEnvelope<GemmaPodChatRequest>({
        from: `visitor:${this.sessionKey!.publicKey}`,
        to: `pod:${this.podId}:origin`,
        topic: "gemmapod.chat.request",
        dartc: { stream: true },
        payload: {
          request_id: id,
          conversation_id: this.conversationId,
          model,
          messages,
          signedManifestB64: this.signedManifestB64,
        },
      }),
    );

    try {
      while (true) {
        if (error) throw error;
        const c = queue.shift();
        if (c) {
          if (c.done) return;
          yield c;
        } else if (closed) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            waiter = resolve as any;
          });
        }
      }
    } finally {
      this.pending.delete(id);
    }
  }

  close(): void {
    this.dc.close();
    this.pc.close();
  }

  onUiEvent(observer: DartcUiEventObserver): () => void {
    this.uiEventObservers.add(observer);
    return () => this.uiEventObservers.delete(observer);
  }

  onAgentCard(observer: A2AAgentCardObserver): () => void {
    this.agentCardObservers.add(observer);
    if (this.peerAgentCard) observer(this.peerAgentCard);
    return () => this.agentCardObservers.delete(observer);
  }

  private async sendVisitorAgentCard(): Promise<void> {
    await this.sendSigned(
      createEnvelope<A2ADiscoveryPayload>({
        from: `visitor:${this.sessionKey!.publicKey}`,
        to: `pod:${this.podId}:origin`,
        topic: "a2a.discovery",
        payload: {
          kind: "AgentCard",
          card: {
            protocolVersion: "0.2.2",
            name: "GemmaPod browser visitor",
            description: "A browser session connected to a GemmaPod over DARTC/WebRTC.",
            capabilities: {
              streaming: true,
              pushNotifications: false,
              stateTransitionHistory: false,
            },
            skills: [
              {
                id: "gemmapod-chat-client",
                name: "GemmaPod chat client",
                description: "Can send signed chat requests and receive streamed DARTC responses.",
                tags: ["dartc", "webrtc", "browser"],
              },
            ],
            extensions: [
              {
                uri: "https://gemmapod.com/protocols/dartc",
                version: "0.2",
                topics: ["gemmapod.chat.request", "gemmapod.ui.event", "a2a.discovery"],
              },
            ],
          },
        },
      }),
    );
  }

  private emit(stage: WebRtcConnectStage, detail?: string): void {
    this.observe?.({ stage, detail });
  }

  private emitUiEvent(event: DartcUiEvent): void {
    for (const observer of this.uiEventObservers) observer(event);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gemmapod:ui-event", { detail: event }));
    }
  }

  private emitAgentCard(card: A2AAgentCard): void {
    for (const observer of this.agentCardObservers) observer(card);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gemmapod:a2a-card", { detail: card }));
    }
  }
}

async function verifyDartc(envelope: DartcEnvelope, publicKeyHex: string): Promise<boolean> {
  await coreReady();
  return verifyEnvelope(envelope, (bytes, signature) =>
    verifyBytes(bytes, b64ToBytes(signature), hexToBytes(publicKeyHex)),
  );
}

function publicKeyFromAgent(from: string, payload: unknown): string | null {
  const fromKey = from.split(":").at(-1);
  if (fromKey && /^[0-9a-f]{64}$/i.test(fromKey)) return fromKey;
  const agentId = (payload as DartcHelloPayload | undefined)?.agent_id;
  const payloadKey = agentId?.split(":").at(-1);
  return payloadKey && /^[0-9a-f]{64}$/i.test(payloadKey) ? payloadKey : null;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
