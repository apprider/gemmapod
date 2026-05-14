# `@gemmapod/core` (Rust → WASM)

The cryptographic + manifest-parsing core. Single source of truth for the
**signed pod manifest format** that the browser, the pack CLI, and the
cloud all share, plus byte-level Ed25519 helpers used by DARTC.

## What it does

- Defines the on-wire `Manifest` (identity, persona, system prompt, model,
  transport spec, tools) and the `SignedManifest` envelope (Ed25519
  signature over a CBOR-encoded manifest body).
- Signs and verifies arbitrary byte payloads for DARTC envelopes. DARTC
  canonicalizes JSON in TypeScript; this core signs the resulting bytes.
- Exposes `sign` / `verify` / `generateKey` through `wasm_bindgen`.
- Built two ways with identical Rust source:
  - **`pkg/`** — `wasm-pack --target web`. Consumed by `packages/shim`
    (inlined into both `gemmapod-shim.iife.js` and `gemmapod-runtime.iife.js`
    as a base64 `data:` URL). The full IIFE re-exports `GemmaPodCore` so
    `apps/web/build` can sign manifests in the browser.
  - **`pkg-node/`** — `wasm-pack --target nodejs`. Consumed by
    `packages/pack` (build verify round-trip) and `apps/cloud`
    (`POST /pods` server-side verify). Same code path as the browser.

Native Rust tests cover the round-trip (`tests/roundtrip.rs`).

## Run locally

```sh
# from repo root
pnpm build:core         # rebuilds both pkg/ and pkg-node/

# native tests
cd packages/core && cargo test
```

The build emits artifacts into `pkg/` and `pkg-node/` and overwrites
existing files. Both directories are committed (with `pkg/.gitignore`
and `pkg-node/.gitignore` overriding wasm-pack's `*` blanket ignore) so
contributors without a Rust toolchain can still `pnpm install` and run
the rest of the monorepo.

## Toolchain requirements (only if rebuilding)

- Rust 1.78+ with `wasm32-unknown-unknown` target:
  ```sh
  rustup target add wasm32-unknown-unknown
  ```
- `wasm-pack`:
  ```sh
  cargo install wasm-pack --locked
  ```

`wasm-opt` is disabled in `Cargo.toml` because wasm-pack's bundled binaryen
is older than the bulk-memory features rustc emits.

## Public Rust API (used by tests + pack CLI)

```rust
gemmapod_core::testing::generate_key() -> (pubkey_hex, secret_hex)
gemmapod_core::testing::sign(manifest, &secret_hex) -> Vec<u8>
gemmapod_core::testing::verify(&bytes) -> Result<Manifest, String>
gemmapod_core::testing::sign_bytes(payload, &secret_hex) -> Vec<u8>
gemmapod_core::testing::verify_bytes(payload, signature, &public_hex) -> Result<(), String>
```

## JS API (after `await init()`)

```ts
GemmaPodCore.generateKey()    // { publicKey, secretKey } (hex)
GemmaPodCore.signManifest(manifest, secretKey: Uint8Array): Uint8Array
GemmaPodCore.verifyManifest(bytes: Uint8Array): Manifest   // throws on bad sig
GemmaPodCore.signBytes(payload: Uint8Array, secretKey: Uint8Array): Uint8Array
GemmaPodCore.verifyBytes(payload, signature, publicKey): boolean
```

DARTC callers use `generateKey()` to create ephemeral session keys and
`signBytes` / `verifyBytes` for signed envelopes. Owner secrets are not
embedded into packed pods.

## Size

`gemmapod_core_bg.wasm` ≈ **228 KB** unoptimized; ~90 KB gzipped.

## No deploy

Library. Consumed by other workspaces. Not deployed standalone.
