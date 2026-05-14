// Single bundled entry for the shim's IIFE build.
//
//   mount(el, config) — caller passes the config in directly. Used by
//     apps/web (the live demo widget) and the dev playgrounds.
//   attachBrowserFallbackPrepare(hostEl, runtime) — optional DOM host for the
//     WebGPU fallback (model picker + explicit prepare). Not part of the Preact widget.
//   sign / verify / generateKey — re-exports of GemmaPodCore + init so
//     apps/web's /build page can sign manifests fully in the browser.
//     The wasm is already inlined as a data: URL inside this IIFE, so a
//     single `<script src="/vendor/gemmapod-shim.iife.js">` load gives
//     the page everything it needs.

import wasmInit, { GemmaPodCore } from "@gemmapod/core/web";
import { embeddedWasmBytes } from "./wasmBytes";

export { createRuntime, mount } from "./index";
export { boot } from "./boot";
export { attachBrowserFallbackPrepare } from "./host/attachBrowserFallbackPrepare";
export { mountPod } from "./embed";
export { quickTransportStatus } from "./status";
export { mapDartcUiEventToAgUi } from "./agUiMap";
export type { AgUiEvent, AgUiKnownEventType } from "./agUiMap";
export type {
  MountedPod,
  MountPodFallbackPlacement,
  MountPodFallbackUi,
  MountPodOptions,
  MountPodUiMode,
} from "./embed";
export { GemmaPodCore, wasmInit };
export type {
  GemmaPodRuntime,
  RuntimeChatApi,
  RuntimeChatInput,
  RuntimeEvent,
  RuntimeEventBus,
  RuntimeStateStore,
  RuntimeTransportState,
} from "./runtime";

/** Initialise the inlined WASM core. Safe to call repeatedly. */
let initPromise: Promise<void> | null = null;
export function initCore(): Promise<void> {
  if (!initPromise) {
    initPromise = embeddedWasmBytes()
      .then((bytes) => wasmInit({ module_or_path: bytes }))
      .then(() => undefined);
  }
  return initPromise;
}
