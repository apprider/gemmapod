// gemmapod-cloud signaling broker + pod registry.
//
// One process holds three kinds of state:
//   - origin sockets: registered by a pod owner ({t:"register", podId}).
//     Long-lived; one per pod owner.
//   - visitor sockets: opened by a pod blob in the wild ({t:"offer", podId,
//     sessionId, sdp}). Short-lived; the broker forwards offer, answer, and
//     trickled ICE candidates between the matching peers.
//   - HTTP routes: `POST /pods` (signed-blob ingest), `GET /:id` (serve the
//     pod blob), `GET /:id/meta` (JSON record).
//
// Storage is plugged in via the `Registry` interface — see registry.ts.
// The chat envelopes never traverse the broker; once the WebRTC data
// channel opens, the broker is out of the conversation.

import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { WebSocketServer, WebSocket } from "ws";
import type { Registry } from "./registry.js";
import { createPod } from "./registry.js";
import type { SignalMsg } from "./protocol.js";
import { metaHeaders, podHeaders, type PodHeaderOptions } from "./security.js";

export interface CreateSignalServerOptions {
  registry: Registry;
  port?: number;
  hostname?: string;
  /** Override default pod-blob security headers (CSP, Permissions-Policy). */
  podHeaderOptions?: PodHeaderOptions;
  /** Hook called when an origin daemon registers. Use for telemetry. */
  onOriginRegistered?: (podId: string) => void;
  /** Hook called when an origin daemon disconnects. */
  onOriginDisconnected?: (podId: string) => void;
}

export interface SignalServer {
  /** Underlying Node HTTP server. Already listening when this resolves. */
  readonly server: ServerType;
  /** WebSocket server bound to `/signal`. */
  readonly wss: WebSocketServer;
  /** Pods currently registered (live origin sockets). */
  origins(): string[];
  /** Active visitor sessions. */
  sessions(): number;
  /** Stop accepting connections and close any open sockets. */
  close(): Promise<void>;
}

interface OriginConn {
  ws: WebSocket;
  podId: string;
}
interface VisitorConn {
  ws: WebSocket;
  sessionId: string;
  podId: string;
}

/**
 * Build and start the signaling + registry server. Returns a `SignalServer`
 * handle for graceful shutdown.
 */
export function createSignalServer(opts: CreateSignalServerOptions): SignalServer {
  const { registry } = opts;
  const port = opts.port ?? 8080;
  const hostname = opts.hostname ?? "0.0.0.0";

  const originsByPod = new Map<string, OriginConn>();
  const visitorsBySession = new Map<string, VisitorConn>();

  const app = new Hono();
  app.use("/pods", cors({ origin: "*", allowMethods: ["POST", "OPTIONS"] }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      origins: [...originsByPod.keys()],
      sessions: visitorsBySession.size,
      registry: (registry as { name?: string }).name ?? "custom",
    }),
  );

  // POST /pods — verify the embedded manifest, persist via registry, return URL.
  app.post("/pods", async (c) => {
    const ct = c.req.header("content-type") ?? "";
    let html: string;
    if (ct.startsWith("text/html") || ct.startsWith("text/plain")) {
      html = await c.req.text();
    } else if (ct.startsWith("application/json")) {
      const body = (await c.req.json()) as { html?: string };
      if (!body.html) return c.json({ error: "missing 'html' field" }, 400);
      html = body.html;
    } else {
      return c.json(
        { error: "expected content-type text/html or application/json {html}" },
        400,
      );
    }
    try {
      const { id, ownerPubkey } = await createPod(registry, html);
      const base = new URL(c.req.url);
      return c.json({
        id,
        url: `${base.origin}/${id}`,
        ownerPubkey,
        blobSize: html.length,
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("verification") || msg.includes("manifest") || msg.includes("too large")) {
        return c.json({ error: msg }, 400);
      }
      console.error("[cloud] createPod failed:", e);
      return c.json({ error: msg }, 500);
    }
  });

  // GET /:id — serve the signed pod blob (streamed through this service so
  // we can attach CSP and bump hit counters).
  app.get("/:id{[A-Za-z0-9_-]{12}}", async (c) => {
    const id = c.req.param("id");
    const record = await registry.getRecord(id);
    if (!record) return c.notFound();
    const blob = await registry.getBlob(id);
    if (!blob) return c.notFound();
    registry.bumpHits(id).catch(() => undefined);
    return c.body(
      new Uint8Array(blob),
      200,
      podHeaders(
        {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": String(blob.length),
          "X-Pod-Owner": record.ownerPubkey,
        },
        opts.podHeaderOptions,
      ),
    );
  });

  // GET /:id/meta — JSON record (no blob bytes).
  app.get("/:id{[A-Za-z0-9_-]{12}}/meta", async (c) => {
    const record = await registry.getRecord(c.req.param("id"));
    if (!record) return c.notFound();
    Object.entries(metaHeaders()).forEach(([k, v]) => c.header(k, v));
    return c.json(record);
  });

  const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
    console.log(`[cloud] HTTP listening on http://${info.address}:${info.port}`);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { url } = req;
    if (url !== "/signal") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    let role: "origin" | "visitor" | null = null;
    let podId: string | null = null;
    let sessionId: string | null = null;

    const send = (msg: SignalMsg) => ws.send(JSON.stringify(msg));

    ws.on("message", (raw) => {
      let msg: SignalMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ t: "error", message: "invalid json" });
        return;
      }

      if (msg.t === "register") {
        if (role) return send({ t: "error", message: "already initialized" });
        role = "origin";
        podId = msg.podId;
        const prev = originsByPod.get(podId);
        if (prev && prev.ws !== ws) {
          try {
            prev.ws.close(4001, "replaced by new origin");
          } catch {
            // already closed
          }
        }
        originsByPod.set(podId, { ws, podId });
        opts.onOriginRegistered?.(podId);
        console.log(`[cloud] origin registered: ${podId}`);
        return send({ t: "registered", podId });
      }

      if (msg.t === "offer") {
        if (role === null) {
          role = "visitor";
          sessionId = msg.sessionId;
          podId = msg.podId ?? null;
          if (!podId) return send({ t: "error", sessionId: msg.sessionId, message: "podId required" });
          visitorsBySession.set(sessionId, { ws, sessionId, podId });
        } else if (role !== "visitor") {
          return send({ t: "error", sessionId: msg.sessionId, message: "wrong role" });
        }
        const offerPodId = msg.podId ?? podId;
        if (!offerPodId) return send({ t: "error", sessionId: msg.sessionId, message: "podId required" });
        const origin = originsByPod.get(offerPodId);
        if (!origin) {
          return send({ t: "error", sessionId: msg.sessionId, message: "origin offline" });
        }
        console.log(`[cloud] offer ${offerPodId} session=${msg.sessionId} (${msg.sdp.length} bytes)`);
        try {
          origin.ws.send(
            JSON.stringify({ t: "offer", sessionId: msg.sessionId, sdp: msg.sdp } satisfies SignalMsg),
          );
        } catch (e) {
          send({ t: "error", sessionId: msg.sessionId, message: `forward failed: ${(e as Error).message}` });
        }
        return;
      }

      if (msg.t === "answer") {
        if (role !== "origin") return send({ t: "error", sessionId: msg.sessionId, message: "wrong role" });
        const v = visitorsBySession.get(msg.sessionId);
        if (!v) return; // visitor gone, drop silently
        console.log(`[cloud] answer session=${msg.sessionId} (${msg.sdp.length} bytes)`);
        try {
          v.ws.send(
            JSON.stringify({ t: "answer", sessionId: msg.sessionId, sdp: msg.sdp } satisfies SignalMsg),
          );
        } catch {
          // visitor disconnected mid-flight
        }
        return;
      }

      if (msg.t === "candidate") {
        if (role === "origin") {
          const v = visitorsBySession.get(msg.sessionId);
          if (!v) return;
          v.ws.send(
            JSON.stringify({
              t: "candidate",
              sessionId: msg.sessionId,
              candidate: msg.candidate,
            } satisfies SignalMsg),
          );
          return;
        }

        if (role === "visitor") {
          const visitor = visitorsBySession.get(msg.sessionId);
          const targetPod = msg.podId ?? visitor?.podId ?? podId;
          if (!targetPod) return send({ t: "error", sessionId: msg.sessionId, message: "podId required" });
          const origin = originsByPod.get(targetPod);
          if (!origin) return send({ t: "error", sessionId: msg.sessionId, message: "origin offline" });
          origin.ws.send(
            JSON.stringify({
              t: "candidate",
              sessionId: msg.sessionId,
              candidate: msg.candidate,
            } satisfies SignalMsg),
          );
          return;
        }

        return send({ t: "error", sessionId: msg.sessionId, message: "uninitialized socket" });
      }

      if (msg.t === "error") {
        if (role === "origin" && msg.sessionId) {
          const v = visitorsBySession.get(msg.sessionId);
          v?.ws.send(JSON.stringify(msg));
        } else if (role === "visitor" && podId) {
          const o = originsByPod.get(podId);
          o?.ws.send(JSON.stringify(msg));
        }
        return;
      }
    });

    ws.on("close", () => {
      if (role === "origin" && podId) {
        const cur = originsByPod.get(podId);
        if (cur?.ws === ws) {
          originsByPod.delete(podId);
          opts.onOriginDisconnected?.(podId);
          console.log(`[cloud] origin disconnected: ${podId}`);
        }
      } else if (role === "visitor" && sessionId) {
        visitorsBySession.delete(sessionId);
      }
    });
  });

  return {
    server,
    wss,
    origins: () => [...originsByPod.keys()],
    sessions: () => visitorsBySession.size,
    async close(): Promise<void> {
      for (const conn of originsByPod.values()) {
        try {
          conn.ws.close();
        } catch {
          // ignore
        }
      }
      for (const conn of visitorsBySession.values()) {
        try {
          conn.ws.close();
        } catch {
          // ignore
        }
      }
      wss.close();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await registry.close?.();
    },
  };
}
