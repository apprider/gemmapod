import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16 text-center">
      <span className="mb-4 inline-block rounded-full border border-fd-border bg-fd-card px-3 py-1 text-xs font-medium text-fd-muted-foreground">
        v0.1 · MIT licensed
      </span>
      <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">
        Portable AI agents you can email anywhere.
      </h1>
      <p className="mb-8 max-w-2xl text-lg text-fd-muted-foreground">
        A <strong>GemmaPod</strong> is a single signed HTML+JS+WASM file (~960 KB)
        that bundles an AI agent&apos;s identity, persona, tools, and transport
        into one capsule. Email it, embed it with one <code>&lt;script&gt;</code>
        tag, or deploy it to a stable URL. When activated it phones home over
        WebRTC to a Gemma 4 model — or runs in the visitor&apos;s browser via
        WebGPU if the owner is offline.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/docs"
          className="rounded-md bg-fd-primary px-5 py-2.5 text-sm font-semibold text-fd-primary-foreground transition hover:opacity-90"
        >
          Get started →
        </Link>
        <Link
          href="/docs/quickstart/first-pod-cli"
          className="rounded-md border border-fd-border px-5 py-2.5 text-sm font-semibold transition hover:bg-fd-accent"
        >
          Build your first pod
        </Link>
        <a
          href="https://github.com/apprider/gemmapod"
          className="rounded-md border border-fd-border px-5 py-2.5 text-sm font-semibold transition hover:bg-fd-accent"
        >
          GitHub
        </a>
      </div>

      <div className="mt-16 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
        <Card title="One signed blob" body="Manifest + WASM + shim in one ~960 KB .html. Email it, deploy it, embed it." />
        <Card title="DARTC over WebRTC" body="Signed envelopes on a peer-to-peer data channel. Cloud carries SDP only." />
        <Card title="AG-UI compatible" body="`gemmapod.ui.event` ships AG-UI-shaped lifecycle events. CopilotKit-ready." />
      </div>
    </main>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-fd-border bg-fd-card p-5 text-left">
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-fd-muted-foreground">{body}</p>
    </div>
  );
}
