# `@gemmapod/docs`

Fumadocs-powered documentation site at **docs.gemmapod.com**. Deploys
from the public `gemmapod` repo to its own Vercel project.

## Stack

- **Next.js 15** App Router
- **fumadocs-ui** + **fumadocs-mdx** for the docs framework
- MDX content under `content/docs/`
- Built-in TOC; search is wired to Algolia DocSearch (post-v0.1) — not
  yet active.

## Run locally

```sh
pnpm install                  # from repo root (once)
pnpm --filter @gemmapod/docs dev
# open http://localhost:3002
```

`postinstall` runs `fumadocs-mdx` to generate the `.source/` codegen
that wires MDX content into Next.

## Build

```sh
pnpm --filter @gemmapod/docs build
# emits .next/
```

## Content layout

```
content/docs/
├── meta.json
├── index.mdx
├── introduction/        what-is-gemmapod · core-concepts · architecture · why-portable-agents
├── quickstart/          install · first-pod-cli · first-pod-script · first-pod-react
├── guides/              15 guides — embedding, headless mode, CopilotKit/AG-UI bridge,
│                        tools, deployment, self-hosting, fallback, conversation memory, state
├── reference/
│   ├── cli/             gemmapod CLI: init · keygen · doctor · build
│   ├── runtime/         GemmaPodRuntime · mountPod · event bus · state store · chat · capabilities · transports
│   ├── dartc/           envelope · topics · ui-events · a2a
│   └── pod-manifest/    pod-toml · signed-manifest
├── protocol/            dartc-spec (verbatim) · runtime-spec (verbatim) · security-model · versioning
├── recipes/             ai-business-card · product-explainer · restaurant-pod · negotiation-pod
├── changelog.mdx
└── contributing.mdx
```

## Deploy

Connect this directory as a Vercel project root (or your CDN of choice):

- **Framework preset**: Next.js
- **Root directory**: `apps/docs`
- **Install command**: `pnpm install --frozen-lockfile`
- **Build command**: `pnpm --filter @gemmapod/docs build`
- **Output directory**: `apps/docs/.next`
- **Node version**: 22

Point `docs.gemmapod.com` at the Vercel deployment.

## Notes

- `lib/source.ts` includes a small ABI bridge between `fumadocs-mdx@11.10`
  (which exposes `files` lazily) and `fumadocs-core@15.8` (which expects
  the resolved array). Remove the bridge when the upstream typing
  stabilises.
- The protocol pages (`protocol/dartc-spec.mdx`,
  `protocol/runtime-spec.mdx`) port the canonical specs verbatim from
  `dartc.md` and `runtime.md` at the repo root. Keep them in sync.
