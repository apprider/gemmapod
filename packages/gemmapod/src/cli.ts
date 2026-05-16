#!/usr/bin/env node
import { Command } from "commander";
import { cmdCreate } from "./commands/create.js";
import { cmdRun } from "./commands/run.js";
import { cmdRebuild } from "./commands/rebuild.js";

function fail(e: Error): never {
  console.error("gemmapod:", e.message);
  process.exit(1);
}

const program = new Command();
program
  .name("gemmapod")
  .description("Create, build, run, and manage signed GemmaPod AI agent capsules.");

program
  .command("create")
  .description("Interactively create a new pod — guided wizard builds pod.toml, owner.key, and agent.html.")
  .option("--dir <path>", "output directory (default: ./<pod-slug>)")
  .action((opts: { dir?: string }) => cmdCreate(opts).catch(fail));

program
  .command("run <dir-or-toml>")
  .description("Start the origin daemon for a pod directory or pod.toml file.")
  .option("--model <name>", "override Ollama model")
  .option("--no-dashboard", "skip opening the local dashboard")
  .action((arg: string, opts: { model?: string; dashboard?: boolean }) => cmdRun(arg, opts).catch(fail));

program
  .command("rebuild <dir-or-toml>")
  .description("Re-sign and rebuild agent.html after editing pod.toml.")
  .option("--out <path>", "override output .html path")
  .action((arg: string, opts: { out?: string }) => cmdRebuild(arg, opts).catch(fail));

program.parseAsync();
