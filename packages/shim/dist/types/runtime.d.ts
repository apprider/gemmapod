// Type contracts for window.GemmaPod after loading gemmapod-runtime.iife.js
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
