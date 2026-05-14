"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface MountedLike {
  runtime: { events: { on(type: string, h: (e: unknown) => void): () => void } };
  destroy(): Promise<void>;
}
interface GemmaPodGlobal {
  mountPod(
    el: HTMLElement | null,
    config: unknown,
    options?: { ui?: "chat" | "none"; fallbackUi?: "default" | "none" },
  ): Promise<MountedLike>;
}

const config = {
  name: "Next.js demo",
  persona: "Helpful AI agent embedded in a Next.js App Router page.",
  systemPrompt:
    "You are a demo agent. Mention that you're running inside a Next.js page via the @gemmapod/browser IIFE.",
  model: "gemma4:e4b",
  transport: {
    webrtc: { signalUrl: "wss://cloud.gemmapod.com/signal", podId: "nextjs-embed-demo" },
    fallback: { model: "onnx-community/gemma-4-E2B-it-ONNX" },
  },
};

export function PodEmbed() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!scriptReady || !hostRef.current) return;
    let killed = false;
    let mounted: MountedLike | null = null;

    const g = (window as unknown as { GemmaPod?: GemmaPodGlobal }).GemmaPod;
    if (!g?.mountPod) return;

    g.mountPod(hostRef.current, config).then((m) => {
      if (killed) {
        void m.destroy();
        return;
      }
      mounted = m;
      mounted.runtime.events.on("transport.ready", (e) =>
        console.log("[gemmapod] ready:", e),
      );
    });

    return () => {
      killed = true;
      void mounted?.destroy();
    };
  }, [scriptReady]);

  return (
    <>
      <Script
        src="/vendor/gemmapod-shim.iife.js"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />
      <div id="pod" ref={hostRef} />
    </>
  );
}
