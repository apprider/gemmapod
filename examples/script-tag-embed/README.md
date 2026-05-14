# script-tag-embed

Static HTML page. One `<script>` tag, one `<div>`. The smallest possible
GemmaPod integration on a website you already own.

## Run it

Open `index.html` in a browser. That's the whole demo.

For a local dev server with hot reload:

```sh
npx serve .                # or any static-file server
```

## What it shows

- Loading `@gemmapod/browser` via jsDelivr (CDN-friendly, cacheable, easy
  to pin via Subresource Integrity).
- Calling **`GemmaPod.mountPod(el, config)`** — the recommended one-line
  embed.
- Subscribing to `runtime.events` on the returned handle.
- Cleaning up with `destroy()` on `pagehide`.

## Production checklist

1. **Pin the version**: replace `@0.1.0` in the script URL with whatever
   tag you tested against. Don't `@latest` in production.
2. **Add Subresource Integrity** — see the build instructions in
   [`packages/browser/README.md`](../../packages/browser/README.md#subresource-integrity-production).
3. **Point `signalUrl` + `podId`** at your own origin (either the public
   `cloud.gemmapod.com` or a self-hosted `@gemmapod/cloud`).
4. **Set a strict `Content-Security-Policy`** on the embedding page. The
   shim needs `'wasm-unsafe-eval'` for the WASM core and `'unsafe-inline'`
   for its inlined boot snippet; everything else can be locked down.
