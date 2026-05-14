import type { PodConfig } from "./types";
import { createRuntime, mountRuntime } from "./runtime";
import type { GemmaPodRuntime } from "./runtime";
import { attachBrowserFallbackPrepare } from "./host/attachBrowserFallbackPrepare";
import { mountPod } from "./embed";
import { quickTransportStatus } from "./status";
import { mapDartcUiEventToAgUi } from "./agUiMap";

export type { PodConfig } from "./types";
export type {
  AgUiEvent,
  AgUiKnownEventType,
} from "./agUiMap";
export type {
  GemmaPodRuntime,
  RuntimeChatApi,
  RuntimeChatInput,
  RuntimeEvent,
  RuntimeEventBus,
  RuntimeStateStore,
  RuntimeTransportState,
} from "./runtime";
export type {
  MountedPod,
  MountPodFallbackPlacement,
  MountPodFallbackUi,
  MountPodOptions,
  MountPodUiMode,
} from "./embed";
export { createRuntime, mountRuntime } from "./runtime";
export { mountPod } from "./embed";
export { attachBrowserFallbackPrepare } from "./host/attachBrowserFallbackPrepare";
export { quickTransportStatus } from "./status";
export { mapDartcUiEventToAgUi } from "./agUiMap";

export function mount(el: HTMLElement, config: PodConfig): Promise<GemmaPodRuntime> {
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
