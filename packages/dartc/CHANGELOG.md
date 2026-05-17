# @gemmapod/dartc

## 0.3.0

### Minor Changes

- Add A2A agent card extensions and DARTC protocol metadata

  - Add `GemmaPodDartcExtension` and `GemmaPodPodExtension` interfaces for A2A agent cards
  - Add `PodAgentCard` type with typed extensions array
  - Add `ManifestInput` interface for building agent cards from manifests
  - Add `agentCardFromManifest()` helper to construct A2A-shaped agent cards
  - Remove `model` field from `GemmaPodChatRequest` (origin selects model at runtime)
  - Add `A2ADiscoveryPayload` and `A2AAgentCard` exports

## 0.2.0

### Minor Changes

- Add unified `gemmapod` CLI with interactive `create` wizard, `run` daemon wrapper, and `rebuild` command. Refactor `@gemmapod/origin` to export `startDaemon(config)` for programmatic use. Remove model names from A2A agent cards and `GemmaPodChatRequest`. Ground browser fallback model list in `gemmapod.com/api/browser-models`. Replace hardcoded HuggingFace paths with logical `tier` field in pod manifests.
