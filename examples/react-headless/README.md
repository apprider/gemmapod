# react-headless

A React app that mounts the **runtime-only** GemmaPod IIFE and renders
its own transcript + composer. Zero coupling to the shim's built-in
Preact widget — this is what you reach for when GemmaPod needs to live
inside an existing React shell (CopilotKit, AI SDK chat, custom design
system).

## Run

```sh
pnpm install                  # from repo root (once)
pnpm --filter @gemmapod/example-react-headless dev
# open http://localhost:5174
```

## What it shows

- Loading **`gemmapod-runtime.iife.js`** (no Preact bundled) via a
  `<script>` tag in `index.html`.
- Calling **`GemmaPod.mountPod(null, config, { ui: "none", fallbackUi:
  "default", fallbackMountParent: ref.current })`** — headless mount.
  The runtime drives transport + events; the React component drives the UI.
- Subscribing to `runtime.events`:
  - `transport.ready` / `transport.fallback` / `runtime.error` for status
  - `ui.event` filtered to `TEXT_MESSAGE_CONTENT` for streaming assistant
    text into a custom transcript
- Calling `runtime.chat.stream(text)` from a normal `<form>` submit.
- Letting the runtime drop the default fallback prepare panel **into a
  React ref** when the origin is offline (rather than always at the
  bottom of `document.body`).

## Production notes

- For a `package.json` install, swap `<script src="https://cdn.jsdelivr.net/…">`
  for `import "@gemmapod/browser/runtime"` and re-export the global. The
  IIFE side-effects `window.GemmaPod` either way.
- This example types `window.GemmaPod` loosely (just what it uses); for
  a real app pull in `@gemmapod/browser/runtime`'s d.ts via
  `/// <reference types="@gemmapod/browser/dist/gemmapod-browser-runtime" />`.
- If your design system already provides a chat UI (e.g. CopilotKit),
  use [`copilotkit-style`](../copilotkit-style) instead — same wiring
  but with the AG-UI PascalCase mapper.
