# hello-pod

The smallest possible signed GemmaPod. One TOML file, one CLI command, one
self-contained `.html` blob you can email.

## Build it

```sh
# from the repo root (you need @gemmapod/pack + @gemmapod/shim built)
pnpm --filter @gemmapod/pack exec gemmapod keygen --out examples/hello-pod/owner.key
pnpm --filter @gemmapod/pack exec gemmapod build \
  examples/hello-pod/pod.toml \
  --key examples/hello-pod/owner.key \
  --out examples/hello-pod/hello-pod.html
```

You now have **`hello-pod.html`** (~960 KB). Open it in any browser.

## What you'll see

- If you have **`pnpm dev:cloud` + `pnpm dev:origin` + `ollama serve`**
  running locally, the pod opens a WebRTC data channel back to your origin
  daemon, exchanges DARTC `dartc.hello` envelopes, and chats with the real
  `gemma4:e4b` model on your machine.
- If you don't, the pod shows a fallback panel offering to download Gemma 4
  E2B locally. Click "Download local model" once (~3 GB, cached), then chat
  entirely in-browser via WebGPU.

## What's signed

Everything in `pod.toml` — the system prompt, the transport config, even the
list of allowed tools — is committed to an Ed25519 signature over a CBOR
manifest. The browser verifies that signature before any UI renders. Tamper
with the `.html` and you get a visible "gemmapod refused to mount" instead
of a degraded persona.

## Next

- Email the `.html` to a friend. They open it; it phones your origin.
- Deploy it: `curl -X POST -H 'Content-Type: text/html' --data-binary @hello-pod.html https://cloud.gemmapod.com/pods` returns a stable `gemmapod.com/<id>` URL.
- Add a tool: append `[[tools]]` blocks to `pod.toml`, rebuild, run the
  origin daemon — the origin will only expose tools whose names appear in
  the signed manifest.
