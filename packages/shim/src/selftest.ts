// Browser smoke test for the WASM core. Run on /selftest.html.
//
// Validates the full sign → verify round-trip end-to-end:
//   1. WASM init.
//   2. Generate an Ed25519 keypair.
//   3. Sign a manifest.
//   4. Verify it (must succeed, must yield the original fields).
//   5. Tamper one byte in the signed bytes (must fail verification).

import { coreReady, generateKey, signManifest, verifyManifest, type Manifest } from "./core";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function log(ok: boolean, msg: string) {
  const row = document.createElement("div");
  row.style.fontFamily = "ui-monospace, monospace";
  row.style.padding = "4px 0";
  row.style.color = ok ? "#7adf7a" : "#ff7a7a";
  row.textContent = `${ok ? "PASS" : "FAIL"}  ${msg}`;
  document.body.appendChild(row);
  console[ok ? "log" : "error"](row.textContent);
}

async function main() {
  document.body.style.cssText = "background:#0a0a0c;color:#e7e7ea;padding:24px;font-family:system-ui";
  document.body.innerHTML = "<h2 style='margin:0 0 12px'>@gemmapod/core selftest</h2>";

  await coreReady();
  log(true, "WASM module initialized");

  const { publicKey, secretKey } = generateKey();
  log(publicKey.length === 64 && secretKey.length === 64, `Generated key (pk=${publicKey.slice(0, 12)}…)`);

  const manifest: Manifest = {
    v: 1,
    id: "selftest",
    name: "Selftest Pod",
    persona: "test",
    system_prompt: "You are a test pod.",
    model: "gemma4:e4b",
    owner_pubkey: publicKey,
    transport: { preferred: ["direct"], direct: { base_url: "http://localhost:11434" } },
    tools: [],
  };

  const signed = signManifest(manifest, hexToBytes(secretKey));
  log(signed.length > 0, `Signed manifest (${signed.length} bytes CBOR)`);

  const verified = verifyManifest(signed);
  log(verified.id === "selftest" && verified.owner_pubkey === publicKey, "Verification round-trip preserves fields");

  // Tamper the payload: flip a bit ~20% of the way in (past the sig).
  const tampered = signed.slice();
  const tamperIdx = Math.floor(tampered.length * 0.6);
  tampered[tamperIdx] = tampered[tamperIdx]! ^ 0xff;
  let tamperRejected = false;
  try {
    verifyManifest(tampered);
  } catch {
    tamperRejected = true;
  }
  log(tamperRejected, "Tampered manifest rejected by signature check");

  log(true, "all done");
}

main().catch((e) => log(false, `unexpected: ${(e as Error).message}`));
