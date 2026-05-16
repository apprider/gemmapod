import { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core/mastra";
import { shareContactTool, showProjectTool, packageDemoPodTool, buildManifestTools } from "../tools/index.js";
import type { VerifiedPodManifest } from "../../toolRuntime.js";
import type { ToolRuntime } from "../../toolRuntime.js";

export interface PodAgentConfig {
  systemPrompt: string;
  model: string;
  ollamaUrl: string;
  manifest: VerifiedPodManifest | null;
  toolRuntime: ToolRuntime;
}

export function createPodAgent(config: PodAgentConfig): Agent {
  // Build local tools
  const localTools = {
    share_contact: shareContactTool,
    show_project: showProjectTool,
    package_demo_pod: packageDemoPodTool,
  };

  // Build manifest-signed tools
  const manifestTools = buildManifestTools(config.manifest, config.toolRuntime);

  // Combine all tools
  const allTools = { ...localTools, ...manifestTools };

  return new Agent({
    id: "gemmapod-agent",
    name: config.manifest?.name ?? "GemmaPod Agent",
    instructions: config.systemPrompt,
    model: {
      id: `ollama/${config.model}`,
      url: `${config.ollamaUrl}/v1`,
    } as any,
    tools: allTools,
  });
}

/**
 * Get or create a cached agent from the Mastra instance.
 */
export function getOrCreatePodAgent(
  mastra: Mastra,
  config: PodAgentConfig,
): Agent {
  const existing = mastra.getAgent("gemmapod-agent");
  if (existing) return existing;
  return createPodAgent(config);
}
