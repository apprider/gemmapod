import { Mastra } from "@mastra/core/mastra";
import { createPodAgent, type PodAgentConfig } from "./agents/pod-agent.js";

export interface MastraOriginConfig {
  ollamaUrl: string;
  model: string;
  systemPrompt: string;
  manifest: PodAgentConfig["manifest"];
  toolRuntime: PodAgentConfig["toolRuntime"];
}

let mastraInstance: Mastra | null = null;

export function getMastraInstance(config: MastraOriginConfig): Mastra {
  if (mastraInstance) return mastraInstance;

  const agent = createPodAgent({
    systemPrompt: config.systemPrompt,
    model: config.model,
    ollamaUrl: config.ollamaUrl,
    manifest: config.manifest,
    toolRuntime: config.toolRuntime,
  });

  mastraInstance = new Mastra({
    agents: { "gemmapod-agent": agent },
  });

  return mastraInstance;
}

export function resetMastraInstance(): void {
  mastraInstance = null;
}
