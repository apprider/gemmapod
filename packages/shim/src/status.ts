import type { GemmaPodRuntime } from "./runtime/events";
import { FallbackTransport } from "./transports/fallback";

/** Compact snapshot for support UIs, status badges, and logs. */
export function quickTransportStatus(runtime: GemmaPodRuntime): {
  phase: GemmaPodRuntime["transport"]["status"];
  transportName: string | null;
  detail: string;
} {
  const t = runtime.getTransport();
  const trace = runtime.transport.trace.filter(Boolean).join("; ");
  const err = runtime.transport.error;

  if (t instanceof FallbackTransport) {
    const tail = t.lastError ? ` — ${t.lastError}` : "";
    return {
      phase: runtime.transport.status,
      transportName: "fallback",
      detail: `state=${t.state}${tail}${trace ? ` | tried: ${trace}` : ""}`,
    };
  }

  return {
    phase: runtime.transport.status,
    transportName: t?.name ?? null,
    detail: err ?? trace ?? (t ? `via ${t.name}` : "no transport"),
  };
}
