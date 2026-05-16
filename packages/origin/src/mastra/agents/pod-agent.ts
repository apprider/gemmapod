import { Agent } from "@mastra/core/agent";
import type { Mastra } from "@mastra/core/mastra";
import { shareContactTool, showProjectTool, packageDemoPodTool, buildManifestTools, buildUiEventTools, buildCompanionTools } from "../tools/index.js";
import type { VerifiedPodManifest } from "../../toolRuntime.js";
import type { ToolRuntime } from "../../toolRuntime.js";
import type { SendUiEventFn } from "../tools/ui-events.js";

export interface PodAgentConfig {
  systemPrompt: string;
  model: string;
  ollamaUrl: string;
  manifest: VerifiedPodManifest | null;
  toolRuntime: ToolRuntime;
  sendUiEvent?: SendUiEventFn;
  /** Optional extra UI tools to register (e.g. buildCompanionTools). */
  uiTools?: Record<string, any>;
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

  // Build generic UI event tools (if sendUiEvent is provided)
  const genericUiTools = config.sendUiEvent ? buildUiEventTools(config.sendUiEvent) : {};

  // Merge host-provided UI tools (e.g. companion tools) with generic ones
  const uiTools = { ...genericUiTools, ...(config.uiTools ?? {}) };

  // Combine all tools
  const allTools = { ...localTools, ...manifestTools, ...uiTools };

  const modelConfig = {
    id: `ollama/${config.model}`,
    url: `${config.ollamaUrl}/v1`,
  };
  console.log(`[mastra] creating agent with model: ${JSON.stringify(modelConfig)}, tools: ${Object.keys(allTools).join(", ") || "none"}`);

  // Inject event capabilities guide into system prompt if UI tools are available
  let instructions = config.systemPrompt;
  if (config.sendUiEvent) {
    const availableToolNames = Object.keys(uiTools);
    const toolDescriptions = availableToolNames.map((name) => {
      switch (name) {
        case "show_presentation":
          return "- show_presentation(title, body?, items?, status?) — shows a visual presentation card beside the chat";
        case "react_companion":
          return "- react_companion(mood?, stage?, expression?, text?) — updates the 3D avatar's mood, position, expression, and speech";
        case "say_companion":
          return "- say_companion(text) — makes the avatar speak a short line";
        case "set_state":
          return "- set_state(mode, data) — pushes structured state (snapshot or JSON Patch delta) to the visitor's page";
        case "send_custom_event":
          return "- send_custom_event(name, value?) — sends any custom app-specific event";
        default:
          return `- ${name} — custom UI tool`;
      }
    }).join("\n");

    const eventGuide = `

---
Event Capabilities: You can enrich the visitor experience by calling these tools:
${toolDescriptions}
Use these tools proactively to make responses feel alive and interactive.`;
    instructions = instructions + eventGuide;
  }

  return new Agent({
    id: "gemmapod-agent",
    name: config.manifest?.name ?? "GemmaPod Agent",
    instructions,
    model: modelConfig as any,
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
