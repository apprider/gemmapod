#!/usr/bin/env node
// Pre-pack step for @gemmapod/shim:
//
// 1. Assert both Vite-produced IIFEs exist (`pnpm build` writes them via
//    vite.config.ts + vite.runtime.config.ts).
// 2. Write hand-curated `.d.ts` stubs into `dist/types/` so consumers get
//    typed access to `window.GemmaPod`. We do NOT use `tsc --declaration`
//    because the shim ships as IIFE side-effect bundles, not ESM — auto-
//    emitted declarations would describe ~30 internal modules rather than
//    the actual public surface (the global).
//
// The d.ts contracts here match @gemmapod/browser's `prepack.mjs` so both
// distribution channels surface the exact same TypeScript API.

import { readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const distDir = join(pkgRoot, "dist");
const typesDir = join(distDir, "types");

const fullIife = join(distDir, "gemmapod-shim.iife.js");
const runtimeIife = join(distDir, "gemmapod-runtime.iife.js");

function assertBundle(path, label) {
  try {
    const st = statSync(path);
    if (st.size < 1024) throw new Error("suspiciously small");
    return st.size;
  } catch (e) {
    console.error(
      `[@gemmapod/shim] ${label} missing or invalid at ${path}: ${e.message}\n` +
        `Run: pnpm --filter @gemmapod/shim build`,
    );
    process.exit(1);
  }
}

const fullBytes = assertBundle(fullIife, "full IIFE");
const runtimeBytes = assertBundle(runtimeIife, "runtime IIFE");

mkdirSync(typesDir, { recursive: true });

const dtsFull = `// Type contracts for window.GemmaPod after loading gemmapod-shim.iife.js
// (full build: runtime + Preact widget + boot + signing helpers).

export interface MountedPod {
  readonly runtime: unknown;
  destroy(): Promise<void>;
}

export type MountPodUiMode = "chat" | "none";
export type MountPodFallbackUi = "default" | "none" | HTMLElement;
export type MountPodFallbackPlacement = "before" | "after" | "prepend";

export interface MountPodOptions {
  ui?: MountPodUiMode;
  fallbackUi?: MountPodFallbackUi;
  fallbackPlacement?: MountPodFallbackPlacement;
  fallbackMountParent?: HTMLElement;
}

export interface GemmaPodFullGlobal {
  create(config: unknown): unknown;
  mount(el: HTMLElement, config: unknown): Promise<unknown>;
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: MountPodOptions,
  ): Promise<MountedPod>;
  boot(el: HTMLElement): Promise<MountedPod | undefined>;
  attachBrowserFallbackPrepare(container: HTMLElement | null, runtime: unknown): () => void;
  quickTransportStatus(runtime: unknown): {
    phase: string;
    transportName: string | null;
    detail: string;
  };
  /** Convert a DartcUiEvent's SCREAMING_SNAKE \`type\` to AG-UI PascalCase. Fields unchanged. */
  mapDartcUiEventToAgUi(event: unknown): unknown;
  initCore(): Promise<void>;
  GemmaPodCore: unknown;
  wasmInit: unknown;
}

declare global {
  interface Window {
    GemmaPod: GemmaPodFullGlobal;
  }
}

export {};
`;

const dtsRuntime = `// Type contracts for window.GemmaPod after loading gemmapod-runtime.iife.js
// (runtime-only: transport + events + chat; no Preact widget, no boot, no signing).

export interface MountedPod {
  readonly runtime: unknown;
  destroy(): Promise<void>;
}

export type MountPodUiMode = "chat" | "none";
export type MountPodFallbackUi = "default" | "none" | HTMLElement;
export type MountPodFallbackPlacement = "before" | "after" | "prepend";

export interface MountPodOptions {
  ui?: MountPodUiMode;
  fallbackUi?: MountPodFallbackUi;
  fallbackPlacement?: MountPodFallbackPlacement;
  fallbackMountParent?: HTMLElement;
}

export interface GemmaPodRuntimeGlobal {
  create(config: unknown): unknown;
  mount(el: HTMLElement, config: unknown): Promise<unknown>;
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: MountPodOptions,
  ): Promise<MountedPod>;
  attachBrowserFallbackPrepare(container: HTMLElement | null, runtime: unknown): () => void;
  quickTransportStatus(runtime: unknown): {
    phase: string;
    transportName: string | null;
    detail: string;
  };
  mapDartcUiEventToAgUi(event: unknown): unknown;
}

declare global {
  interface Window {
    GemmaPod: GemmaPodRuntimeGlobal;
  }
}

export {};
`;

writeFileSync(join(typesDir, "index.d.ts"), dtsFull);
writeFileSync(join(typesDir, "runtime.d.ts"), dtsRuntime);

console.log(
  `[@gemmapod/shim] ok — ${fullIife} (${fullBytes} B), ${runtimeIife} (${runtimeBytes} B), d.ts written`,
);
