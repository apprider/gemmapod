# GemmaPod examples

Runnable starter templates and integration patterns. Each directory is
self-contained — open one, follow its `README.md`, and have a working
GemmaPod in front of you in under a minute.

| Example | What it shows | Stack |
| --- | --- | --- |
| [hello-pod](./hello-pod) | Smallest signed `.html` pod — `pod.toml` → CLI → blob | `pod.toml` + `gemmapod` CLI |
| [script-tag-embed](./script-tag-embed) | Drop a pod on any HTML page in one `<script>` tag | Vanilla HTML + jsDelivr CDN |
| [nextjs-embed](./nextjs-embed) | App Router page mounting a pod via a client component | Next.js 15 + `@gemmapod/browser` |
| [react-headless](./react-headless) | React app with custom transcript + composer | Vite + React + `@gemmapod/browser/runtime` |
| [copilotkit-style](./copilotkit-style) | DARTC ↔ AG-UI event mapping shown side-by-side | Vite + React + `mapDartcUiEventToAgUi` |
| [restaurant-pod](./restaurant-pod) | `STATE_SNAPSHOT` / `STATE_DELTA` for headless shared state | DARTC UI events + host HTML |
| [origin-daemon-minimal](./origin-daemon-minimal) | Smallest viable origin daemon setup | `@gemmapod/origin` + Ollama |
| [self-host-signaling](./self-host-signaling) | Run your own signaling broker in ~30 lines | `@gemmapod/cloud` + Memory/Sqlite registry |
| [raj-card](./raj-card) | Reference pod — the live explainer at gemmapod.com | `pod.toml` |

## Quick run-everything-locally

In four terminals (or a process manager):

```sh
# 1. Build the WASM core + workspace once.
pnpm install
pnpm build:core
pnpm -r --filter "./packages/*" build

# 2. Start the signaling broker.
pnpm --filter @gemmapod/example-self-host-signaling start
# → http://localhost:8080

# 3. Start the origin daemon (needs Ollama running with gemma4:e4b).
SIGNAL_URL=ws://localhost:8080/signal POD_ID=hello-pod \
  pnpm --filter @gemmapod/origin start

# 4. Build + open a pod.
pnpm --filter @gemmapod/pack exec gemmapod keygen --out examples/hello-pod/owner.key
pnpm --filter @gemmapod/pack exec gemmapod build \
  examples/hello-pod/pod.toml \
  --key examples/hello-pod/owner.key \
  --out examples/hello-pod/hello-pod.html
open examples/hello-pod/hello-pod.html
```

You should see the pod connect over WebRTC and start chatting with Gemma 4
on your machine. Kill the origin and refresh — the page offers a one-click
in-browser fallback via WebGPU + Gemma 4 E2B.

## Production self-host

The simplest production setup is one VM running:

1. `@gemmapod/cloud` (signaling + pod registry, persistent SQLite)
2. `@gemmapod/origin` (one or more daemons, one per pod id)
3. Ollama serving Gemma 4

Both `@gemmapod/cloud` and `@gemmapod/origin` ship Docker images at
`ghcr.io/apprider/gemmapod-cloud` and `ghcr.io/apprider/gemmapod-origin`
for one-line `docker run`.
