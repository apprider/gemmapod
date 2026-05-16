import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { intro, outro, spinner, select, note, isCancel, cancel } from "@clack/prompts";
import { detectOllama } from "../wizard/ollamaDetect.js";
import { startDaemon, type DaemonConfig } from "@gemmapod/origin";

export async function cmdRun(dirOrToml: string, opts: { model?: string; dashboard?: boolean }): Promise<void> {
  intro("gemmapod run");

  // 1. Resolve pod.toml
  const resolved = path.resolve(dirOrToml);
  const tomlPath = resolved.endsWith(".toml") ? resolved : path.join(resolved, "pod.toml");
  let tomlText: string;
  try {
    tomlText = await readFile(tomlPath, "utf8");
  } catch {
    cancel(`Cannot read ${tomlPath} — run 'gemmapod create' first.`);
    process.exit(1);
  }

  const raw = parseToml(tomlText) as {
    name?: string;
    id?: string;
    model?: string;
    transport?: {
      webrtc?: { signal_url?: string; pod_id?: string };
    };
  };
  const podId = raw.transport?.webrtc?.pod_id ?? raw.id ?? raw.name;
  const signalUrl = raw.transport?.webrtc?.signal_url ?? "https://signal.gemmapod.com/signal";

  if (!podId) {
    cancel("pod.toml is missing transport.webrtc.pod_id and name. Run 'gemmapod doctor' first.");
    process.exit(1);
  }

  // 2. Detect Ollama
  const s = spinner();
  s.start("Detecting Ollama...");
  const ollama = await detectOllama();
  s.stop(ollama ? `Ollama at ${ollama.url}` : "Ollama not found");

  if (!ollama) {
    note(
      "Ollama is not running. Start it with:\n  ollama serve\nThen pull a model:\n  ollama pull gemma4:e4b",
      "Ollama required",
    );
    process.exit(1);
  }

  // 3. Pick model
  let model = opts.model;
  if (!model) {
    const tomlModel = raw.model;
    if (tomlModel && ollama.models.includes(tomlModel)) {
      model = tomlModel;
    } else if (ollama.models.length === 1) {
      model = ollama.models[0]!;
    } else {
      const chosen = await select({
        message: "Select Ollama model:",
        options: ollama.models.map((m) => ({
          value: m,
          label: m,
          hint: m === raw.model ? "from pod.toml" : undefined,
        })),
      });
      if (isCancel(chosen)) { cancel(); process.exit(0); }
      model = chosen as string;
    }
  }

  const config: DaemonConfig = {
    podId,
    signalUrl,
    ollamaUrl: ollama.url,
    model: model!,
  };

  note(
    `Pod:     ${podId}\nSignal:  ${signalUrl}\nOllama:  ${ollama.url}\nModel:   ${model}`,
    "Starting daemon",
  );

  const dashboardUrl = await startDaemon(config);

  // Open dashboard if enabled (default true)
  const openDashboard = opts.dashboard !== false;
  if (openDashboard && dashboardUrl) {
    console.log(`\n  Opening dashboard: ${dashboardUrl}`);
    try {
      const { exec } = await import("node:child_process");
      const platform = process.platform;
      if (platform === "darwin") {
        exec(`open "${dashboardUrl}"`);
      } else if (platform === "win32") {
        exec(`start "${dashboardUrl}"`);
      } else {
        exec(`xdg-open "${dashboardUrl}"`);
      }
    } catch {
      console.log(`  (Could not auto-open browser. Please open ${dashboardUrl} manually)`);
    }
  }

  // Process stays alive via WebSocket + setInterval in startDaemon
  outro("Daemon stopped.");
}
