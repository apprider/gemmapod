import type { PodConfig } from "../types";
import { mountChatWidget } from "../mountChatWidget";
import type { GemmaPodRuntime } from "./events";
import { createBrowserRuntime } from "./browserRuntime";

export function createRuntime(config: PodConfig): GemmaPodRuntime {
  return createBrowserRuntime(config, {
    mountChat: mountChatWidget,
    grantUiRenderCapability: true,
  });
}

export async function mountRuntime(el: HTMLElement, config: PodConfig): Promise<GemmaPodRuntime> {
  const runtime = createRuntime(config);
  await runtime.mount(el);
  return runtime;
}

export { isFallbackRuntimeTransport } from "./browserRuntime";
