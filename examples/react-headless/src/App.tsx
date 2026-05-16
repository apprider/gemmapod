import { useEffect, useRef, useState } from "react";

// Loose runtime shape — the runtime IIFE assigns it to window.GemmaPod at
// load time. We type just what this example uses.
type ChatChunk = { delta?: string; done?: boolean };
interface RuntimeLike {
  events: {
    on(type: string, handler: (event: unknown) => void): () => void;
  };
  chat: {
    stream(input: string): AsyncIterable<ChatChunk>;
  };
  destroy?(): Promise<void>;
}
interface MountedLike {
  runtime: RuntimeLike;
  destroy(): Promise<void>;
}
interface GemmaPodGlobal {
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: { ui?: "chat" | "none"; fallbackUi?: "default" | "none" | HTMLElement; fallbackMountParent?: HTMLElement },
  ): Promise<MountedLike>;
}

const config = {
  name: "Headless React demo",
  persona: "AI agent rendered by the host page, not the shim's Preact UI.",
  systemPrompt:
    "You are a demo agent showing that GemmaPod's runtime can be embedded with a fully custom UI. Be terse.",
  model: "gemma4:e4b",
  transport: {
    webrtc: { signalUrl: "https://signal.gemmapod.com/signal", podId: "react-headless-demo" },
    fallback: { model: "onnx-community/gemma-4-E2B-it-ONNX" },
  },
};

interface Line {
  who: "user" | "assistant" | "system";
  text: string;
}

export function App() {
  const [status, setStatus] = useState<"mounting" | "connecting" | "ready" | "fallback" | "error">("mounting");
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const runtimeRef = useRef<RuntimeLike | null>(null);
  const fallbackHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let killed = false;
    let mounted: MountedLike | null = null;
    let unsubs: Array<() => void> = [];

    async function boot() {
      const g = (window as unknown as { GemmaPod?: GemmaPodGlobal }).GemmaPod;
      if (!g?.mountPod) {
        setTimeout(boot, 100);
        return;
      }
      setStatus("connecting");
      try {
        mounted = await g.mountPod(null, config, {
          ui: "none",
          fallbackUi: "default",
          fallbackMountParent: fallbackHostRef.current ?? undefined,
        });
        if (killed) {
          await mounted.destroy();
          return;
        }
        const runtime = mounted.runtime;
        runtimeRef.current = runtime;

        unsubs = [
          runtime.events.on("transport.ready", () => setStatus("ready")),
          runtime.events.on("transport.fallback", () => setStatus("fallback")),
          runtime.events.on("runtime.error", () => setStatus("error")),
        ];

        // Optional: surface assistant text streaming for richer UIs.
        unsubs.push(
          runtime.events.on("ui.event", (payload) => {
            const event = (payload as { event?: { type?: string; delta?: string } }).event;
            if (event?.type === "TEXT_MESSAGE_CONTENT" && event.delta) {
              setLines((current) => {
                if (current.length && current[current.length - 1]!.who === "assistant") {
                  const next = current.slice(0, -1);
                  next.push({ who: "assistant", text: current[current.length - 1]!.text + event.delta });
                  return next;
                }
                return [...current, { who: "assistant", text: event.delta ?? "" }];
              });
            }
          }),
        );
      } catch (e) {
        console.error(e);
        setStatus("error");
      }
    }

    boot();

    return () => {
      killed = true;
      for (const off of unsubs) off();
      mounted?.destroy();
    };
  }, []);

  async function send() {
    const text = input.trim();
    const runtime = runtimeRef.current;
    if (!text || !runtime || busy) return;
    setBusy(true);
    setLines((current) => [...current, { who: "user", text }]);
    setInput("");
    try {
      for await (const chunk of runtime.chat.stream(text)) {
        if (chunk.done) break;
      }
    } catch (e) {
      setLines((current) => [...current, { who: "system", text: `error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.h1}>GemmaPod · React (headless)</h1>
        <span style={statusStyle(status)}>{status}</span>
      </header>

      <div style={styles.transcript}>
        {lines.length === 0 ? (
          <p style={styles.empty}>Say hello.</p>
        ) : (
          lines.map((line, i) => (
            <div key={i} style={lineStyle(line.who)}>
              <span style={styles.who}>{line.who}</span>
              <span>{line.text}</span>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        style={styles.composer}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={status === "ready" || status === "fallback" ? "Message…" : "Connecting…"}
          disabled={status === "mounting" || status === "connecting" || status === "error" || busy}
          style={styles.input}
        />
        <button type="submit" disabled={!input.trim() || busy} style={styles.send}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      {/* Where the default WebGPU fallback panel mounts when the origin is unreachable. */}
      <div ref={fallbackHostRef} style={{ marginTop: 16 }} />
    </div>
  );
}

const styles = {
  shell: {
    maxWidth: 720,
    margin: "48px auto",
    padding: 24,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e8e8ec",
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 12,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  h1: { margin: 0, fontSize: 20 },
  transcript: {
    minHeight: 240,
    padding: 12,
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 1.5,
  },
  empty: { color: "#7d8590", margin: 0 },
  who: { display: "inline-block", minWidth: 80, color: "#7d8590", fontVariant: "all-small-caps" },
  composer: { display: "flex", gap: 8, marginTop: 12 },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#e8e8ec",
  },
  send: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #30363d",
    background: "#1f6feb",
    color: "white",
    cursor: "pointer",
  },
} as const;

function lineStyle(who: Line["who"]): React.CSSProperties {
  return {
    display: "flex",
    gap: 8,
    padding: "6px 0",
    color: who === "system" ? "#f85149" : who === "user" ? "#58a6ff" : "#e8e8ec",
  };
}

function statusStyle(status: string): React.CSSProperties {
  const color =
    status === "ready" ? "#3fb950" : status === "fallback" ? "#d29922" : status === "error" ? "#f85149" : "#7d8590";
  return { fontSize: 12, color, fontVariant: "all-small-caps" };
}
