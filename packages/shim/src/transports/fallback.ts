// In-browser fallback transport: runs Gemma 4 entirely on the visitor's
// device via transformers.js + WebGPU.
//
// Key UX rules:
//   - NEVER auto-download. The model is hundreds of MB; the user must
//     explicitly click "prepare". `selectTransport` only constructs the
//     transport in the `unprepared` state and returns it; the UI inspects
//     `state` and `cacheStatus()` to decide what to render.
//   - If the model is already in the browser cache (Cache API), the prepare
//     step is essentially free — surface this so users see they can flip
//     it on with one click.
//   - transformers.js itself is lazy-imported only when `prepare()` is
//     called, so an idle pod stays cheap.
//   - The user can abort a download/preparation in progress via abort().
//     This sets state back to "unprepared" so they can retry or pick a
//     different model.
//   - The user can choose between available model variants (E2B vs E4B)
//     before preparing. Changing the model resets to "unprepared".
//
// Gemma 4 E2B/E4B are multimodal models (Gemma4ForConditionalGeneration)
// with model_type "gemma4". The older pipeline("text-generation", ...) call
// fails with "Unsupported model type: gemma4" because pipelines don't map
// that architecture to a text-generation task. We load the tokenizer + model
// directly via AutoTokenizer + Gemma4ForConditionalGeneration, which is the
// officially documented path for this model and works for text-only chat too.

import type { DartcUiEvent } from "@gemmapod/dartc";
import type { ChatChunk, ChatMessage, Transport } from "../types";

type DartcUiEventObserver = (event: DartcUiEvent) => void;

export type FallbackState = "unprepared" | "preparing" | "ready" | "error";

export interface FallbackModelOption {
  id: string;
  label: string;
  sizeMB: number;
}

// Static list used as the immediate default and as a safety net when the API
// is unreachable. The canonical list lives at gemmapod.com/api/browser-models.
export const FALLBACK_MODELS: FallbackModelOption[] = [
  { id: "onnx-community/gemma-4-E2B-it-ONNX", label: "Gemma 4 E2B", sizeMB: 3000 },
  { id: "onnx-community/gemma-4-E4B-it-ONNX", label: "Gemma 4 E4B", sizeMB: 3900 },
];

const BROWSER_MODELS_URL = "https://gemmapod.com/api/browser-models";
let _modelsPromise: Promise<FallbackModelOption[]> | null = null;

function isValidModelList(data: unknown): data is FallbackModelOption[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    data.every(
      (m) => typeof m === "object" && m !== null && typeof (m as Record<string, unknown>).id === "string",
    )
  );
}

export function fetchBrowserModels(): Promise<FallbackModelOption[]> {
  if (!_modelsPromise) {
    _modelsPromise = fetch(BROWSER_MODELS_URL, { signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: unknown) => (isValidModelList(data) ? data : FALLBACK_MODELS))
      .catch(() => FALLBACK_MODELS);
  }
  return _modelsPromise;
}

export interface CacheInfo {
  state: "cached" | "missing" | "unavailable";
  files: number;
  bytes: number;
  likelyComplete: boolean;
}

export interface PrepareProgress {
  status: "initiate" | "download" | "progress" | "done" | "ready";
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

type TjsModule = typeof import("@huggingface/transformers");

interface LoadedModel {
  tokenizer: {
    apply_chat_template(
      messages: Array<{ role: string; content: string }>,
      opts: Record<string, unknown>,
    ): Record<string, unknown>;
  };
  model: {
    generate(opts: Record<string, unknown>): Promise<unknown>;
  };
  TextStreamer: new (tokenizer: unknown, opts: Record<string, unknown>) => unknown;
}

const TJS_CACHE_NAME = "transformers-cache";
const TJS_CDN_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/dist/transformers.min.js";

export class FallbackTransport implements Transport {
  readonly name = "fallback";
  state: FallbackState = "unprepared";
  lastError?: string;
  modelId: string;

  private loaded: LoadedModel | null = null;
  private aborted = false;
  private readonly uiEventObservers = new Set<DartcUiEventObserver>();

  constructor(initialModelId?: string) {
    this.modelId = initialModelId ?? FALLBACK_MODELS[0]!.id;
  }

  static supportsWebGPU(): boolean {
    return typeof navigator !== "undefined" && "gpu" in navigator && !!(navigator as { gpu?: unknown }).gpu;
  }

  onUiEvent(observer: DartcUiEventObserver): () => void {
    this.uiEventObservers.add(observer);
    return () => this.uiEventObservers.delete(observer);
  }

  private emitUiEvent(event: DartcUiEvent): void {
    for (const observer of this.uiEventObservers) observer(event);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gemmapod:ui-event", { detail: event }));
    }
  }

  private newRunId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  /** Switch to a different model variant. Only allowed in "unprepared" or
   *  "error" state. Returns true if the switch happened. */
  setModel(newModelId: string): boolean {
    if (this.state !== "unprepared" && this.state !== "error") return false;
    this.modelId = newModelId;
    this.lastError = undefined;
    return true;
  }

  /** Abort an in-progress prepare(). Resets state to "unprepared" so the
   *  user can retry or pick a different model. */
  abort(): void {
    this.aborted = true;
    this.loaded = null;
    this.state = "unprepared";
    this.lastError = undefined;
  }

  async cacheStatus(): Promise<CacheInfo> {
    if (typeof caches === "undefined") {
      return { state: "unavailable", files: 0, bytes: 0, likelyComplete: false };
    }
    let cache: Cache;
    try {
      cache = await caches.open(TJS_CACHE_NAME);
    } catch {
      return { state: "unavailable", files: 0, bytes: 0, likelyComplete: false };
    }
    const keys = await cache.keys();
    const prefix = `https://huggingface.co/${this.modelId}/resolve/`;
    let files = 0;
    let bytes = 0;
    for (const req of keys) {
      if (!req.url.startsWith(prefix)) continue;
      files++;
      const res = await cache.match(req);
      if (!res) continue;
      const len = res.headers.get("Content-Length");
      if (len) bytes += Number(len);
    }
    const likelyComplete = files >= 3 && bytes > 50 * 1024 * 1024;
    return {
      state: files > 0 ? "cached" : "missing",
      files,
      bytes,
      likelyComplete,
    };
  }

  async prepare(onProgress?: (p: PrepareProgress) => void): Promise<void> {
    if (this.state === "ready") return;
    if (this.state === "preparing") throw new Error("already preparing");
    if (!FallbackTransport.supportsWebGPU()) {
      this.state = "error";
      this.lastError = "WebGPU is not available in this browser";
      throw new Error(this.lastError);
    }

    this.aborted = false;
    this.state = "preparing";

    try {
      // Check abort flag before each major async step. We do NOT throw from
      // inside the progress callback — that would crash inside transformers.js
      // internals. Instead, we check a simple boolean flag after each await.
      const throwIfAborted = () => {
        if (this.aborted) throw new DOMException("Aborted", "AbortError");
      };

      const progressCallback = (data: PrepareProgress) => {
        // Forward progress to the UI even while aborting — the UI wants to
        // show real-time download stats right up to the point it cancels.
        // But do NOT throw here; instead let the next throwIfAborted() check
        // after the current await resolve/reject naturally.
        onProgress?.(data);
      };

      const tjs = (await import(/* @vite-ignore */ TJS_CDN_URL)) as unknown as TjsModule;
      throwIfAborted();

      const tokenizer = await tjs.AutoTokenizer.from_pretrained(this.modelId, {
        progress_callback: progressCallback,
      });
      throwIfAborted();

      // v4.2+ exports Gemma4ForConditionalGeneration which doesn't exist in
      // the v3.8 type definitions (the dev dependency). We access it through
      // a loose record cast — the class is present at runtime on the CDN build.
      const tjsAny = tjs as unknown as Record<string, unknown>;
      const Gemma4ForConditionalGeneration = tjsAny.Gemma4ForConditionalGeneration as {
        from_pretrained(modelId: string, opts: Record<string, unknown>): Promise<unknown>;
      };
      const model = await Gemma4ForConditionalGeneration.from_pretrained(this.modelId, {
        device: "webgpu",
        dtype: "q4f16",
        progress_callback: progressCallback,
      });
      throwIfAborted();

      this.loaded = {
        tokenizer: tokenizer as LoadedModel["tokenizer"],
        model: model as LoadedModel["model"],
        TextStreamer: tjs.TextStreamer as unknown as LoadedModel["TextStreamer"],
      };
      this.state = "ready";
      onProgress?.({ status: "ready" });
    } catch (e) {
      if (this.aborted || (e instanceof DOMException && e.name === "AbortError")) {
        this.state = "unprepared";
        this.lastError = undefined;
        return;
      }
      this.state = "error";
      this.lastError = (e as Error).message;
      throw e;
    }
  }

  async *chat(
    messages: ChatMessage[],
    model: string,
    _signal?: AbortSignal,
    conversationId?: string,
  ): AsyncIterable<ChatChunk> {
    if (this.state !== "ready" || !this.loaded) {
      throw new Error("fallback transport not prepared — call prepare() first");
    }
    const { tokenizer, model: tModel, TextStreamer } = this.loaded;

    const threadId = conversationId ?? "fallback:local";
    const runId = this.newRunId();
    const messageId = `${runId}:assistant`;
    const incomingMessages = messages.filter((m) => m.role !== "system");

    this.emitUiEvent({
      type: "RUN_STARTED",
      threadId,
      runId,
      input: { model: model || this.modelId, messages: incomingMessages },
    });
    this.emitUiEvent({
      type: "TEXT_MESSAGE_START",
      threadId,
      runId,
      messageId,
      role: "assistant",
    });

    const texts = messages.map((m) => ({ role: m.role, content: m.content }));

    let inputs: { input_ids: unknown; attention_mask?: unknown };
    try {
      inputs = tokenizer.apply_chat_template(texts, {
        add_generation_prompt: true,
        tokenize: true,
        return_dict: true,
      }) as { input_ids: unknown; attention_mask?: unknown };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.emitUiEvent({
        type: "RUN_ERROR",
        threadId,
        runId,
        message: err.message,
        code: "fallback_template_failed",
      });
      throw err;
    }

    const queue: ChatChunk[] = [];
    let waiter: ((v: IteratorResult<ChatChunk>) => void) | null = null;
    let finished = false;
    let failure: Error | null = null;

    const push = (chunk: ChatChunk) => {
      if (chunk.delta) {
        this.emitUiEvent({
          type: "TEXT_MESSAGE_CONTENT",
          threadId,
          runId,
          messageId,
          delta: chunk.delta,
        });
      }
      queue.push(chunk);
      if (waiter) {
        const w = waiter;
        waiter = null;
        const c = queue.shift()!;
        w({ value: c, done: false });
      }
    };

    const streamer = new TextStreamer(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text: string) => {
        if (text) push({ delta: text, done: false });
      },
    });

    const generateInputs: Record<string, unknown> = {
      ...inputs,
      max_new_tokens: 512,
      do_sample: false,
      streamer,
    };

    tModel
      .generate(generateInputs)
      .then(() => {
        finished = true;
        this.emitUiEvent({ type: "TEXT_MESSAGE_END", threadId, runId, messageId });
        this.emitUiEvent({ type: "RUN_FINISHED", threadId, runId });
        push({ delta: "", done: true });
      })
      .catch((e: unknown) => {
        failure = e instanceof Error ? e : new Error(String(e));
        finished = true;
        this.emitUiEvent({
          type: "RUN_ERROR",
          threadId,
          runId,
          message: failure.message,
          code: "fallback_chat_failed",
        });
        if (waiter) {
          const w = waiter;
          waiter = null;
          w({ value: undefined, done: true });
        }
      });

    while (true) {
      if (failure) throw failure;
      if (queue.length) {
        const c = queue.shift()!;
        if (c.done) return;
        yield c;
      } else if (finished) {
        return;
      } else {
        await new Promise<IteratorResult<ChatChunk>>((resolve) => {
          waiter = resolve;
        });
      }
    }
  }
}