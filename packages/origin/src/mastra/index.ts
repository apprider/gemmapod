import { Mastra } from "@mastra/core/mastra";
import { createPodAgent, type PodAgentConfig } from "./agents/pod-agent.js";
import type { SendUiEventFn } from "./tools/ui-events.js";

export interface MastraOriginConfig {
  ollamaUrl: string;
  model: string;
  systemPrompt: string;
  manifest: PodAgentConfig["manifest"];
  toolRuntime: PodAgentConfig["toolRuntime"];
  sendUiEvent?: SendUiEventFn;
  /** Optional extra UI tools to register (e.g. buildCompanionTools). */
  uiTools?: Record<string, any>;
}

let mastraInstance: Mastra | null = null;

export function getMastraInstance(config: MastraOriginConfig): Mastra {
  if (mastraInstance) {
    console.log(`[mastra] reusing existing instance`);
    return mastraInstance;
  }

  console.log(`[mastra] creating new instance: model=${config.model}, ollamaUrl=${config.ollamaUrl}`);

  const agent = createPodAgent({
    systemPrompt: config.systemPrompt,
    model: config.model,
    ollamaUrl: config.ollamaUrl,
    manifest: config.manifest,
    toolRuntime: config.toolRuntime,
    sendUiEvent: config.sendUiEvent,
    uiTools: config.uiTools,
  });

  mastraInstance = new Mastra({
    agents: { "gemmapod-agent": agent },
  });

  return mastraInstance;
}

export function resetMastraInstance(): void {
  mastraInstance = null;
}
