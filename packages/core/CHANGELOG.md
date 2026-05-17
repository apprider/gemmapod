# @gemmapod/core

## 0.3.0

### Minor Changes

- Make model optional in manifest and update fallback spec

  - Change `Manifest.model` from `String` to `Option<String>`
  - Change `FallbackSpec.model` to `FallbackSpec.tier: Option<String>`
  - Add `Default` derive to `FallbackSpec`
  - Update serde attributes for optional fields
