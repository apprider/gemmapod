# @gemmapod/dartc

## 0.2.0

### Minor Changes

- Add unified `gemmapod` CLI with interactive `create` wizard, `run` daemon wrapper, and `rebuild` command. Refactor `@gemmapod/origin` to export `startDaemon(config)` for programmatic use. Remove model names from A2A agent cards and `GemmaPodChatRequest`. Ground browser fallback model list in `gemmapod.com/api/browser-models`. Replace hardcoded HuggingFace paths with logical `tier` field in pod manifests.
