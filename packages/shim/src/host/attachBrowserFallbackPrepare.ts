// Host-side UI for the in-browser (WebGPU) fallback transport — not part of the
// Preact chat widget. Embedders call this with a container element next to the
// pod mount so visitors can opt in to downloading Gemma locally.

import type { GemmaPodRuntime } from "../runtime/events";
import type { PrepareProgress } from "../transports/fallback";
import { FallbackTransport, FALLBACK_MODELS, type FallbackModelOption } from "../transports/fallback";

function resolveModelOptions(transport: FallbackTransport, manifest: GemmaPodRuntime["manifest"]): FallbackModelOption[] {
  const fb = manifest.transport.fallback;
  if (!fb) return [];
  if (fb.models?.length) return fb.models;
  const hit = FALLBACK_MODELS.find((m) => m.id === transport.modelId);
  return [hit ?? { id: fb.model, label: fb.model, sizeMB: 0 }];
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function cacheLabel(files: number, bytes: number, likely: boolean, state: string): string {
  if (state === "unavailable") return "unavailable";
  if (state === "missing") return "not cached";
  return likely ? `${files} files · ${formatBytes(bytes)}` : `${files} files cached`;
}

function progressPercent(progress: Map<string, PrepareProgress>): number {
  let loaded = 0;
  let total = 0;
  for (const p of progress.values()) {
    loaded += p.loaded ?? 0;
    total += p.total ?? 0;
  }
  return total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
}

/** Mount fallback download / prepare controls. Returns an unmount cleanup. */
export function attachBrowserFallbackPrepare(
  container: HTMLElement | null,
  runtime: GemmaPodRuntime,
): () => void {
  if (!container) return () => {};
  let progressMap = new Map<string, PrepareProgress>();
  let cacheFetch = 0;

  const paint = () => {
    const t = runtime.getTransport();
    container.innerHTML = "";
    if (!t || !(t instanceof FallbackTransport)) return;

    const models = resolveModelOptions(t, runtime.manifest);
    const root = document.createElement("div");
    root.style.cssText =
      "box-sizing:border-box;font-family:system-ui,sans-serif;padding:16px 18px;margin-bottom:12px;" +
      "border:1px solid #2a2a2a;border-radius:12px;background:#111317;color:#e7e7ea;font-size:13px;" +
      "max-width:720px;margin-left:auto;margin-right:auto;";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "In-browser model (fallback)");

    const head = document.createElement("div");
    head.style.cssText = "margin-bottom:12px;";
    const eyebrow = document.createElement("div");
    eyebrow.style.cssText =
      "width:fit-content;color:#c9a05a;border:1px solid #3b3020;background:#17130d;border-radius:999px;" +
      "padding:4px 9px;font-size:11px;font-weight:700;margin-bottom:8px;";
    eyebrow.textContent = "Local fallback";
    const title = document.createElement("strong");
    title.style.cssText = "display:block;font-size:15px;color:#f2f2f4;";
    title.textContent = "Run this pod in your browser";
    const sub = document.createElement("p");
    sub.style.cssText = "margin:8px 0 0;color:#a8a8af;font-size:12px;line-height:1.5;";
    sub.textContent =
      "The owner is unreachable. You can load Gemma with WebGPU after an explicit download — nothing starts automatically.";
    head.append(eyebrow, title, sub);

    const cacheRow = document.createElement("div");
    cacheRow.style.cssText =
      "display:flex;gap:10px;font-size:12px;margin:12px 0;padding:10px 12px;background:#0a0a0c;border:1px solid #1f1f22;border-radius:8px;";
    const cacheL = document.createElement("span");
    cacheL.style.cssText = "width:52px;color:#6c6c72;text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;";
    cacheL.textContent = "cache";
    const cacheV = document.createElement("span");
    cacheV.style.cssText = "flex:1;color:#e7e7ea;";
    cacheV.textContent = "checking…";
    cacheRow.append(cacheL, cacheV);

    const rid = ++cacheFetch;
    void t.cacheStatus().then((info) => {
      if (rid !== cacheFetch) return;
      cacheV.textContent = cacheLabel(info.files, info.bytes, info.likelyComplete, info.state);
    });

    const labelEl = document.createElement("label");
    labelEl.style.cssText = "display:flex;flex-direction:column;gap:6px;font-size:12px;color:#a8a8af;margin:10px 0;";
    labelEl.textContent = "Model";
    const select = document.createElement("select");
    select.style.cssText =
      "padding:6px 10px;border-radius:8px;border:1px solid #2a2a2a;background:#141416;color:#e7e7ea;font:inherit;";
    select.disabled = t.state === "preparing" || t.state === "ready";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.sizeMB ? `${m.label} (~${m.sizeMB >= 1000 ? `${(m.sizeMB / 1000).toFixed(1)} GB` : `${m.sizeMB} MB`})` : m.label;
      if (m.id === t.modelId) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      if (!t.setModel(select.value)) return;
      progressMap = new Map();
      paint();
    });
    labelEl.appendChild(select);

    const statusRow = document.createElement("div");
    statusRow.style.cssText = "font-size:12px;color:#8c8c92;margin:8px 0;";
    const st = t.state === "ready" ? "ready" : t.state === "preparing" ? "downloading" : t.state === "error" ? `error: ${t.lastError ?? ""}` : "not loaded";
    statusRow.textContent = `Runtime: ${st}`;

    const progressWrap = document.createElement("div");
    progressWrap.style.cssText =
      "position:relative;height:22px;background:#0a0a0c;border:1px solid #1f1f22;border-radius:6px;overflow:hidden;margin:10px 0;" +
      (t.state === "preparing" ? "" : "visibility:hidden;height:0;margin:0;");
    const progressBar = document.createElement("span");
    const pct = progressPercent(progressMap);
    progressBar.style.cssText = `position:absolute;inset:0 auto 0 0;background:#3a7afe;width:${pct}%;transition:width 0.2s;`;
    const progressLbl = document.createElement("span");
    progressLbl.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#e7e7ea;";
    const last = [...progressMap.values()].at(-1);
    progressLbl.textContent = last?.file ? `${last.file}` : t.state === "preparing" ? "preparing…" : "";
    progressWrap.append(progressBar, progressLbl);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.style.cssText =
      "width:100%;margin-top:8px;padding:10px 16px;border-radius:8px;border:0;background:#3a7afe;color:white;font-size:14px;font-weight:500;cursor:pointer;";
    if (t.state === "preparing") {
      btn.textContent = "Cancel download";
      btn.style.background = "transparent";
      btn.style.border = "1px solid #ff7a7a";
      btn.style.color = "#ff7a7a";
      btn.addEventListener("click", () => {
        t.abort();
        progressMap = new Map();
        paint();
      });
    } else if (t.state === "ready") {
      btn.textContent = "Local model ready";
      btn.disabled = true;
      btn.style.opacity = "0.6";
      btn.style.cursor = "default";
    } else {
      btn.textContent = "Download and enable local model";
      btn.addEventListener("click", () => {
        progressMap = new Map();
        void (async () => {
          try {
            await t.prepare((ev) => {
              if (ev.file) progressMap = new Map(progressMap).set(ev.file, ev);
              paint();
            });
          } catch {
            /* error state on transport */
          } finally {
            paint();
          }
        })();
      });
    }

    root.append(head, cacheRow, labelEl, statusRow);
    if (t.state === "preparing") root.appendChild(progressWrap);
    root.appendChild(btn);
    container.appendChild(root);
  };

  const offs = [
    runtime.events.on("transport.updated", paint),
    runtime.events.on("transport.ready", paint),
    runtime.events.on("transport.fallback", paint),
  ];

  paint();

  return () => {
    for (const o of offs) o();
    container.innerHTML = "";
  };
}
