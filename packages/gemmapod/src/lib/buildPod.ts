import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { parse as parseToml } from "smol-toml";

const _require = createRequire(import.meta.url);
const { GemmaPodCore } = _require("@gemmapod/core/node") as {
  GemmaPodCore: {
    generateKey(): { publicKey: string; secretKey: string };
    signManifest(manifest: unknown, secretKey: Uint8Array): Uint8Array;
    verifyManifest(bytes: Uint8Array): unknown;
  };
};

// --- Manifest types (mirrors packages/pack/src/manifest.ts) ---

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

export interface RawPodToml {
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

// --- Asset loading (same as packages/pack/src/bundle.ts) ---

function packageFile(specifier: string): string {
  return _require.resolve(specifier);
}

async function loadAssets(): Promise<{ shimJs: string; wasmBytes: Uint8Array }> {
  let shimPath: string;
  try {
    shimPath = packageFile("@gemmapod/browser/dist/gemmapod-shim.iife.js");
  } catch {
    shimPath = packageFile("@gemmapod/shim/dist/gemmapod-shim.iife.js");
  }
  const wasmPath = packageFile("@gemmapod/core/pkg/gemmapod_core_bg.wasm");
  const shimJs = await readFile(shimPath, "utf8").catch(() => {
    throw new Error(
      `shim bundle not found at ${shimPath} — run 'pnpm --filter @gemmapod/shim build' first`,
    );
  });
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  return { shimJs, wasmBytes };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderHtml(params: { title: string; manifestB64: string; wasmB64: string; shimJs: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(params.title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #050507; font-family: system-ui, sans-serif; }
  #pod { position: fixed; top: 24px; bottom: 24px; left: 50%; transform: translateX(-50%); width: calc(100% - 48px); max-width: 720px; margin: 0 auto; }
  [data-gemmapod-fallback-host] { margin-bottom: 12px; }
  @media (max-width: 768px) {
    #pod { left: 16px; right: 16px; transform: none; width: auto; max-width: none; top: 24px; bottom: 12px; }
  }
</style>
</head>
<body>
<div id="pod">
  <noscript style="color:#ff7a7a;padding:24px;display:block">
    This is a gemmapod — a portable AI agent capsule. It needs JavaScript to run.
  </noscript>
</div>
<script>
  window.__GEMMAPOD_WASM_B64 = "${params.wasmB64}";
  window.__GEMMAPOD_MANIFEST_B64 = "${params.manifestB64}";
</script>
<script>
${params.shimJs}
</script>
<script>
  window.GemmaPod.boot(document.getElementById("pod"));
</script>
</body>
</html>
`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("hex string has odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// --- Public API ---

export interface BuildPodOptions {
  podTomlPath?: string;
  rawToml?: RawPodToml;
  keyPath: string;
  outPath: string;
}

export interface BuildResult {
  htmlPath: string;
  sizeKB: string;
  manifest: Manifest;
}

export async function readKeyFile(p: string): Promise<{ publicKey: string; secretKey: string }> {
  const raw = await readFile(p, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).publicKey !== "string" ||
    typeof (parsed as Record<string, unknown>).secretKey !== "string"
  ) {
    throw new Error(`${p}: expected { publicKey, secretKey } in hex`);
  }
  return parsed as { publicKey: string; secretKey: string };
}

export async function buildPod(opts: BuildPodOptions): Promise<BuildResult> {
  let raw: RawPodToml;
  if (opts.rawToml) {
    raw = opts.rawToml;
  } else if (opts.podTomlPath) {
    const tomlText = await readFile(opts.podTomlPath, "utf8");
    raw = parseToml(tomlText) as RawPodToml;
  } else {
    throw new Error("buildPod: either rawToml or podTomlPath must be provided");
  }

  const kp = await readKeyFile(opts.keyPath);
  const manifest: Manifest = fromToml(raw, kp.publicKey);
  const sigBytes = GemmaPodCore.signManifest(manifest, hexToBytes(kp.secretKey));

  const verified = GemmaPodCore.verifyManifest(sigBytes) as Manifest;
  if (verified.id !== manifest.id || verified.owner_pubkey !== manifest.owner_pubkey) {
    throw new Error("internal: signed manifest failed round-trip verification");
  }

  const { shimJs, wasmBytes } = await loadAssets();
  const html = renderHtml({
    title: manifest.name,
    manifestB64: Buffer.from(sigBytes).toString("base64"),
    wasmB64: Buffer.from(wasmBytes).toString("base64"),
    shimJs,
  });

  await mkdir(path.dirname(path.resolve(opts.outPath)), { recursive: true });
  await writeFile(opts.outPath, html);
  const sizeKB = (html.length / 1024).toFixed(1);
  return { htmlPath: opts.outPath, sizeKB, manifest };
}

export async function keygenToFile(outPath: string): Promise<{ publicKey: string; secretKey: string }> {
  const kp = GemmaPodCore.generateKey();
  await mkdir(path.dirname(path.resolve(outPath)), { recursive: true });
  await writeFile(outPath, JSON.stringify(kp, null, 2));
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(outPath, 0o600);
  } catch {
    // noop on platforms that reject 0600
  }
  return kp;
}
