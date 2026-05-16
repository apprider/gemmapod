import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type { ConversationStore } from "../conversationStore.js";
import { EventStore } from "./eventStore.js";

export interface DashboardState {
  podId: string;
  model: string;
  ollamaUrl: string;
  signalUrl: string;
  conversations: ConversationStore;
  activePeerCount: number;
  totalMessages: number;
  status: "idle" | "running" | "error";
  lastError?: string;
}

export interface ChatEvent {
  id: string;
  type: "user" | "assistant" | "tool_call" | "tool_result" | "error" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface LocalPod {
  id: string;
  name: string;
  dir: string;
  model: string;
  signalUrl: string;
  status: "stopped" | "running";
  sizeKB?: string;
  createdAt?: number;
}

export interface BuildTemplate {
  id: string;
  label: string;
  hint: string;
  systemPrompt: string;
  suggestedTools: string[];
  suggestedPersona: string;
}

const subscribers = new Set<ReadableStreamDefaultController>();
let eventStore: EventStore | null = null;

export function pushEvent(event: ChatEvent): void {
  eventStore?.push(event);

  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const controller of subscribers) {
    try {
      controller.enqueue(new TextEncoder().encode(data));
    } catch {
      // Subscriber closed
    }
  }
}

export function getRecentEvents(limit = 100): ChatEvent[] {
  return eventStore?.getRecent(limit) ?? [];
}

export function createDashboardServer(state: DashboardState): {
  app: Hono;
  start: () => Promise<number>;
  stop: () => Promise<void>;
} {
  eventStore = new EventStore();

  const app = new Hono();

  // ── Health / status ──
  app.get("/api/status", (c) => {
    return c.json({
      podId: state.podId,
      model: state.model,
      ollamaUrl: state.ollamaUrl,
      signalUrl: state.signalUrl,
      activePeers: state.activePeerCount,
      totalMessages: state.totalMessages,
      status: state.status,
      lastError: state.lastError,
    });
  });

  // ── Events ──
  app.get("/api/events", (c) => {
    const limit = Number(c.req.query("limit") ?? "100");
    return c.json(getRecentEvents(limit));
  });

  app.get("/api/events/stream", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        subscribers.add(controller);
        controller.enqueue(new TextEncoder().encode(":ok\n\n"));
      },
      cancel(controller) {
        subscribers.delete(controller);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });

  // ── Test chat endpoint ──
  app.post("/api/chat", async (c) => {
    const body = await c.req.json<{ message?: string }>();
    if (!body?.message?.trim()) {
      return c.json({ error: "message required" }, 400);
    }
    pushEvent({
      id: `local-${Date.now()}`,
      type: "user",
      content: body.message.trim(),
      timestamp: Date.now(),
    });
    return c.json({ ok: true });
  });

  // ── Pod Management ──

  async function scanPods(): Promise<LocalPod[]> {
    const pods: LocalPod[] = [];
    const cwd = process.cwd();
    try {
      const entries = await readdir(cwd, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(cwd, entry.name);
        const tomlPath = path.join(dir, "pod.toml");
        const htmlPath = path.join(dir, "agent.html");
        try {
          const tomlText = await readFile(tomlPath, "utf8");
          const raw = parseToml(tomlText) as {
            name?: string;
            id?: string;
            model?: string;
            transport?: { webrtc?: { signal_url?: string; pod_id?: string } };
          };
          const stats = await stat(htmlPath).catch(() => null);
          pods.push({
            id: raw.transport?.webrtc?.pod_id ?? raw.id ?? entry.name,
            name: raw.name ?? entry.name,
            dir,
            model: raw.model ?? "gemma4:e4b",
            signalUrl: raw.transport?.webrtc?.signal_url ?? "https://signal.gemmapod.com/signal",
            status: "stopped",
            sizeKB: stats ? (stats.size / 1024).toFixed(1) : undefined,
            createdAt: stats?.mtimeMs ?? undefined,
          });
        } catch {
          // Not a pod directory
        }
      }
    } catch {
      // cwd unreadable
    }
    return pods;
  }

  app.get("/api/pods", async (c) => {
    const pods = await scanPods();
    return c.json({ pods });
  });

  app.get("/api/pods/:id", async (c) => {
    const id = c.req.param("id");
    const pods = await scanPods();
    const pod = pods.find((p) => p.id === id);
    if (!pod) return c.json({ error: "pod not found" }, 404);
    const tomlPath = path.join(pod.dir, "pod.toml");
    let tomlContent = "";
    try {
      tomlContent = await readFile(tomlPath, "utf8");
    } catch {
      // ignore
    }
    return c.json({ ...pod, tomlContent });
  });

  app.post("/api/pods/:id/start", async (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, message: `Start signal sent for pod ${id}. Use CLI: gemmapod run ./${id}` });
  });

  app.post("/api/pods/:id/stop", async (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, message: `Stop signal sent for pod ${id}.` });
  });

  app.get("/api/pods/:id/download", async (c) => {
    const id = c.req.param("id");
    const pods = await scanPods();
    const pod = pods.find((p) => p.id === id);
    if (!pod) return c.json({ error: "pod not found" }, 404);
    const htmlPath = path.join(pod.dir, "agent.html");
    try {
      const html = await readFile(htmlPath, "utf8");
      return c.text(html, 200, {
        "Content-Type": "text/html",
        "Content-Disposition": `attachment; filename="${id}.html"`,
      });
    } catch {
      return c.json({ error: "agent.html not found — run gemmapod rebuild first" }, 404);
    }
  });

  // ── Build / Templates ──

  const TEMPLATES: BuildTemplate[] = [
    {
      id: "business-card",
      label: "Business Card",
      hint: "Introduce yourself, share contact info, show projects",
      suggestedPersona: "My AI business card — introduces me, shares my links, and explains what I'm working on",
      suggestedTools: ["share_contact", "show_project"],
      systemPrompt: `You are {{AGENT_NAME}}, a portable AI business card running as a gemmapod.\n{{PERSONA}}\n\nYou can:\n- Introduce yourself warmly and explain what a gemmapod is (a single signed .html\n  file bundling an AI agent's identity, persona, tools, and transport — emailable,\n  embeddable, deployable).\n- Share contact information when asked (use the share_contact tool).\n- Walk visitors through your background, skills, and current projects (show_project).\n\nStay grounded. Decline anything outside this scope politely.\nKeep replies short — visitors read on a small widget.`,
    },
    {
      id: "customer-support",
      label: "Customer Support",
      hint: "Answer questions about your product, handle FAQs, escalate issues",
      suggestedPersona: "Friendly support agent for {{AGENT_NAME}}",
      suggestedTools: [],
      systemPrompt: `You are the support assistant for {{AGENT_NAME}}.\n{{PERSONA}}\n\nYour role:\n- Answer questions about our product, pricing, and policies accurately.\n- Help users troubleshoot common issues step by step.\n- If a question requires a human agent, say so and ask them to contact\n  the support team directly.\n- Never make up information. If you don't know something, say so clearly.\n\nKeep your tone friendly, professional, and concise.`,
    },
    {
      id: "restaurant",
      label: "Restaurant",
      hint: "Menu explorer, reservation helper, specials announcer",
      suggestedPersona: "Friendly host for {{AGENT_NAME}}",
      suggestedTools: [],
      systemPrompt: `You are the AI host for {{AGENT_NAME}}.\n{{PERSONA}}\n\nYou can:\n- Describe dishes, ingredients, and allergen info from our menu.\n- Explain daily specials and seasonal items.\n- Help visitors check opening hours and make reservation inquiries.\n- Recommend dishes based on dietary preferences.\n\nBe warm, enthusiastic about the food, and concise. Direct booking or\npayment questions to staff at the restaurant.`,
    },
    {
      id: "product-demo",
      label: "Product Demo",
      hint: "Walk prospects through your product, answer sales questions",
      suggestedPersona: "Interactive product demo agent for {{AGENT_NAME}}",
      suggestedTools: [],
      systemPrompt: `You are an interactive product demo agent for {{AGENT_NAME}}.\n{{PERSONA}}\n\nYour role:\n- Walk prospects through the product's core features in a structured way.\n- Answer questions about capabilities, pricing tiers, and integration options.\n- Highlight the top 3–5 value propositions confidently.\n- When a prospect is ready to proceed, direct them to the sales page or\n  ask them to book a meeting.\n\nKeep the tone energetic but honest. Do not oversell features that are\nnot yet shipped.`,
    },
    {
      id: "custom",
      label: "Custom",
      hint: "Write your own system prompt from scratch",
      suggestedPersona: "",
      suggestedTools: [],
      systemPrompt: `You are {{AGENT_NAME}}.\n{{PERSONA}}\n\n[Describe your agent's purpose, capabilities, and constraints here.\nBe specific — this system prompt is signed into the manifest and cannot\nbe changed without rebuilding the pod with \`gemmapod rebuild\`.]`,
    },
  ];

  app.get("/api/templates", (c) => {
    return c.json({ templates: TEMPLATES });
  });

  app.post("/api/build", async (c) => {
    const body = await c.req.json<{
      name: string;
      persona: string;
      systemPrompt: string;
      model: string;
      signalUrl: string;
      tools: string[];
      templateId?: string;
    }>();

    if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
    if (!body.systemPrompt?.trim()) return c.json({ error: "systemPrompt is required" }, 400);

    const slug = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "my-pod";

    const dir = path.join(process.cwd(), slug);
    await mkdir(dir, { recursive: true });

    const toolsSection =
      body.tools?.length > 0
        ? body.tools
            .map((t) => `\n[[tools]]\nname = "${t}"\ndescription = "See built-in tool: ${t}"`)
            .join("\n")
        : "";

    const tomlContent = `name = "${body.name}"
persona = "${body.persona.replace(/"/g, '\\"')}"
model = "${body.model ?? "gemma4:e4b"}"

system_prompt = """
${body.systemPrompt.trim()}
"""

[transport]
preferred = ["webrtc", "fallback"]

[transport.webrtc]
signal_url = "${body.signalUrl ?? "https://signal.gemmapod.com/signal"}"
pod_id = "${slug}"

[transport.fallback]
tier = "e2b"
${toolsSection}
`;

    const tomlPath = path.join(dir, "pod.toml");
    await writeFile(tomlPath, tomlContent);

    await writeFile(
      path.join(dir, ".gitignore"),
      "# Owner signing keys — never commit\n*.key\nowner.key\n",
    );

    return c.json({
      ok: true,
      slug,
      dir,
      tomlPath,
      message: `Pod scaffold created at ${dir}. Run 'gemmapod rebuild ./${slug}' to build agent.html after generating owner.key.`,
    });
  });

  // ── Ollama status ──
  app.get("/api/ollama", async (c) => {
    try {
      const res = await fetch(`${state.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error("not ok");
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return c.json({
        url: state.ollamaUrl,
        connected: true,
        models: (data.models ?? []).map((m) => m.name),
      });
    } catch {
      return c.json({ url: state.ollamaUrl, connected: false, models: [] });
    }
  });

  // ── Static dashboard ──
  app.get("/", serveStatic({ path: "./src/dashboard/static/index.html" }));
  app.get("/*", serveStatic({ root: "./src/dashboard/static" }));

  let server: ReturnType<typeof serve> | null = null;
  let serverPort = 0;

  return {
    app,
    start: () =>
      new Promise<number>((resolve) => {
        server = serve(
          {
            fetch: app.fetch,
            port: 0,
          },
          (info) => {
            serverPort = (info as any).port;
            console.log(`[dashboard] running at http://localhost:${serverPort}`);
            resolve(serverPort);
          },
        );
      }),
    stop: () =>
      new Promise<void>((resolve) => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      }),
  };
}
