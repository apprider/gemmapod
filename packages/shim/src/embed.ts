import type { PodConfig } from "./types";
import { createRuntime } from "./runtime";
import {
  executeMountPod,
  type MountPodOptions,
  type MountedPod,
} from "./mountPodCore";

export type {
  MountPodFallbackPlacement,
  MountPodFallbackUi,
  MountPodOptions,
  MountPodUiMode,
  MountedPod,
} from "./mountPodCore";

/**
 * Mount the chat widget and optionally the default in-browser (WebGPU) fallback UI in one step.
 * If `fallbackUi` is omitted and the manifest includes `transport.fallback`, defaults to `'default'`.
 */
export async function mountPod(
  el: HTMLElement | null,
  config: PodConfig,
  options: MountPodOptions = {},
): Promise<MountedPod> {
  return executeMountPod(el, config, options, createRuntime, {
    unmountChat: async (chatEl) => {
      const { render } = await import("preact");
      render(null, chatEl);
    },
  });
}
