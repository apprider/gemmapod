import type { PodConfig, Transport } from "../types";
import { DirectTransport } from "./direct";
import { WebRtcTransport, type WebRtcConnectObserver } from "./webrtc";
import { FallbackTransport } from "./fallback";

export { FallbackTransport, FALLBACK_MODELS } from "./fallback";
export type { CacheInfo, FallbackState, PrepareProgress, FallbackModelOption } from "./fallback";

export interface SelectResult {
  transport: Transport;
  /** Errors collected from transports that were tried and rejected. Useful
   * for diagnostics shown in the chat UI's transport badge. */
  trace: string[];
}

export interface SelectTransportOptions {
  onWebRtcEvent?: WebRtcConnectObserver;
}

// Tries WebRTC, then the in-browser fallback (returned unprepared — the host
// must call `prepare()` on user click), then direct HTTP as the last resort
// (mostly for local dev where the visitor is on the same LAN as Ollama).
export async function selectTransport(
  config: PodConfig,
  options: SelectTransportOptions = {},
): Promise<SelectResult> {
  const trace: string[] = [];

  if (config.transport.webrtc) {
    try {
      const t = new WebRtcTransport(
        config.transport.webrtc.signalUrl,
        config.transport.webrtc.podId,
        config.conversationId,
        config.signedManifestB64,
        options.onWebRtcEvent,
      );
      await waitOpened(t);
      return { transport: t, trace };
    } catch (e) {
      trace.push(`webrtc: ${(e as Error).message}`);
    }
  }

  if (config.transport.fallback && FallbackTransport.supportsWebGPU()) {
    return {
      transport: new FallbackTransport(config.transport.fallback.model),
      trace,
    };
  } else if (config.transport.fallback) {
    trace.push("fallback: WebGPU unavailable");
  }

  if (config.transport.direct) {
    return { transport: new DirectTransport(config.transport.direct.baseUrl), trace };
  }

  throw new Error(`no transport available — ${trace.join("; ") || "none configured"}`);
}

async function waitOpened(t: WebRtcTransport): Promise<void> {
  const opened = (t as unknown as { opened: Promise<void> }).opened;
  await opened;
}
