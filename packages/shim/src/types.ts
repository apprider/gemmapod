import type { A2AAgentCard, DartcUiEvent } from "@gemmapod/dartc";

export interface PodConfig {
  name: string;
  persona: string;
  systemPrompt: string;
  model?: string;
  conversationId?: string;
  transport: TransportConfig;
  tools?: ToolSpec[];
  signedManifestB64?: string;
}

export interface TransportConfig {
  direct?: { baseUrl: string };
  webrtc?: { signalUrl: string; podId: string };
  fallback?: { tier?: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolSpec {
  name: string;
  description: string;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface Transport {
  readonly name: string;
  chat(
    messages: ChatMessage[],
    model: string,
    signal?: AbortSignal,
    conversationId?: string,
  ): AsyncIterable<ChatChunk>;
  onUiEvent?(observer: (event: DartcUiEvent) => void): () => void;
  onAgentCard?(observer: (card: A2AAgentCard) => void): () => void;
}
