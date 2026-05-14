// Thin wrapper around the @gemmapod/core WASM. Lazy-inits the module once;
// callers should `await coreReady()` before invoking any function below.

import init, { GemmaPodCore } from "@gemmapod/core/web";
import { embeddedWasmBytes } from "./wasmBytes";

let initPromise: Promise<void> | null = null;

export function coreReady(): Promise<void> {
  if (!initPromise) {
    initPromise = embeddedWasmBytes().then((bytes) => init({ module_or_path: bytes })).then(() => undefined);
  }
  return initPromise;
}

export interface Manifest {
  v: number;
  id: string;
  name: string;
  persona: string;
  system_prompt: string;
  model: string;
  owner_pubkey: string;
  transport: unknown;
  tools?: Array<{ name: string; description: string }>;
}

export function verifyManifest(bytes: Uint8Array): Manifest {
  return GemmaPodCore.verifyManifest(bytes) as Manifest;
}

export function signManifest(manifest: Manifest, secretKey: Uint8Array): Uint8Array {
  return GemmaPodCore.signManifest(manifest, secretKey);
}

export function generateKey(): { publicKey: string; secretKey: string } {
  return GemmaPodCore.generateKey() as { publicKey: string; secretKey: string };
}

export function signBytes(payload: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return GemmaPodCore.signBytes(payload, secretKey);
}

export function verifyBytes(payload: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return GemmaPodCore.verifyBytes(payload, signature, publicKey);
}
