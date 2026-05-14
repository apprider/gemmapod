import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Resolve a file shipped inside an installed npm package. */
function packageFile(specifier: string): string {
  return require.resolve(specifier);
}

export interface BundleAssets {
  shimJs: string;
  wasmBytes: Uint8Array;
}

export async function loadAssets(): Promise<BundleAssets> {
  let shimPath: string;
  try {
    shimPath = packageFile("@gemmapod/browser/dist/gemmapod-shim.iife.js");
  } catch {
    shimPath = packageFile("@gemmapod/shim/dist/gemmapod-shim.iife.js");
  }
  const wasmPath = packageFile("@gemmapod/core/pkg/gemmapod_core_bg.wasm");

  let shimJs: string;
  try {
    shimJs = await readFile(shimPath, "utf8");
  } catch {
    throw new Error(
      `shim bundle not found at ${shimPath} — install @gemmapod/browser or run 'pnpm --filter @gemmapod/shim build' first`,
    );
  }
  const wasmBytes = new Uint8Array(await readFile(wasmPath));
  return { shimJs, wasmBytes };
}

const TEMPLATE = (params: {
  title: string;
  manifestB64: string;
  wasmB64: string;
  shimJs: string;
}): string => `<!doctype html>
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(params: {
  title: string;
  manifestB64: string;
  wasmB64: string;
  shimJs: string;
}): string {
  return TEMPLATE(params);
}
