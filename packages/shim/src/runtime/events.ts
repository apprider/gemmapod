import type { A2AAgentCard, DartcUiEvent } from "@gemmapod/dartc";
import type { ChatChunk, ChatMessage, PodConfig, Transport } from "../types";
import type { WebRtcConnectEvent } from "../transports/webrtc";
import type { RuntimeStateStore } from "./state";

export type RuntimeTransportStatus = "idle" | "connecting" | "ready" | "error" | "destroyed";

export interface RuntimeTransportState {
  status: RuntimeTransportStatus;
  name?: string;
  trace: string[];
  error?: string;
  webrtcEvents: WebRtcConnectEvent[];
}

export interface RuntimeChatInput {
  messages?: ChatMessage[];
  text?: string;
  model?: string;
  conversationId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface RuntimeChatApi {
  stream(input: string | RuntimeChatInput): AsyncIterable<ChatChunk>;
  send(input: string | RuntimeChatInput): Promise<string>;
  history(): ChatMessage[];
  setHistory(messages: ChatMessage[]): void;
  clear(): Promise<void>;
}

export interface RuntimeA2AApi {
  readonly card?: A2AAgentCard;
}

export interface RuntimeCapabilityRegistry {
  has(name: string): boolean;
  list(): string[];
  grant(name: string): void;
  revoke(name: string): void;
}

export interface GemmaPodRuntime {
  readonly id: string;
  readonly podId: string;
  readonly conversationId: string;
  readonly manifest: PodConfig;
  readonly transport: RuntimeTransportState;
  readonly capabilities: RuntimeCapabilityRegistry;
  readonly events: RuntimeEventBus;
  readonly state: RuntimeStateStore;
  readonly chat: RuntimeChatApi;
  readonly a2a: RuntimeA2AApi;

  connect(): Promise<void>;
  mount(target: HTMLElement | null): Promise<void>;
  destroy(): Promise<void>;
  getTransport(): Transport | null;
}

export type RuntimeEvent =
  | { type: "runtime.ready"; runtime: GemmaPodRuntime }
  | { type: "runtime.destroyed"; runtime: GemmaPodRuntime }
  | { type: "runtime.error"; error: Error }
  | { type: "transport.connecting"; transport: "webrtc" | "fallback" | "direct" | "auto" }
  | { type: "transport.ready"; transport: string }
  | { type: "transport.updated"; transport: Transport | null }
  | { type: "transport.fallback"; from: string; to: string; reason: string }
  | { type: "transport.webrtc"; event: WebRtcConnectEvent }
  | { type: "a2a.card"; card: A2AAgentCard }
  | { type: "ui.event"; event: DartcUiEvent }
  | { type: "chat.history"; messages: ChatMessage[] }
  | { type: "state.changed"; state: unknown };

export interface RuntimeEventBus {
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

export class LocalRuntimeEventBus implements RuntimeEventBus {
  private handlers = new Map<RuntimeEvent["type"], Set<(event: RuntimeEvent) => void>>();

  on<T extends RuntimeEvent["type"]>(
    type: T,
    handler: (event: Extract<RuntimeEvent, { type: T }>) => void,
  ): () => void {
    const set = this.handlers.get(type) ?? new Set<(event: RuntimeEvent) => void>();
    set.add(handler as (event: RuntimeEvent) => void);
    this.handlers.set(type, set);
    return () => set.delete(handler as (event: RuntimeEvent) => void);
  }

  once<T extends RuntimeEvent["type"]>(
    type: T,
    handler: (event: Extract<RuntimeEvent, { type: T }>) => void,
  ): () => void {
    const off = this.on(type, (event) => {
      off();
      handler(event);
    });
    return off;
  }

  emit(event: RuntimeEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(event);
  }
}

export class LocalCapabilityRegistry implements RuntimeCapabilityRegistry {
  private readonly names = new Set<string>();

  constructor(initial: string[] = []) {
    for (const name of initial) this.names.add(name);
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  list(): string[] {
    return [...this.names].sort();
  }

  grant(name: string): void {
    this.names.add(name);
  }

  revoke(name: string): void {
    this.names.delete(name);
  }
}
