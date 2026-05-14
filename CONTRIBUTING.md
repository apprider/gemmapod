# Contributing to GemmaPod

Thank you for thinking about contributing. GemmaPod is an open-source SDK for
**composable, portable AI agent capsules**: signed `.html` blobs you can
email, embed, or deploy that boot into a typed `GemmaPodRuntime` and talk to a
Gemma 4 model over DARTC (a signed WebRTC envelope) — with an in-browser
WebGPU fallback when the owner is offline.

## Where things live

```
packages/
  dartc/    — @gemmapod/dartc   — signed envelope + UI-event types
  core/     — @gemmapod/core    — Rust → WASM signing/verifying (web + node)
  shim/     — @gemmapod/shim    — browser runtime + Preact widget (two IIFEs)
  browser/  — @gemmapod/browser — npm wrapper around the IIFEs
  pack/     — @gemmapod/pack    — `gemmapod` CLI: pod.toml → signed .html
  origin/   — @gemmapod/origin  — owner daemon (DARTC + Ollama proxy)
  cloud/    — @gemmapod/cloud   — reference signaling broker + pod registry

apps/
  docs/     — Fumadocs site → docs.gemmapod.com (in this repo)

examples/   — runnable starter pods + integration templates
```

The runtime contract is documented in [`runtime.md`](./runtime.md); the wire
protocol in [`dartc.md`](./dartc.md). Both are canonical — when in doubt,
make code match spec.

## Setup

You need:

- Node **22+**
- pnpm **9+** (use Corepack: `corepack enable && corepack prepare pnpm@9 --activate`)
- Rust stable with the `wasm32-unknown-unknown` target — **only** if you
  rebuild `@gemmapod/core`. The committed `packages/core/pkg/` and
  `packages/core/pkg-node/` work for everything else.
- Optional: [Ollama](https://ollama.com) with `gemma4:e4b` if you want to
  test against a real model end-to-end.

```sh
pnpm install
pnpm build:core                # only if you changed Rust sources
pnpm -r --filter "./packages/**" build
pnpm --filter @gemmapod/dartc test
```

## Making a change

1. Open an issue first for non-trivial work so we agree on direction.
2. Fork → branch → commit. Conventional commits are appreciated but not required.
3. Run a build + test pass: `pnpm -r --filter "./packages/**" build && pnpm --filter @gemmapod/dartc test`.
4. **Add a changeset** if your change affects any published package:
   ```sh
   pnpm changeset
   ```
   Pick the bump (`patch` for fixes, `minor` for features, `major` only for
   breaking changes, which we'll be very conservative about pre-1.0). Commit
   the generated `.changeset/<slug>.md` alongside your code.
5. Open a PR. CI runs:
   - Build core (Rust → WASM) + every workspace package
   - `@gemmapod/dartc` test suite
   - `npm pack --dry-run` to verify the published tarball contents
   - End-to-end CLI smoke (keygen → init → build a signed pod)
   - If you touched `packages/origin/**`: native build matrix across
     macOS / Linux / Windows on Node 22

## Snapshot releases for PR testing

Maintainers can publish a snapshot of any open PR (e.g.
`@gemmapod/shim@0.1.1-pr-42-<sha>`) so consumers can test the change without
waiting for merge. Comment `/snapshot` on the PR (once the release workflow
is in place) or run locally:

```sh
pnpm changeset:snapshot
```

## Versioning policy

- **npm packages** follow [semver](https://semver.org). We are at 0.x — minor
  bumps may include breaking changes; we'll always note them in the
  changelog.
- **DARTC wire format** carries its own version (`v0.2` today) and is
  **independent** of npm semver. A patch bump of `@gemmapod/shim` MUST NOT
  change the wire format. Breaking changes there require a DARTC version
  bump and coordinated origin/visitor support.
- **Signed manifest CBOR** is similarly stable. Adding optional fields is
  fine; removing or renaming requires a manifest version bump.

## Style

- TypeScript: strict mode is on across the workspace. No `any` without a
  reason in a comment.
- Rust (`packages/core`): keep the `wasm-bindgen` surface narrow.
- Don't add comments that just restate code. Comment the **why**: hidden
  constraints, security invariants, browser quirks.
- Don't ship feature flags or backwards-compatibility shims unless we've
  already published a release that the shim is for.

## Security

If you find a vulnerability, **please don't open a public issue**.
Use [GitHub's private security advisory flow](https://github.com/apprider/gemmapod/security/advisories/new)
or email **raj.design@gmail.com** with subject `[gemmapod-sec]`.

See [`SECURITY.md`](./SECURITY.md) for the threat model and what's in/out
of scope.

## Code of Conduct

This project follows the [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md).
Be kind. Assume good faith. Disagree about ideas, not people.

## License

By contributing you agree your contributions are licensed under the MIT
License (see [`LICENSE`](./LICENSE)).
