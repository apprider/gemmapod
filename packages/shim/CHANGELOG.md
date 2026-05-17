# @gemmapod/shim

## 0.3.0

### Minor Changes

- Update for optional model and fallback tier

  - Update `RawManifest` and `PodConfig` types for optional `model` field
  - Update `FallbackTransport` to use `tier` instead of `model`
  - Add `fetchBrowserModels()` for dynamic model discovery
  - Move `@huggingface/transformers` and `preact` to devDependencies
  - Update boot.ts and attachBrowserFallbackPrepare.ts for new manifest shape

### Patch Changes

- Updated dependencies []:
  - @gemmapod/core@0.3.0
  - @gemmapod/dartc@0.3.0

## 0.2.0

### Minor Changes

- Add unified `gemmapod` CLI with interactive `create` wizard, `run` daemon wrapper, and `rebuild` command. Refactor `@gemmapod/origin` to export `startDaemon(config)` for programmatic use. Remove model names from A2A agent cards and `GemmaPodChatRequest`. Ground browser fallback model list in `gemmapod.com/api/browser-models`. Replace hardcoded HuggingFace paths with logical `tier` field in pod manifests.

### Patch Changes

- Updated dependencies []:
  - @gemmapod/dartc@0.2.0
