import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { DartcUiEvent } from "@gemmapod/dartc";

export type SendUiEventFn = (event: DartcUiEvent) => Promise<void>;

/**
 * Build generic UI event tools that any host can use.
 * These are NOT tied to any specific UI (no 3D companion assumptions).
 * Hosts register these by default when they provide a sendUiEvent callback.
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
