#!/usr/bin/env node
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { Command } from "commander";
import { parse as parseToml } from "smol-toml";
import { fromToml, type Manifest } from "./manifest.js";
import { loadAssets, renderHtml } from "./bundle.js";

// The Node-target WASM is loaded via CommonJS require so wasm-bindgen's
// sync init runs at import time. The `./node` subpath export on @gemmapod/core
// resolves to pkg-node/.
const require = createRequire(import.meta.url);
const { GemmaPodCore } = require("@gemmapod/core/node") as {
  GemmaPodCore: {
    generateKey(): { publicKey: string; secretKey: string };
    signManifest(manifest: unknown, secretKey: Uint8Array): Uint8Array;
    verifyManifest(bytes: Uint8Array): unknown;
  };
};

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("hex string has odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function readKeyFile(p: string): Promise<{ publicKey: string; secretKey: string }> {
  const raw = await readFile(p, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.publicKey !== "string" || typeof parsed.secretKey !== "string") {
    throw new Error(`${p}: expected { publicKey, secretKey } in hex`);
  }
  return parsed;
}

async function cmdKeygen(opts: { out: string }): Promise<void> {
  const kp = GemmaPodCore.generateKey();
  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  await writeFile(opts.out, JSON.stringify(kp, null, 2));
  // Best-effort permission tightening; ignore on platforms that reject 0600.
  try {
    await chmod(opts.out, 0o600);
  } catch {
    // noop
  }
  console.log(`wrote keypair to ${opts.out}`);
  console.log(`  publicKey: ${kp.publicKey}`);
  console.log(`  copy this into pod.toml as owner_pubkey, then 'gemmapod build'.`);
}

const INIT_POD_TOML = `name = "my-agent"
persona = "A short description of your agent"
model = "gemma4:e4b"

system_prompt = """
You are a helpful agent packaged as a gemmapod. Be concise and safe.
"""

[transport]
preferred = ["webrtc", "fallback"]

[transport.webrtc]
signal_url = "https://signal.gemmapod.com/signal"
pod_id = "my-agent"

[transport.fallback]
tier = "e2b"
`;

const INIT_GITIGNORE = `# Owner signing keys — never commit
*.key
owner.key
`;

const INIT_EMBED_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>gemmapod embed example</title>
  <style>
    html, body { margin: 0; height: 100%; font-family: system-ui; }
    body { display: flex; flex-direction: column; padding: 16px; box-sizing: border-box; }
    #pod { flex: 1; min-height: 320px; max-width: 720px; width: 100%; margin: 0 auto; }
    [data-gemmapod-fallback-host] { max-width: 720px; width: 100%; margin: 0 auto 12px; }
  </style>
</head>
<body>
  <div id="pod"></div>
  <!-- Pin a version in production; add integrity="sha384-…" (see @gemmapod/browser README). -->
  <script src="https://cdn.jsdelivr.net/npm/@gemmapod/browser@0.1.0/dist/gemmapod-shim.iife.js"></script>
  <script>
    GemmaPod.mountPod(document.getElementById("pod"), {
      name: "my-agent",
      persona: "A short description of your agent",
      systemPrompt: "You are a helpful agent packaged as a gemmapod. Be concise and safe.",
      model: "gemma4:e4b",
      transport: {
        webrtc: { signalUrl: "https://signal.gemmapod.com/signal", podId: "my-agent" },
        fallback: { tier: "e2b" },
      },
    });
  </script>
</body>
</html>
`;

async function cmdInit(opts: { dir: string }): Promise<void> {
  const root = path.resolve(opts.dir);
  await mkdir(root, { recursive: true });
  const podPath = path.join(root, "pod.toml");
  const gitPath = path.join(root, ".gitignore");
  const htmlPath = path.join(root, "embed-example.html");
  try {
    await readFile(podPath);
    throw new Error(`${podPath} already exists — refusing to overwrite`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await writeFile(podPath, INIT_POD_TOML);
  await writeFile(gitPath, INIT_GITIGNORE);
  await writeFile(htmlPath, INIT_EMBED_HTML);
  console.log(`Initialized GemmaPod project in ${root}`);
  console.log(`  ${podPath}`);
  console.log(`  ${gitPath}`);
  console.log(`  ${htmlPath}`);
  console.log(`Next: gemmapod keygen --out ${path.join(root, "owner.key")}`);
  console.log(`Then: gemmapod build ${podPath} --key ${path.join(root, "owner.key")} --out ${path.join(root, "dist/my-agent.html")}`);
}

/** 32-byte Ed25519 public key as 64 hex chars (placeholder for validation-only parsing). */
const DUMMY_OWNER_PUBKEY = "0".repeat(64);

function doctorPreferred(raw: RawPodTomlForDoctor, issues: string[]): void {
  const pref = raw.transport?.preferred ?? ["webrtc", "fallback"];
  const have = new Set<string>();
  if (raw.transport?.webrtc?.signal_url && raw.transport?.webrtc?.pod_id) have.add("webrtc");
  if (raw.transport?.direct?.base_url) have.add("direct");
  if (raw.transport?.fallback) have.add("fallback");
  for (const p of pref) {
    if (!have.has(p)) issues.push(`transport.preferred lists "${p}" but [transport.${p}] is missing or incomplete`);
  }
  if (have.size === 0) issues.push("no transport configured — add at least one of [transport.webrtc], [transport.fallback], [transport.direct]");
}

interface RawPodTomlForDoctor {
  name?: string;
  system_prompt?: string;
  model?: string;
  transport?: {
    preferred?: string[];
    webrtc?: { signal_url?: string; pod_id?: string };
    direct?: { base_url?: string };
    fallback?: { tier?: string };
  };
  tools?: Array<{ name?: string; description?: string }>;
}

async function cmdDoctor(podTomlPath: string): Promise<void> {
  const tomlText = await readFile(podTomlPath, "utf8");
  const raw = parseToml(tomlText) as RawPodTomlForDoctor;
  const issues: string[] = [];
  doctorPreferred(raw, issues);
  try {
    fromToml(raw as Parameters<typeof fromToml>[0], DUMMY_OWNER_PUBKEY);
  } catch (e) {
    issues.push((e as Error).message);
  }
  if (issues.length) {
    console.error("gemmapod doctor: issues found:");
    for (const line of issues) console.error(`  - ${line}`);
    process.exit(1);
  }
  console.log(`gemmapod doctor: ${podTomlPath} looks OK.`);
}

async function cmdBuild(podTomlPath: string, opts: { key: string; out: string }): Promise<void> {
  const tomlText = await readFile(podTomlPath, "utf8");
  const raw = parseToml(tomlText);

  const kp = await readKeyFile(opts.key);
  const manifest: Manifest = fromToml(raw as Parameters<typeof fromToml>[0], kp.publicKey);

  const sigBytes = GemmaPodCore.signManifest(manifest, hexToBytes(kp.secretKey));

  // Confidence check: round-trip via the same verify path the browser uses.
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

  await mkdir(path.dirname(path.resolve(opts.out)), { recursive: true });
  await writeFile(opts.out, html);
  const sizeKB = (html.length / 1024).toFixed(1);
  console.log(`wrote ${opts.out} (${sizeKB} KB)`);
  console.log(`  pod id:  ${manifest.id}`);
  console.log(`  signer:  ${manifest.owner_pubkey.slice(0, 16)}…`);
  console.log(`  transport preferred: ${manifest.transport.preferred.join(" → ")}`);
}

const program = new Command();
program
  .name("gemmapod")
  .description("Package a pod.toml + owner key into a single signed .html blob.");

program
  .command("keygen")
  .description("Generate a fresh Ed25519 keypair and write it to a JSON file.")
  .requiredOption("--out <path>", "output keypair file (JSON, mode 0600)")
  .action((opts) => cmdKeygen(opts).catch(fail));

program
  .command("init")
  .description("Scaffold pod.toml, .gitignore, and a sample embed-example.html.")
  .option("--dir <path>", "directory to write into", ".")
  .action((opts: { dir: string }) => cmdInit({ dir: opts.dir }).catch(fail));

program
  .command("doctor <pod.toml>")
  .description("Validate pod.toml (transports, required fields) without building.")
  .action((file: string) => cmdDoctor(file).catch(fail));

program
  .command("build <pod.toml>")
  .description("Build a signed pod .html blob from a manifest.")
  .requiredOption("--key <path>", "path to the owner keypair JSON (see `keygen`)")
  .requiredOption("--out <path>", "output .html path")
  .action((file, opts) => cmdBuild(file, opts).catch(fail));

function fail(e: Error): never {
  console.error("gemmapod:", e.message);
  process.exit(1);
}

program.parseAsync();
