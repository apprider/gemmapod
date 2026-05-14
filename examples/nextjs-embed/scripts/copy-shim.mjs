// Copies the shim IIFE from the workspace @gemmapod/browser into public/vendor/
// so the Next.js page can load it via /vendor/gemmapod-shim.iife.js.
//
// In a downstream app installing @gemmapod/browser from npm, this same
// pattern works — point `src` at the installed package's dist path:
//   const src = require.resolve("@gemmapod/browser/dist/gemmapod-shim.iife.js")

import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const root = join(__dirname, "..");
const destDir = join(root, "public", "vendor");
mkdirSync(destDir, { recursive: true });

let src;
try {
  src = require.resolve("@gemmapod/browser/dist/gemmapod-shim.iife.js");
} catch (e) {
  console.error(
    "[copy-shim] @gemmapod/browser not resolvable. Run from repo root:\n" +
      "  pnpm install\n" +
      "  pnpm --filter @gemmapod/shim build && pnpm --filter @gemmapod/browser build",
  );
  console.error(e);
  process.exit(1);
}

const dest = join(destDir, "gemmapod-shim.iife.js");
copyFileSync(src, dest);
const size = statSync(dest).size;
console.log(`[copy-shim] wrote ${dest} (${(size / 1024).toFixed(1)} KB)`);
