// Type contracts for window.GemmaPod after loading gemmapod-shim.iife.js
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
  /** Convert a DartcUiEvent's SCREAMING_SNAKE `type` to AG-UI PascalCase. Fields unchanged. */
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
