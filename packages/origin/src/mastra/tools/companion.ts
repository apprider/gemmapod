import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { SendUiEventFn } from "./ui-events.js";

/**
 * Build website-specific companion UI tools.
 * These are tied to a 3D avatar with moods, expressions, and speech.
 * Hosts that don't have a 3D companion should not register these.
 */
export function buildCompanionTools(sendUiEvent: SendUiEventFn) {
  return {
    react_companion: createTool({
      id: "react_companion",
      description:
        "Update the 3D companion's mood, expression, stage position, and speech text. Use this to make the companion feel alive — e.g. set mood to 'thinking' while working, 'happy' when done, 'presenting' when showing results.",
      inputSchema: z.object({
        mood: z.enum(["walking", "connecting", "listening", "thinking", "presenting", "happy", "fallback"]).optional(),
        stage: z.enum(["center", "peek", "presenting-left"]).optional(),
        expression: z.enum(["neutral", "happy", "muted", "talking", "thinking"]).optional(),
        text: z.string().optional().describe("What the companion says (shown as a speech bubble)."),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ mood, stage, expression, text }) => {
        await sendUiEvent({
          type: "CUSTOM",
          threadId: "default",
          name: "companion.react",
          value: {
            mood: mood ?? "listening",
            stage: stage ?? "center",
            expression: expression ?? "neutral",
            text: text ?? "",
          },
        });
        return { ok: true };
      },
    }),

    say_companion: createTool({
      id: "say_companion",
      description:
        "Make the 3D companion speak a specific line. Shorthand for react_companion with expression='talking'. Use for short announcements or reactions.",
      inputSchema: z.object({
        text: z.string().describe("The line the companion should speak."),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ text }) => {
        await sendUiEvent({
          type: "CUSTOM",
          threadId: "default",
          name: "companion.say",
          value: { text: text.trim() },
        });
        return { ok: true };
      },
    }),
  };
}
