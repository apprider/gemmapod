import type { ChatChunk, ChatMessage, Transport } from "../types";

export class DirectTransport implements Transport {
  readonly name = "direct";
  constructor(private baseUrl: string) {}

  async *chat(messages: ChatMessage[], model: string, signal?: AbortSignal): AsyncIterable<ChatChunk> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`origin error: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") {
          yield { delta: "", done: true };
          return;
        }
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content ?? "";
          if (delta) yield { delta, done: false };
        } catch {
          // skip malformed chunk
        }
      }
    }
    yield { delta: "", done: true };
  }
}
