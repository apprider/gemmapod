import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const shareContactTool = createTool({
  id: "share_contact",
  description: "Share the pod owner's public contact links.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    email: z.string(),
    github: z.string(),
    project: z.string(),
  }),
  execute: async () => {
    if (process.env.GEMMAPOD_CONTACT_JSON) {
      return JSON.parse(process.env.GEMMAPOD_CONTACT_JSON);
    }
    return {
      email: "raj.design@gmail.com",
      github: "https://github.com/apprider",
      project: "https://gemmapod.com",
    };
  },
});
