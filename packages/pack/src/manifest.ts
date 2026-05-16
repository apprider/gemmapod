// pod.toml schema mirror. Keys here use the snake_case field names that the
// Rust Manifest struct expects on the wire — TOML's idiomatic style anyway.
//
// The CLI converts a parsed TOML file into this shape, then hands it to the
// WASM signer. The signer's CBOR output is what the browser shim verifies
// and then projects into the camelCase PodConfig shape used by the UI.

export interface Manifest {
  v: number;
  id: string;
  name: string;
  persona: string;
  system_prompt: string;
  model?: string;
  owner_pubkey: string;
  transport: TransportSpec;
  tools: ToolSpec[];
}

export interface TransportSpec {
  preferred: string[];
  webrtc?: { signal_url: string; pod_id: string };
  direct?: { base_url: string };
  fallback?: { tier?: string };
}

export interface ToolSpec {
  name: string;
  description: string;
}

interface RawPodToml {
  name?: string;
  id?: string;
  persona?: string;
  system_prompt?: string;
  model?: string;
  owner_pubkey?: string;
  transport?: {
    preferred?: string[];
    webrtc?: { signal_url?: string; pod_id?: string };
    direct?: { base_url?: string };
    fallback?: { tier?: string };
  };
  tools?: Array<{ name?: string; description?: string }>;
}

export function fromToml(raw: RawPodToml, ownerPubkeyHex: string): Manifest {
  if (!raw.name) throw new Error("pod.toml: missing 'name'");
  if (!raw.system_prompt) throw new Error("pod.toml: missing 'system_prompt'");
  const transport: TransportSpec = {
    preferred: raw.transport?.preferred ?? ["webrtc", "fallback"],
  };
  if (raw.transport?.webrtc) {
    if (!raw.transport.webrtc.signal_url || !raw.transport.webrtc.pod_id) {
      throw new Error("pod.toml [transport.webrtc] requires signal_url and pod_id");
    }
    transport.webrtc = {
      signal_url: raw.transport.webrtc.signal_url,
      pod_id: raw.transport.webrtc.pod_id,
    };
  }
  if (raw.transport?.direct) {
    if (!raw.transport.direct.base_url) {
      throw new Error("pod.toml [transport.direct] requires base_url");
    }
    transport.direct = { base_url: raw.transport.direct.base_url };
  }
  if (raw.transport?.fallback) {
    transport.fallback = raw.transport.fallback.tier
      ? { tier: raw.transport.fallback.tier }
      : {};
  }
  return {
    v: 1,
    id: raw.id ?? raw.name,
    name: raw.name,
    persona: raw.persona ?? "",
    system_prompt: raw.system_prompt,
    model: raw.model,
    owner_pubkey: ownerPubkeyHex,
    transport,
    tools: (raw.tools ?? []).map((t) => {
      if (!t.name || !t.description) {
        throw new Error("pod.toml [[tools]] entries require name and description");
      }
      return { name: t.name, description: t.description };
    }),
  };
}
