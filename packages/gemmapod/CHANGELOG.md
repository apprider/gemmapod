# gemmapod

## 0.3.0

### Minor Changes

- New CLI package and pack updates for v0.2

  - Add `gemmapod` CLI package with `create`, `build`, `run`, `doctor` commands
  - Update `@gemmapod/pack` to use `tier` instead of `model` in fallback transport
  - Update default signal URL to `https://signal.gemmapod.com/signal`
  - Update doctor validation for new manifest shape

### Patch Changes

- Updated dependencies []:
  - @gemmapod/core@0.3.0
  - @gemmapod/origin@0.3.0
  - @gemmapod/shim@0.3.0

## 0.2.0

### Minor Changes

- Add unified `gemmapod` CLI with interactive `create` wizard, `run` daemon wrapper, and `rebuild` command. Refactor `@gemmapod/origin` to export `startDaemon(config)` for programmatic use. Remove model names from A2A agent cards and `GemmaPodChatRequest`. Ground browser fallback model list in `gemmapod.com/api/browser-models`. Replace hardcoded HuggingFace paths with logical `tier` field in pod manifests.

### Patch Changes

- Updated dependencies []:
  - @gemmapod/shim@0.2.0
  - @gemmapod/origin@0.2.0
