#!/usr/bin/env tsx
// End-to-end smoke test for the full cloud-signaling WebRTC path.
//
// Pre-reqs (started separately):
//   - apps/cloud           on ws://localhost:8080/signal
//   - packages/origin      with SIGNAL_URL=ws://localhost:8080/signal,
//                          POD_ID=raj-card
//   - ollama serving gemma4:e4b
//
// This script plays the visitor: opens a WebSocket to the cloud, exchanges
// SDP through it, and then talks to Ollama over the resulting WebRTC data
// channel (which never traverses the cloud — it's peer-to-peer with the
// origin daemon).

import WebSocket from "ws";
import { RTCPeerConnection } from "node-datachannel/polyfill";

const SIGNAL = process.env.SIGNAL_URL ?? "ws://localhost:8080/signal";
const POD_ID = process.env.POD_ID ?? "raj-card";
const MODEL = process.env.MODEL ?? "gemma4:e4b";

async function main() {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const dc = pc.createDataChannel("chat");

  const opened = new Promise<void>((resolve, reject) => {
    dc.addEventListener("open", () => resolve(), { once: true });
    dc.addEventListener("error", () => reject(new Error("dc error")), { once: true });
    setTimeout(() => reject(new Error("dc open timeout")), 8000);
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitGather(pc);

  const sessionId = crypto.randomUUID();
  const ws = new WebSocket(SIGNAL);
  const answerSdp = await new Promise<string>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(
        JSON.stringify({ t: "offer", podId: POD_ID, sessionId, sdp: pc.localDescription!.sdp }),
      );
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "answer" && msg.sessionId === sessionId) {
        ws.close();
        resolve(msg.sdp);
      } else if (msg.t === "error") {
        reject(new Error(msg.message));
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("signal timeout")), 10_000);
  });

  await pc.setRemoteDescription({ sdp: answerSdp, type: "answer" });
  await opened;
  console.log("[e2e] data channel open via cloud-mediated signaling");

  let acc = "";
  const done = new Promise<void>((resolve, reject) => {
    dc.addEventListener("message", (e: any) => {
      const m = JSON.parse(e.data);
      if (m.t === "chunk") {
        acc += m.delta;
        process.stdout.write(m.delta);
      } else if (m.t === "done") {
        process.stdout.write("\n");
        resolve();
      } else if (m.t === "error") {
        reject(new Error(m.message));
      }
    });
  });

  dc.send(
    JSON.stringify({
      t: "req",
      id: "1",
      model: MODEL,
      messages: [
        { role: "system", content: "Reply in one short sentence." },
        { role: "user", content: "What is a gemmapod?" },
      ],
    }),
  );

  await done;
  console.log(`[e2e] OK — ${acc.length} chars peer-to-peer through cloud-mediated handshake`);
  pc.close();
  process.exit(0);
}

async function waitGather(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") resolve();
    });
    setTimeout(resolve, 1500);
  });
}

main().catch((e) => {
  console.error("[e2e] FAIL:", e);
  process.exit(1);
});
