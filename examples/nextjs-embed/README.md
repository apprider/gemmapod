# nextjs-embed

Embed a GemmaPod in a Next.js App Router page. The shim IIFE is served
from `/public/vendor/` (copied at build time from the installed
`@gemmapod/browser` package); the page uses `<Script>` to load it and a
client component to mount.

## Run

```sh
pnpm install                  # from repo root (once)
pnpm --filter @gemmapod/example-nextjs-embed dev
# open http://localhost:3001
```

`predev` runs `scripts/copy-shim.mjs`, which copies
`@gemmapod/browser/dist/gemmapod-shim.iife.js` into `public/vendor/`.

## What it shows

- **App Router client component pattern.** `app/PodEmbed.tsx` is a
  `"use client"` component that mounts the IIFE-driven `window.GemmaPod`
  into a ref'd `<div>`. Server components don't touch the runtime.
- **`<Script strategy="afterInteractive">`** for the shim IIFE — Next.js
  guarantees it loads after the page is interactive.
- **Cleanup on unmount.** `useEffect` returns a teardown that calls
  `mounted.destroy()`.
- **Workspace → installed package portability.** The copy-shim script
  uses `require.resolve("@gemmapod/browser/dist/...")` so the same code
  works in a downstream app installing from npm.

## Production checklist

1. Pin the version: `"@gemmapod/browser": "^0.1.0"` in `package.json`,
   no `latest`.
2. Add a strict CSP via `next.config.mjs` `headers()`. The shim needs
   `'wasm-unsafe-eval'` for the WASM core and `'unsafe-inline'` for the
   inlined boot snippet; everything else can be locked down.
3. Set `signalUrl` to your own signaling broker.
4. Consider hosting the IIFE on your own static CDN rather than
   jsDelivr if you want full control over headers + integrity.
