import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, "..");
const repoRoot = join(__dirname, "..", "..", "..");
const shimIife = join(repoRoot, "packages/shim/dist/gemmapod-shim.iife.js");
const runtimeIife = join(repoRoot, "packages/shim/dist/gemmapod-runtime.iife.js");
const outDir = join(pkgRoot, "dist");
const outShim = join(outDir, "gemmapod-shim.iife.js");
const outRuntime = join(outDir, "gemmapod-runtime.iife.js");

mkdirSync(outDir, { recursive: true });
function copyOrExit(from, to, label) {
  let body;
  try {
    body = readFileSync(from);
  } catch {
    console.error(
      `[@gemmapod/browser] Missing ${label}. From repo root run:\n  pnpm --filter @gemmapod/shim build`,
    );
    process.exit(1);
  }
  copyFileSync(from, to);
  return body.length;
}

const shimBytes = copyOrExit(shimIife, outShim, "shim IIFE");
const runtimeBytes = copyOrExit(runtimeIife, outRuntime, "runtime IIFE");

const dtsStandalone = `/** Populated after loading gemmapod-shim.iife.js */
export interface MountedPodBrowser {
  readonly runtime: unknown;
  destroy(): Promise<void>;
}

export interface MountPodOptionsBrowser {
  ui?: "chat" | "none";
  fallbackUi?: "default" | "none" | HTMLElement;
  fallbackPlacement?: "before" | "after" | "prepend";
  fallbackMountParent?: HTMLElement;
}

export interface GemmaPodBrowserGlobal {
  create(config: unknown): unknown;
  mount(el: HTMLElement, config: unknown): Promise<unknown>;
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: MountPodOptionsBrowser,
  ): Promise<MountedPodBrowser>;
  boot(el: HTMLElement): Promise<MountedPodBrowser | undefined>;
  attachBrowserFallbackPrepare(container: HTMLElement | null, runtime: unknown): () => void;
  quickTransportStatus(runtime: unknown): {
    phase: string;
    transportName: string | null;
    detail: string;
  };
  /** Convert GemmaPod \`DartcUiEvent\` discriminant to AG-UI PascalCase \`type\` (same payload fields). */
  mapDartcUiEventToAgUi(event: unknown): unknown;
}

declare global {
  interface Window {
    GemmaPod: GemmaPodBrowserGlobal;
  }
}

export {};
`;

const dtsRuntime = `/** Populated after loading gemmapod-runtime.iife.js (no boot, no signing helpers). */
export interface MountedPodBrowserRuntime {
  readonly runtime: unknown;
  destroy(): Promise<void>;
}

export interface MountPodOptionsBrowserRuntime {
  ui?: "chat" | "none";
  fallbackUi?: "default" | "none" | HTMLElement;
  fallbackPlacement?: "before" | "after" | "prepend";
  fallbackMountParent?: HTMLElement;
}

export interface GemmaPodBrowserRuntimeGlobal {
  create(config: unknown): unknown;
  mount(el: HTMLElement, config: unknown): Promise<unknown>;
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: MountPodOptionsBrowserRuntime,
  ): Promise<MountedPodBrowserRuntime>;
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
    GemmaPod: GemmaPodBrowserRuntimeGlobal;
  }
}

export {};
`;

writeFileSync(join(outDir, "gemmapod-browser.d.ts"), dtsStandalone);
writeFileSync(join(outDir, "gemmapod-browser-runtime.d.ts"), dtsRuntime);
console.log(
  `[@gemmapod/browser] Wrote ${outShim} (${shimBytes} bytes), ${outRuntime} (${runtimeBytes} bytes), and d.ts files`,
);
