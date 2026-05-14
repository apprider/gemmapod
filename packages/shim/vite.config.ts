import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [preact()],
  server: { port: 5173 },
  build: {
    target: "es2022",
    assetsInlineLimit: 1_000_000,
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "src/entry.ts"),
      output: {
        format: "iife",
        name: "GemmaPod",
        inlineDynamicImports: true,
        entryFileNames: "gemmapod-shim.iife.js",
      },
    },
  },
});
