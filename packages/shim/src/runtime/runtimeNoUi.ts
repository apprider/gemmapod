import type { PodConfig } from "../types";
import type { GemmaPodRuntime } from "./events";
import { createBrowserRuntime } from "./browserRuntime";

function noopMountChat(_runtime: GemmaPodRuntime, el: HTMLElement): void {
  if (el && typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      "[gemmapod/runtime] mount() ignored: this build excludes the Preact chat widget. Use mountPod({ ui: 'none' }) or wire your own UI to runtime.events and runtime.chat.",
    );
  }
}

export function createRuntime(config: PodConfig): GemmaPodRuntime {
  return createBrowserRuntime(config, {
    mountChat: noopMountChat,
    grantUiRenderCapability: false,
  });
}

export async function mountRuntime(el: HTMLElement, config: PodConfig): Promise<GemmaPodRuntime> {
  const runtime = createRuntime(config);
  await runtime.mount(el);
  return runtime;
}

export { isFallbackRuntimeTransport } from "./browserRuntime";
