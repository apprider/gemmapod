# @gemmapod/origin

## 0.3.0

### Minor Changes

- Refactor UI tools into generic + companion-specific categories

  - Extract `react_companion` and `say_companion` into new `buildCompanionTools()` in `mastra/tools/companion.ts`
  - `buildUiEventTools()` now only contains generic tools: `show_presentation`, `set_state`, `send_custom_event`
  - `createPodAgent()` accepts optional `uiTools` param; merges host-provided tools with generic UI tools
  - `getMastraInstance()` passes `uiTools` through to `createPodAgent()`
  - `daemon.ts` explicitly registers `buildCompanionTools()` for backward compatibility
  - System prompt dynamically lists only registered UI tools
  - Add `happy` to `CompanionMood` enum

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
