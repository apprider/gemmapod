import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { VerifiedPodManifest, ManifestTool } from "../../toolRuntime.js";

/**
 * Build Mastra-compatible tools from a signed pod manifest.
 * Manifest tools are declared by the pod owner and signed in the manifest.
 * We create lightweight Mastra tools that delegate to the original toolRuntime.run().
 */
export function buildManifestTools(
  manifest: VerifiedPodManifest | null,
  toolRuntime: { run(call: { id: string; function: { name: string; arguments?: string | Record<string, unknown> } }): Promise<string> },
): Record<string, ReturnType<typeof createTool>> {
  if (!manifest?.tools?.length) return {};

  const tools: Record<string, ReturnType<typeof createTool>> = {};

  for (const manifestTool of manifest.tools) {
    const toolId = manifestTool.name;
    tools[toolId] = createTool({
      id: toolId,
      description: manifestTool.description,
      inputSchema: z.object({
        // Manifest tools accept any JSON object as arguments
        args: z.record(z.unknown()).optional().describe("Arguments for the tool call"),
      }),
      outputSchema: z.object({
        result: z.string(),
      }),
      execute: async ({ args }) => {
        const result = await toolRuntime.run({
          id: `call_${Date.now()}`,
          function: {
            name: toolId,
            arguments: args ?? {},
          },
        });
        return { result };
      },
    });
  }

  return tools;
}
