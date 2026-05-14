/**
 * Runtime-only IIFE: transport, `runtime.events`, and `chat` without the Preact chat widget
 * (smaller; no Preact in this bundle). Does not include `boot`, `initCore`, or signing helpers.
 */
import { attachBrowserFallbackPrepare } from "./host/attachBrowserFallbackPrepare";
import { mapDartcUiEventToAgUi } from "./agUiMap";
import { executeMountPod, type MountPodOptions, type MountedPod } from "./mountPodCore";
import { quickTransportStatus } from "./status";
import type { PodConfig } from "./types";
import { createRuntime, mountRuntime } from "./runtime/runtimeNoUi";

export async function mountPod(
  el: HTMLElement | null,
  config: PodConfig,
  options: MountPodOptions = {},
): Promise<MountedPod> {
  return executeMountPod(el, config, options, createRuntime);
}

function mount(el: HTMLElement, config: PodConfig): ReturnType<typeof mountRuntime> {
  return mountRuntime(el, config);
}

if (typeof window !== "undefined") {
  (
    window as unknown as {
      GemmaPod: {
        create: typeof createRuntime;
        mount: typeof mount;
        mountPod: typeof mountPod;
        attachBrowserFallbackPrepare: typeof attachBrowserFallbackPrepare;
        quickTransportStatus: typeof quickTransportStatus;
        mapDartcUiEventToAgUi: typeof mapDartcUiEventToAgUi;
      };
    }
  ).GemmaPod = {
    create: createRuntime,
    mount,
    mountPod,
    attachBrowserFallbackPrepare,
    quickTransportStatus,
    mapDartcUiEventToAgUi,
  };
}
