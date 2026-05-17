# @gemmapod/browser

## 0.3.0

### Minor Changes

- Update for optional model and fallback tier

  - Update `RawManifest` and `PodConfig` types for optional `model` field
  - Update `FallbackTransport` to use `tier` instead of `model`
  - Add `fetchBrowserModels()` for dynamic model discovery
  - Move `@huggingface/transformers` and `preact` to devDependencies
  - Update boot.ts and attachBrowserFallbackPrepare.ts for new manifest shape
