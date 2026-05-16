import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const packageDemoPodTool = createTool({
  id: "package_demo_pod",
  description: "Explain how a visitor can package a demo pod.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    status: z.string(),
    message: z.string(),
  }),
  execute: async () => ({
    status: "manual_next_step",
    message:
      "Use gemmapod.com/build to generate a signed demo pod in the browser, then deploy it from gemmapod.com/deploy.",
  }),
});
