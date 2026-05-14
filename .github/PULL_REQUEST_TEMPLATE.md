<!--
Thanks for contributing! A few things make review smooth:

  1. If this changes a public API or any `@gemmapod/*` package surface,
     run `pnpm changeset` to add a changeset describing the bump.
     Skipping that on doc/test/refactor PRs is fine.
  2. Keep PRs focused. One concern per PR if possible.
  3. The CI matrix builds @gemmapod/core (Rust → WASM) and every workspace
     package. If you're unsure why a test fails, drop a comment.
-->

## What changed

<!-- A one-sentence summary readers should see first. -->

## Why

<!-- The user problem this solves or the bug it fixes. Link related issues with #123. -->

## Surface area

- [ ] No API change (docs, internal refactor, test, infra)
- [ ] Adds API surface (new export, new manifest field, new DARTC topic/UI event)
- [ ] Changes existing API surface (breaking? deprecation? migration note?)
- [ ] Changes wire protocol (DARTC envelope, signed manifest CBOR, UI event schema)

## Checklist

- [ ] I added a changeset (`pnpm changeset`) for any version-affecting change.
- [ ] I ran `pnpm -r --filter "./packages/**" build` locally.
- [ ] I ran `pnpm --filter @gemmapod/dartc test` (and any other relevant suite).
- [ ] If user-facing, I updated `docs/content/` or the relevant package README.
- [ ] If touching `packages/origin/**`, I'm aware the `origin-native` CI matrix
      will re-run across macOS/Linux/Windows.
