// Bootstrap used by packed pod .html blobs. The blob inlines two base64
// strings (WASM bytes + signed manifest), then loads the shim's IIFE
// bundle, then calls GemmaPod.boot(el) — which is wired here.
//
// Boot sequence:
//   1. Initialize the WASM core from inlined bytes (no network).
//   2. Verify the inlined signed manifest. If verification fails the pod
//      refuses to render anything but a visible error so a tampered blob
//      can't impersonate the owner's persona / prompt.
//   3. Translate the verified Manifest into the PodConfig the chat UI
//      expects, and call `mount`.

import init, { GemmaPodCore } from "@gemmapod/core/web";
import type { PodConfig } from "./types";
import type { MountedPod } from "./embed";
import { mountPod } from "./embed";

interface RawManifest {
  v: number;
  id: string;
  name: string;
  persona: string;
  system_prompt: string;
  model?: string;
  owner_pubkey: string;
  transport: {
    preferred?: string[];
    webrtc?: { signal_url: string; pod_id: string };
    direct?: { base_url: string };
    fallback?: { tier?: string };
  };
  tools?: Array<{ name: string; description: string }>;
}

interface BootGlobals {
  __GEMMAPOD_WASM_B64?: string;
  __GEMMAPOD_MANIFEST_B64?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fail(el: HTMLElement, message: string): undefined {
  el.innerHTML = "";
  const div = document.createElement("div");
  div.style.cssText =
    "font-family:system-ui;padding:24px;color:#ff7a7a;background:#0d0d0f;border:1px solid #3a1f22;border-radius:12px;font-size:13px;";
  div.textContent = `gemmapod refused to mount: ${message}`;
  el.appendChild(div);
  return undefined;
}

function toPodConfig(m: RawManifest): PodConfig {
  return {
    name: m.name,
    persona: m.persona,
    systemPrompt: m.system_prompt,
    model: m.model,
    tools: m.tools ?? [],
    signedManifestB64: (window as unknown as BootGlobals).__GEMMAPOD_MANIFEST_B64,
    transport: {
      webrtc: m.transport.webrtc
        ? { signalUrl: m.transport.webrtc.signal_url, podId: m.transport.webrtc.pod_id }
        : undefined,
      direct: m.transport.direct ? { baseUrl: m.transport.direct.base_url } : undefined,
      fallback: m.transport.fallback
        ? { tier: m.transport.fallback.tier }
        : undefined,
    },
  };
}

export async function boot(el: HTMLElement): Promise<MountedPod | undefined> {
  const g = window as unknown as BootGlobals;
  const wasmB64 = g.__GEMMAPOD_WASM_B64;
  const manifestB64 = g.__GEMMAPOD_MANIFEST_B64;
  if (!wasmB64) return fail(el, "missing __GEMMAPOD_WASM_B64");
  if (!manifestB64) return fail(el, "missing __GEMMAPOD_MANIFEST_B64");

  try {
    await init(b64ToBytes(wasmB64));
  } catch (e) {
    return fail(el, `wasm init: ${(e as Error).message}`);
  }

  let manifest: RawManifest;
  try {
    manifest = GemmaPodCore.verifyManifest(b64ToBytes(manifestB64)) as RawManifest;
  } catch (e) {
    return fail(el, `manifest verification: ${(e as Error).message}`);
  }

  return mountPod(el, toPodConfig(manifest), { fallbackUi: "default" });
}

if (typeof window !== "undefined") {
  // Merge onto any prior GemmaPod surface (mount() from index.ts).
  const w = window as unknown as { GemmaPod?: Record<string, unknown> };
  w.GemmaPod = { ...(w.GemmaPod ?? {}), boot };
}
