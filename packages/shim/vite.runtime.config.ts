import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Second pass: runtime-only IIFE (no Preact). Run after main `vite build` with emptyOutDir: false. */
export default defineConfig({
  plugins: [preact()],
  build: {
    target: "es2022",
    assetsInlineLimit: 1_000_000,
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/entry-runtime.ts"),
      output: {
        format: "iife",
        name: "GemmaPod",
        inlineDynamicImports: true,
        entryFileNames: "gemmapod-runtime.iife.js",
      },
    },
  },
});
