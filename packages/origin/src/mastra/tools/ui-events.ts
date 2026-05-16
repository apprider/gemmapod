import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { DartcUiEvent } from "@gemmapod/dartc";

export type SendUiEventFn = (event: DartcUiEvent) => Promise<void>;

/**
 * Build Mastra tools that emit DARTC UI events over the active peer session.
 * These let the agent drive the visitor's UI (companion, presentation, state)
 * without injecting raw HTML/CSS.
 */
export function buildUiEventTools(sendUiEvent: SendUiEventFn) {
  return {
    show_presentation: createTool({
      id: "show_presentation",
      description:
        "Show a visual presentation card to the visitor. Use this to summarize answers, highlight key points, or display structured information. Call this BEFORE or DURING your response to enrich the visitor experience.",
      inputSchema: z.object({
        title: z.string().describe("Short title for the presentation card (max 60 chars)."),
        body: z.string().optional().describe("One-sentence summary or subtitle."),
        items: z.array(z.string()).optional().describe("Bullet points or key items to display (max 8)."),
        status: z.enum(["working", "ready"]).optional().describe("'working' while preparing, 'ready' when complete."),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ title, body, items, status }) => {
        await sendUiEvent({
          type: "CUSTOM",
          threadId: "default",
          name: "presentation.show",
          value: {
            title: title.slice(0, 60),
            body: body ?? undefined,
            items: items?.slice(0, 8),
            status: status ?? "ready",
          },
        });
        return { ok: true };
      },
    }),

    react_companion: createTool({
      id: "react_companion",
      description:
        "Update the 3D companion's mood, expression, stage position, and speech text. Use this to make the companion feel alive — e.g. set mood to 'thinking' while working, 'happy' when done, 'presenting' when showing results.",
      inputSchema: z.object({
        mood: z.enum(["walking", "connecting", "listening", "thinking", "presenting", "fallback"]).optional(),
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

    set_state: createTool({
      id: "set_state",
      description:
        "Push a state snapshot or JSON Patch delta to the visitor's page. Use this to share structured data (tables, forms, progress) that the visitor's UI can render. Prefer snapshots for full replacements, deltas for incremental updates.",
      inputSchema: z.object({
        mode: z.enum(["snapshot", "delta"]).describe("'snapshot' replaces full state, 'delta' applies a JSON Patch."),
        data: z.record(z.unknown()).describe("For snapshot: the full state object. For delta: { patch: [...] } where patch is an array of JSON Patch operations."),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ mode, data }) => {
        if (mode === "snapshot") {
          await sendUiEvent({
            type: "STATE_SNAPSHOT",
            threadId: "default",
            snapshot: data,
          });
        } else {
          const patch = Array.isArray(data.patch) ? data.patch : [];
          await sendUiEvent({
            type: "STATE_DELTA",
            threadId: "default",
            delta: patch,
          });
        }
        return { ok: true };
      },
    }),

    send_custom_event: createTool({
      id: "send_custom_event",
      description:
        "Send a custom app-specific event to the visitor. This is an escape hatch for any event not covered by the other tools. The visitor's page must know how to handle the event name you choose.",
      inputSchema: z.object({
        name: z.string().describe("Custom event name (e.g. 'app.navigate', 'chart.update')."),
        value: z.record(z.unknown()).optional().describe("Any JSON-serializable payload."),
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async ({ name, value }) => {
        await sendUiEvent({
          type: "CUSTOM",
          threadId: "default",
          name,
          value: value ?? {},
        });
        return { ok: true };
      },
    }),
  };
}
