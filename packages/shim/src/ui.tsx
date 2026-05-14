import { useEffect, useRef, useState } from "preact/hooks";
import type { ChatMessage, Transport } from "./types";
import { FallbackTransport } from "./transports";
import type { WebRtcConnectEvent, WebRtcConnectStage } from "./transports/webrtc";
import type { GemmaPodRuntime } from "./runtime";

const WEBRTC_STEPS: Array<{ stage: WebRtcConnectStage; label: string }> = [
  { stage: "data-channel-open", label: "WebRTC data channel open" },
  { stage: "dartc-origin-hello", label: "DARTC hello from origin" },
  { stage: "signed-frame-verified", label: "Signed frame verification" },
  { stage: "a2a-card-received", label: "A2A Agent Card exchange" },
];

export function ChatWidget({ runtime }: { runtime: GemmaPodRuntime }) {
  const config = runtime.manifest;
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { role: "system", content: config.systemPrompt },
    ...runtime.chat.history(),
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [, setTransportVersion] = useState(0);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const transport = runtime.getTransport();
  const trace = runtime.transport.trace;
  const selectError = runtime.transport.error ?? null;
  const webrtcEvents = runtime.transport.webrtcEvents;

  useEffect(() => {
    const bump = () => setTransportVersion((version) => version + 1);
    const offs = [
      runtime.events.on("transport.webrtc", bump),
      runtime.events.on("transport.ready", bump),
      runtime.events.on("transport.updated", bump),
      runtime.events.on("runtime.error", bump),
      runtime.events.on("chat.history", (event) => {
        setMessages([{ role: "system", content: config.systemPrompt }, ...event.messages]);
      }),
    ];
    runtime.connect().catch(() => bump());
    return () => {
      for (const off of offs) off();
    };
  }, [config.systemPrompt, runtime]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    if (!transport || !input.trim() || streaming) return;
    const next: ChatMessage[] = [...messages, { role: "user", content: input.trim() }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    try {
      let acc = "";
      console.log(`[shim] starting chat stream for model: ${config.model}`);
      for await (const chunk of runtime.chat.stream({ messages: next, model: config.model })) {
        if (chunk.done) break;
        acc += chunk.delta;
        console.log(`[shim] ${new Date().toISOString()} UI update, acc length: ${acc.length}`);
        setMessages([...next, { role: "assistant", content: acc }]);
      }
      console.log(`[shim] ${new Date().toISOString()} chat stream finished`);
      runtime.chat.setHistory([...next, { role: "assistant", content: acc }]);

    } catch (err) {
      console.error(`[shim] chat error:`, err);
      const failed = [...next, { role: "assistant" as const, content: `[error] ${(err as Error).message}` }];
      setMessages(failed);
      runtime.chat.setHistory(failed);
    } finally {
      setStreaming(false);
    }

  }

  const visible = messages.filter((m) => m.role !== "system");
  const fallbackBlocked =
    transport instanceof FallbackTransport && transport.state !== "ready";
  const hardFail = !transport && !!selectError;

  const inputDisabled = streaming || !transport || fallbackBlocked;
  const placeholder = !transport
    ? "Connecting…"
    : fallbackBlocked
      ? "Not ready to chat yet."
      : "Ask the pod…";

  return (
    <div style={S.root}>
      <header style={S.header}>
        <strong>{config.name}</strong>
        <TransportBadge transport={transport} trace={trace} error={selectError} />
      </header>

      {!transport && !selectError && config.transport.webrtc && (
        <RendezvousProgress events={webrtcEvents} />
      )}

      {hardFail ? (
        <OwnerUnavailable reason={selectError ?? trace[0]} />
      ) : (
        <>
          <div ref={scrollerRef} style={S.scroll}>
            {visible.map((m, i) => (
              <div key={i} style={{ ...S.msg, ...(m.role === "user" ? S.user : S.assistant) }}>
                {m.content || (streaming && i === visible.length - 1 ? "…" : "")}
              </div>
            ))}
          </div>
          <form
            style={S.form}
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              style={S.input}
              value={input}
              placeholder={placeholder}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              disabled={inputDisabled}
            />
            <button style={S.btn} type="submit" disabled={inputDisabled || !input.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function OwnerUnavailable({ reason }: { reason?: string | null }) {
  return (
    <div style={S.unavailable}>
      <span style={S.unavailableEyebrow}>Origin unavailable</span>
      <h3 style={S.unavailableTitle}>Owner origin is not reachable right now.</h3>
      <p style={S.unavailableBody}>
        This pod is trying to reach its owner's machine over DARTC. Keep this window open
        and retry when the origin daemon is online.
      </p>
      {reason && <p style={S.unavailableReason}>{reason}</p>}
    </div>
  );
}

function RendezvousProgress({ events }: { events: WebRtcConnectEvent[] }) {
  const done = new Set(events.map((e) => e.stage));
  const latest = events.at(-1);

  return (
    <div style={S.rendezvous}>
      <div style={S.rendezvousTop}>
        <span style={S.rendezvousTitle}>Secure rendezvous</span>
        <span style={S.rendezvousDetail}>{latest?.detail ?? "starting DARTC over WebRTC"}</span>
      </div>
      <div style={S.stepList}>
        {WEBRTC_STEPS.map((step) => {
          const complete = done.has(step.stage);
          const active =
            latest?.stage === step.stage ||
            (!complete && WEBRTC_STEPS.find((candidate) => !done.has(candidate.stage))?.stage === step.stage);
          return (
            <div key={step.stage} style={S.stepRow}>
              <span
                style={{
                  ...S.stepDot,
                  ...(complete ? S.stepDotDone : active ? S.stepDotActive : {}),
                }}
              >
                {complete ? "" : ""}
              </span>
              <span style={{ ...S.stepText, ...(complete ? S.stepTextDone : {}) }}>{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TransportBadge({
  transport,
  trace,
  error,
}: {
  transport: Transport | null;
  trace: string[];
  error: string | null;
}) {
  if (error) return <span style={{ ...S.badge, color: "#ff7a7a" }}>error</span>;
  if (!transport) return <span style={S.badge}>connecting…</span>;
  if (transport instanceof FallbackTransport) {
    const fb =
      transport.state === "ready"
        ? "local model"
        : transport.state === "preparing"
          ? "local model (loading…)"
          : transport.state === "error"
            ? "local model (error)"
            : "local model (not loaded)";
    return <span style={S.badge}>{fb}</span>;
  }
  const tooltip = trace.length ? `tried: ${trace.join("; ")}` : "";
  return (
    <span style={S.badge} title={tooltip}>
      via {transport.name}
    </span>
  );
}

const S: Record<string, Record<string, string>> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: "320px",
    border: "1px solid #2a2a2a",
    borderRadius: "12px",
    background: "#0d0d0f",
    color: "#e7e7ea",
    fontFamily: "system-ui, sans-serif",
    overflow: "hidden",
  },
  header: {
    padding: "10px 14px",
    borderBottom: "1px solid #1f1f22",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "13px",
  },
  badge: { fontSize: "11px", color: "#8c8c92", letterSpacing: "0.04em" },
  rendezvous: {
    margin: "12px",
    padding: "14px",
    border: "1px solid #24262b",
    borderRadius: "10px",
    background: "#111317",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  rendezvousTop: { display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "baseline" },
  rendezvousTitle: { fontSize: "13px", fontWeight: "650", color: "#f2f2f4" },
  rendezvousDetail: { fontSize: "11px", color: "#8c8c92", textAlign: "right" },
  stepList: { display: "grid", gap: "9px" },
  stepRow: { display: "flex", alignItems: "center", gap: "9px", fontSize: "12px" },
  stepDot: {
    width: "16px",
    height: "16px",
    borderRadius: "999px",
    border: "1px solid #3a3d45",
    color: "#0d0d0f",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    flex: "0 0 auto",
  },
  stepDotActive: { borderColor: "#7aa2ff", boxShadow: "0 0 0 3px rgba(122,162,255,0.14)" },
  stepDotDone: { borderColor: "#68d391", background: "#68d391" },
  stepText: { color: "#a8a8af" },
  stepTextDone: { color: "#e7e7ea" },
  scroll: { flex: "1", overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" },
  msg: { padding: "8px 12px", borderRadius: "10px", maxWidth: "85%", whiteSpace: "pre-wrap", lineHeight: "1.45", fontSize: "14px" },
  user: { alignSelf: "flex-end", background: "#1b3a5b" },
  assistant: { alignSelf: "flex-start", background: "#1a1a1d" },
  unavailable: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "10px",
    padding: "22px",
    color: "#e7e7ea",
  },
  unavailableEyebrow: {
    width: "fit-content",
    color: "#c9a05a",
    border: "1px solid #3b3020",
    background: "#17130d",
    borderRadius: "999px",
    padding: "4px 9px",
    fontSize: "11px",
    fontWeight: "700",
  },
  unavailableTitle: { margin: "0", fontSize: "17px", lineHeight: "1.3", color: "#f2f2f4" },
  unavailableBody: { margin: "0", color: "#a8a8af", fontSize: "13px", lineHeight: "1.5" },
  unavailableReason: {
    margin: "4px 0 0",
    padding: "9px 10px",
    color: "#8c8c92",
    background: "#0a0a0c",
    border: "1px solid #1f1f22",
    borderRadius: "8px",
    fontSize: "11px",
    lineHeight: "1.4",
  },
  form: { display: "flex", gap: "8px", padding: "10px", borderTop: "1px solid #1f1f22" },
  input: {
    flex: "1",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid #2a2a2a",
    background: "#0a0a0c",
    color: "#e7e7ea",
    fontSize: "14px",
  },
  btn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "0",
    background: "#3a7afe",
    color: "white",
    fontSize: "14px",
    cursor: "pointer",
  },
};
