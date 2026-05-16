import type { A2AAgentCard, DartcUiEvent } from "@gemmapod/dartc";
import type { ChatChunk, ChatMessage, PodConfig, Transport } from "../types";
import type { PrepareProgress } from "../transports/fallback";
import { selectTransport } from "../transports";
import { FallbackTransport } from "../transports/fallback";
import {
  LocalCapabilityRegistry,
  LocalRuntimeEventBus,
  type GemmaPodRuntime,
  type RuntimeA2AApi,
  type RuntimeCapabilityRegistry,
  type RuntimeChatApi,
  type RuntimeChatInput,
  type RuntimeEventBus,
  type RuntimeTransportState,
} from "./events";
import { LocalRuntimeStateStore, type RuntimeStateStore } from "./state";

export interface BrowserRuntimeMountChat {
  (runtime: GemmaPodRuntime, el: HTMLElement): void | Promise<void>;
}

export interface CreateBrowserRuntimeOptions {
  mountChat: BrowserRuntimeMountChat;
  /** When false, omit `ui.render` from the capability registry (runtime-only / headless embeds). */
  grantUiRenderCapability: boolean;
}

interface StoredConversation {
  id: string;
  messages: ChatMessage[];
}

class BrowserGemmaPodRuntime implements GemmaPodRuntime {
  readonly id = createRuntimeId();
  readonly podId: string;
  readonly conversationId: string;
  readonly manifest: PodConfig;
  readonly transport: RuntimeTransportState = {
    status: "idle",
    trace: [],
    webrtcEvents: [],
  };
  readonly capabilities: RuntimeCapabilityRegistry;
  readonly events: RuntimeEventBus = new LocalRuntimeEventBus();
  readonly state: RuntimeStateStore = new LocalRuntimeStateStore();
  readonly a2a: RuntimeA2AApi = {};
  readonly chat: RuntimeChatApi;

  private currentTransport: Transport | null = null;
  private connectPromise: Promise<void> | null = null;
  private historyMessages: ChatMessage[];
  private destroyed = false;
  private readonly mountChat: BrowserRuntimeMountChat;

  constructor(config: PodConfig, options: CreateBrowserRuntimeOptions) {
    const stored = loadConversation(config);
    this.conversationId = config.conversationId ?? stored.id;
    this.manifest = { ...config, conversationId: this.conversationId };
    this.podId = this.manifest.transport.webrtc?.podId ?? this.manifest.name;
    this.historyMessages = stored.messages;
    this.mountChat = options.mountChat;

    const caps = options.grantUiRenderCapability
      ? ["ui.render", "storage.local", "transport.webrtc", "transport.direct", "transport.browser-fallback"]
      : ["storage.local", "transport.webrtc", "transport.direct", "transport.browser-fallback"];
    this.capabilities = new LocalCapabilityRegistry(caps);
    this.chat = this.createChatApi();
    this.state.subscribe((state) => this.events.emit({ type: "state.changed", state }));
  }

  async connect(): Promise<void> {
    if (this.destroyed) throw new Error("runtime destroyed");
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce();
    return this.connectPromise;
  }

  async mount(target: HTMLElement | null): Promise<void> {
    if (!target) return;
    await this.mountChat(this, target);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.transport.status = "destroyed";
    const closable = this.currentTransport as (Transport & { close?: () => void }) | null;
    closable?.close?.();
    this.currentTransport = null;
    this.events.emit({ type: "runtime.destroyed", runtime: this });
  }

  getTransport(): Transport | null {
    return this.currentTransport;
  }

  private async connectOnce(): Promise<void> {
    this.transport.status = "connecting";
    this.transport.error = undefined;
    this.transport.trace = [];
    this.transport.webrtcEvents = [];
    this.events.emit({ type: "transport.connecting", transport: "auto" });

    try {
      const result = await selectTransport(this.manifest, {
        onWebRtcEvent: (event) => {
          this.transport.webrtcEvents = [
            ...this.transport.webrtcEvents.filter((candidate) => candidate.stage !== event.stage),
            event,
          ];
          this.events.emit({ type: "transport.webrtc", event });
        },
      });
      this.currentTransport = result.transport;
      this.transport.status = "ready";
      this.transport.name = result.transport.name;
      this.transport.trace = result.trace;
      if (result.transport instanceof FallbackTransport) {
        this.attachFallbackTransportHooks(result.transport);
      }
      this.bridgeTransport(result.transport);
      if (result.trace.length > 0 && result.transport.name !== "webrtc") {
        this.events.emit({
          type: "transport.fallback",
          from: "webrtc",
          to: result.transport.name,
          reason: result.trace.join("; "),
        });
      }
      this.events.emit({ type: "transport.ready", transport: result.transport.name });
      this.events.emit({ type: "runtime.ready", runtime: this });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.transport.status = "error";
      this.transport.error = err.message;
      this.events.emit({ type: "runtime.error", error: err });
      throw err;
    }
  }

  private attachFallbackTransportHooks(transport: FallbackTransport): void {
    const notify = () => {
      this.events.emit({ type: "transport.updated", transport: this.currentTransport });
    };

    const origPrepare = transport.prepare.bind(transport);
    transport.prepare = async (onProgress?: (p: PrepareProgress) => void) => {
      const run = origPrepare((p) => {
        onProgress?.(p);
      });
      queueMicrotask(() => notify());
      try {
        await run;
      } finally {
        notify();
      }
    };

    const origAbort = transport.abort.bind(transport);
    transport.abort = () => {
      origAbort();
      notify();
    };

    const origSetModel = transport.setModel.bind(transport);
    transport.setModel = (id: string) => {
      const ok = origSetModel(id);
      notify();
      return ok;
    };
  }

  private bridgeTransport(transport: Transport): void {
    transport.onUiEvent?.((event) => {
      this.consumeUiEvent(event).catch((e) => {
        const error = e instanceof Error ? e : new Error(String(e));
        this.events.emit({ type: "runtime.error", error });
      });
    });
    transport.onAgentCard?.((card) => {
      (this.a2a as { card?: A2AAgentCard }).card = card;
      this.events.emit({ type: "a2a.card", card });
    });
  }

  private async consumeUiEvent(event: DartcUiEvent): Promise<void> {
    if (event.type === "STATE_SNAPSHOT") {
      await this.state.replace(event.snapshot);
    } else if (event.type === "STATE_DELTA") {
      await this.state.apply(event.delta);
    } else if (event.type === "MESSAGES_SNAPSHOT") {
      this.setHistoryFromUnknown(event.messages);
    }
    this.events.emit({ type: "ui.event", event });
    if (event.type === "CUSTOM" && event.name === "a2a.card") {
      const card = event.value as A2AAgentCard;
      (this.a2a as { card?: A2AAgentCard }).card = card;
      this.events.emit({ type: "a2a.card", card });
    }
  }

  private createChatApi(): RuntimeChatApi {
    return {
      stream: (input) => this.stream(input),
      send: async (input) => {
        await this.connect();
        const transport = this.currentTransport;
        if (!transport) throw new Error("runtime has no active transport");
        const normalized = normalizeChatInput(input, this.historyMessages, this.manifest.model);
        const messages = normalized.messages;
        let acc = "";
        for await (const chunk of transport.chat(
          messages,
          normalized.model,
          normalized.signal,
          normalized.conversationId ?? this.conversationId,
        )) {
          if (chunk.done) break;
          acc += chunk.delta;
        }
        this.setHistory([...messages, { role: "assistant", content: acc }]);
        return acc;
      },
      history: () => [...this.historyMessages],
      setHistory: (messages) => this.setHistory(messages),
      clear: async () => this.setHistory([]),
    };
  }

  private async *stream(input: string | RuntimeChatInput): AsyncIterable<ChatChunk> {
    await this.connect();
    const transport = this.currentTransport;
    if (!transport) throw new Error("runtime has no active transport");

    const normalized = normalizeChatInput(input, this.historyMessages, this.manifest.model);
    const messages = normalized.messages;
    const model = normalized.model || this.manifest.model || "";
    const conversationId = normalized.conversationId ?? this.conversationId;
    for await (const chunk of transport.chat(messages, model, normalized.signal, conversationId)) {
      yield chunk;
    }
  }

  private setHistory(messages: ChatMessage[]): void {
    this.historyMessages = messages.filter((message) => message.role !== "system");
    saveConversation(this.manifest, this.historyMessages);
    this.events.emit({ type: "chat.history", messages: [...this.historyMessages] });
  }

  private setHistoryFromUnknown(messages: unknown): void {
    if (!Array.isArray(messages)) return;
    this.setHistory(messages.filter(isChatMessage));
  }
}

export function createBrowserRuntime(config: PodConfig, options: CreateBrowserRuntimeOptions): GemmaPodRuntime {
  return new BrowserGemmaPodRuntime(config, options);
}

export function isFallbackRuntimeTransport(transport: Transport | null): transport is FallbackTransport {
  return transport instanceof FallbackTransport;
}

function normalizeChatInput(
  input: string | RuntimeChatInput,
  history: ChatMessage[],
  model: string | undefined,
): Required<Pick<RuntimeChatInput, "messages" | "model">> &
  Pick<RuntimeChatInput, "conversationId" | "signal" | "metadata"> {
  const effectiveModel = model ?? "";
  if (typeof input === "string") {
    return {
      messages: [...history, { role: "user", content: input }],
      model: effectiveModel,
    };
  }
  return {
    messages: input.messages ?? (input.text ? [...history, { role: "user", content: input.text }] : history),
    model: input.model ?? effectiveModel,
    conversationId: input.conversationId,
    signal: input.signal,
    metadata: input.metadata,
  };
}

function loadConversation(config: PodConfig): StoredConversation {
  const fallback = { id: config.conversationId ?? createConversationId(), messages: [] };
  try {
    const key = conversationStorageKey(config);
    const raw = localStorage.getItem(key);
    if (!raw) {
      localStorage.setItem(key, JSON.stringify(fallback));
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<StoredConversation>;
    const messages = Array.isArray(parsed.messages) ? parsed.messages.filter(isChatMessage) : [];
    const id =
      config.conversationId ??
      (typeof parsed.id === "string" && parsed.id ? parsed.id : createConversationId());
    const stored = { id, messages };
    localStorage.setItem(key, JSON.stringify(stored));
    return stored;
  } catch {
    return fallback;
  }
}

function saveConversation(config: PodConfig, messages: ChatMessage[]): void {
  if (!config.conversationId) return;
  try {
    localStorage.setItem(
      conversationStorageKey(config),
      JSON.stringify({
        id: config.conversationId,
        messages: messages.filter((message) => message.role !== "system" && message.content.trim()),
      }),
    );
  } catch {
    /* localStorage may be blocked in private embeds. DARTC still carries the in-memory id. */
  }
}

function conversationStorageKey(config: PodConfig): string {
  const podId = config.transport.webrtc?.podId ?? config.name;
  return `gemmapod:${podId}:conversation:v1`;
}

function createRuntimeId(): string {
  return `runtime_${randomId()}`;
}

function createConversationId(): string {
  return `conv_${randomId()}`;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.role === "system" || v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string"
  );
}
