import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const showProjectTool = createTool({
  id: "show_project",
  description: "Return a short project summary from the pod owner's portfolio.",
  inputSchema: z.object({
    project: z.string().optional().describe("Name of the project to summarize. Defaults to gemmapod."),
  }),
  outputSchema: z.object({
    project: z.string(),
    summary: z.string(),
  }),
  execute: async ({ project }) => {
    const proj = project ?? "gemmapod";
    return {
      project: proj,
      summary:
        "GemmaPod packages a signed AI agent manifest, WASM verifier, browser shim, and transport config into one portable HTML blob.",
    };
  },
});
