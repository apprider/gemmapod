import type { PodConfig } from "./types";
import { attachBrowserFallbackPrepare } from "./host/attachBrowserFallbackPrepare";
import type { GemmaPodRuntime } from "./runtime/events";

/** Where to place the auto-generated fallback panel relative to the chat mount node. */
export type MountPodFallbackPlacement = "before" | "after" | "prepend";

/** `'default'` — insert a panel and wire `attachBrowserFallbackPrepare`. `HTMLElement` — use that node. `'none'` — host builds UI only. */
export type MountPodFallbackUi = "default" | "none" | HTMLElement;

export type MountPodUiMode = "chat" | "none";

export interface MountPodOptions {
  /**
   * `'chat'` (default) — mount the built-in Preact widget into `el` (requires full shim).
   * `'none'` — headless: no chat UI; attach your own UX to `runtime.events` and `runtime.chat`.
   */
  ui?: MountPodUiMode;
  fallbackUi?: MountPodFallbackUi;
  /** When `fallbackUi` is `'default'`, where to put the generated host. Default: `before` (relative to chat `el` or `fallbackMountParent`). */
  fallbackPlacement?: MountPodFallbackPlacement;
  /**
   * When `ui` is `'none'` and `fallbackUi` is `'default'`, the auto-created fallback panel is inserted
   * under this element. Defaults to `document.body` in the browser.
   */
  fallbackMountParent?: HTMLElement;
}

export interface MountedPod {
  readonly runtime: GemmaPodRuntime;
  /** Unmount Preact chat (full shim only), remove auto-created fallback host if any, tear down transport. */
  destroy(): Promise<void>;
}

export interface ExecuteMountPodLifecycle {
  /** Full shim: remove Preact root from the chat container. Omit in runtime-only builds to avoid a Preact dependency. */
  unmountChat?: (chatEl: HTMLElement) => Promise<void>;
}

function resolveFallbackUi(config: PodConfig, explicit: MountPodFallbackUi | undefined): MountPodFallbackUi {
  const hasFallback = Boolean(config.transport.fallback);
  if (explicit === undefined) return hasFallback ? "default" : "none";
  if (explicit === "default" && !hasFallback) return "none";
  return explicit;
}

function resolveUiMode(explicit: MountPodUiMode | undefined): MountPodUiMode {
  return explicit ?? "chat";
}

function createFallbackHostRelativeToChat(chatEl: HTMLElement, placement: MountPodFallbackPlacement): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-gemmapod-fallback-host", "");

  if (placement === "prepend") {
    chatEl.prepend(host);
    return host;
  }

  const parent = chatEl.parentNode;
  if (parent) {
    if (placement === "before") parent.insertBefore(host, chatEl);
    else parent.insertBefore(host, chatEl.nextSibling);
    return host;
  }

  chatEl.prepend(host);
  return host;
}

/** When there is no chat mount node (`ui: 'none'`), attach fallback host into a parent (`document.body` by default). */
function createFallbackHostInParent(parent: HTMLElement, placement: MountPodFallbackPlacement): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-gemmapod-fallback-host", "");

  if (placement === "prepend") {
    parent.prepend(host);
    return host;
  }
  if (placement === "before") {
    if (parent.firstChild) parent.insertBefore(host, parent.firstChild);
    else parent.appendChild(host);
    return host;
  }
  parent.appendChild(host);
  return host;
}

/**
 * Shared mount implementation. `createRuntimeFn` selects full (Preact) vs runtime-only construction.
 */
export async function executeMountPod(
  el: HTMLElement | null,
  config: PodConfig,
  options: MountPodOptions,
  createRuntimeFn: (config: PodConfig) => GemmaPodRuntime,
  lifecycle: ExecuteMountPodLifecycle = {},
): Promise<MountedPod> {
  const ui = resolveUiMode(options.ui);

  if (ui === "chat" && !el) {
    throw new TypeError("mountPod: `el` is required when options.ui is 'chat'");
  }

  const runtime = createRuntimeFn(config);
  let didMountChat = false;
  if (ui === "chat" && el) {
    await runtime.mount(el);
    didMountChat = true;
  }

  const mode = resolveFallbackUi(config, options.fallbackUi);
  let fallbackUnmount: (() => void) | null = null;
  let createdHost: HTMLElement | null = null;

  if (mode instanceof HTMLElement) {
    fallbackUnmount = attachBrowserFallbackPrepare(mode, runtime);
  } else if (mode === "default") {
    const placement = options.fallbackPlacement ?? "before";
    if (ui === "chat" && el) {
      createdHost = createFallbackHostRelativeToChat(el, placement);
    } else {
      const parent =
        options.fallbackMountParent ?? (typeof document !== "undefined" ? document.body : null);
      if (!parent) {
        throw new TypeError(
          "mountPod: when ui is 'none' and fallbackUi is 'default', provide `fallbackMountParent` or run in a browser with `document.body`",
        );
      }
      createdHost = createFallbackHostInParent(parent, placement);
    }
    fallbackUnmount = attachBrowserFallbackPrepare(createdHost, runtime);
  }

  const chatMountEl = ui === "chat" ? el : null;

  let killed = false;
  return {
    runtime,
    async destroy() {
      if (killed) return;
      killed = true;
      fallbackUnmount?.();
      fallbackUnmount = null;
      createdHost?.remove();
      createdHost = null;
      if (didMountChat && chatMountEl && lifecycle.unmountChat) {
        await lifecycle.unmountChat(chatMountEl);
      }
      await runtime.destroy();
    },
  };
}
