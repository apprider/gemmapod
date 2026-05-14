import { useEffect, useRef, useState } from "react";

// The runtime IIFE side-effects window.GemmaPod. We type only what this
// example uses.
interface GemmaPodGlobal {
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: { ui?: "chat" | "none"; fallbackUi?: "default" | "none"; fallbackMountParent?: HTMLElement },
  ): Promise<{
    runtime: {
      events: { on(type: string, handler: (event: unknown) => void): () => void };
      chat: { stream(input: string): AsyncIterable<{ delta?: string; done?: boolean }> };
    };
    destroy(): Promise<void>;
  }>;
  mapDartcUiEventToAgUi(event: unknown): { type: string } & Record<string, unknown>;
}

interface Row {
  /** Raw DARTC event (SCREAMING_SNAKE). */
  dartc: { type: string } & Record<string, unknown>;
  /** AG-UI-shaped event (PascalCase). Same payload fields. */
  agui: { type: string } & Record<string, unknown>;
  /** Render-time index for stable keys. */
  index: number;
}

const config = {
  name: "AG-UI bridge demo",
  persona: "Demonstrates the DARTC ↔ AG-UI event mapping.",
  systemPrompt:
    "You are a demo agent. Briefly introduce yourself, then say what's happening — every event the runtime emits is shown twice on the page: once as DARTC (SCREAMING_SNAKE), once as AG-UI (PascalCase).",
  model: "gemma4:e4b",
  transport: {
    webrtc: { signalUrl: "wss://cloud.gemmapod.com/signal", podId: "agui-bridge-demo" },
    fallback: { model: "onnx-community/gemma-4-E2B-it-ONNX" },
  },
};

export function App() {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState("Hello! Show me a tool call event next.");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"mounting" | "connecting" | "ready" | "fallback" | "error">("mounting");
  const runtimeRef = useRef<Awaited<ReturnType<GemmaPodGlobal["mountPod"]>>["runtime"] | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    let killed = false;
    let mounted: Awaited<ReturnType<GemmaPodGlobal["mountPod"]>> | null = null;
    let unsubs: Array<() => void> = [];

    async function boot() {
      const g = (window as unknown as { GemmaPod?: GemmaPodGlobal }).GemmaPod;
      if (!g?.mountPod) {
        setTimeout(boot, 100);
        return;
      }
      setStatus("connecting");
      try {
        mounted = await g.mountPod(null, config, { ui: "none", fallbackUi: "none" });
        if (killed) {
          await mounted.destroy();
          return;
        }
        runtimeRef.current = mounted.runtime;

        unsubs = [
          mounted.runtime.events.on("transport.ready", () => setStatus("ready")),
          mounted.runtime.events.on("transport.fallback", () => setStatus("fallback")),
          mounted.runtime.events.on("runtime.error", () => setStatus("error")),
          mounted.runtime.events.on("ui.event", (payload) => {
            const event = (payload as { event?: Record<string, unknown> & { type: string } }).event;
            if (!event) return;
            const agui = g.mapDartcUiEventToAgUi(event);
            counter.current += 1;
            setRows((cur) => [
              ...cur,
              { dartc: event, agui, index: counter.current },
            ]);
          }),
        ];
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
    try {
      for await (const chunk of runtime.chat.stream(text)) {
        if (chunk.done) break;
      }
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <h1 style={styles.h1}>DARTC ↔ AG-UI bridge</h1>
        <span style={statusStyle(status)}>{status}</span>
      </header>

      <p style={styles.lead}>
        Every event the runtime emits appears in both columns. Field
        names are identical; only the <code>type</code> discriminator is
        rewritten. <code>GemmaPod.mapDartcUiEventToAgUi(event)</code> is
        the one call you need.
      </p>

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
          style={styles.input}
          disabled={busy || (status !== "ready" && status !== "fallback")}
        />
        <button type="submit" disabled={!input.trim() || busy} style={styles.send}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      <div style={styles.grid}>
        <Column title="DARTC" subtitle="SCREAMING_SNAKE" events={rows.map((r) => ({ event: r.dartc, index: r.index }))} />
        <Column title="AG-UI" subtitle="PascalCase" events={rows.map((r) => ({ event: r.agui, index: r.index }))} />
      </div>
    </div>
  );
}

function Column({
  title,
  subtitle,
  events,
}: {
  title: string;
  subtitle: string;
  events: Array<{ event: { type: string } & Record<string, unknown>; index: number }>;
}) {
  return (
    <section style={styles.column}>
      <header>
        <strong>{title}</strong>{" "}
        <span style={styles.subtitle}>{subtitle}</span>
      </header>
      {events.length === 0 ? (
        <p style={styles.empty}>No events yet — try sending a message.</p>
      ) : (
        <ol style={styles.eventList}>
          {events.map(({ event, index }) => (
            <li key={index} style={styles.eventRow}>
              <div style={styles.eventType}>{event.type}</div>
              <pre style={styles.eventBody}>{JSON.stringify(rest(event), null, 2)}</pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function rest(event: Record<string, unknown>): Record<string, unknown> {
  const { type: _type, ...rest } = event;
  return rest;
}

function statusStyle(status: string): React.CSSProperties {
  const color =
    status === "ready" ? "#3fb950" : status === "fallback" ? "#d29922" : status === "error" ? "#f85149" : "#7d8590";
  return { fontSize: 12, color, fontVariant: "all-small-caps" };
}

const styles = {
  shell: {
    maxWidth: 1100,
    margin: "32px auto",
    padding: 24,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#e8e8ec",
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 12,
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { margin: 0, fontSize: 22 },
  lead: { color: "#7d8590", marginTop: 8, marginBottom: 16 },
  composer: { display: "flex", gap: 8, marginBottom: 16 },
  input: {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #30363d",
    background: "#161b22",
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
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  column: {
    border: "1px solid #21262d",
    borderRadius: 8,
    padding: 12,
    background: "#161b22",
    maxHeight: 480,
    overflowY: "auto",
  } as React.CSSProperties,
  subtitle: { color: "#7d8590", fontSize: 12 },
  empty: { color: "#7d8590" },
  eventList: { listStyle: "none", padding: 0, margin: 0 },
  eventRow: { borderBottom: "1px dashed #21262d", padding: "8px 0" },
  eventType: { color: "#58a6ff", fontFamily: "ui-monospace, monospace", fontSize: 13 },
  eventBody: {
    margin: "4px 0 0",
    fontSize: 12,
    color: "#9d8fdd",
    whiteSpace: "pre-wrap",
    fontFamily: "ui-monospace, monospace",
  } as React.CSSProperties,
} as const;
