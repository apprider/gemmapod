import path from "node:path";
import { spinner, outro, cancel } from "@clack/prompts";
import { buildPod } from "../lib/buildPod.js";

export async function cmdRebuild(dirOrToml: string, opts: { out?: string }): Promise<void> {
  const resolved = path.resolve(dirOrToml);
  const isToml = resolved.endsWith(".toml");
  const tomlPath = isToml ? resolved : path.join(resolved, "pod.toml");
  const dir = isToml ? path.dirname(resolved) : resolved;
  const keyPath = path.join(dir, "owner.key");
  const outPath = opts.out ? path.resolve(opts.out) : path.join(dir, "agent.html");

  const s = spinner();
  s.start("Rebuilding pod...");
  try {
    const result = await buildPod({ podTomlPath: tomlPath, keyPath, outPath });
    s.stop(`Rebuilt ${result.htmlPath} (${result.sizeKB} KB)`);
    outro(`Pod rebuilt. Pod ID: ${result.manifest.id}`);
  } catch (e) {
    s.stop("Failed");
    cancel((e as Error).message);
    process.exit(1);
  }
}
