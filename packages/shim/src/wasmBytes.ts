import wasmUrl from "@gemmapod/core/pkg/gemmapod_core_bg.wasm?url";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesFromDataUrl(url: string): Uint8Array | null {
  const match = /^data:application\/wasm;base64,(.+)$/i.exec(url);
  return match ? b64ToBytes(match[1]!) : null;
}

export async function embeddedWasmBytes(): Promise<Uint8Array> {
  const inlined = bytesFromDataUrl(wasmUrl);
  if (inlined) return inlined;

  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`failed to load wasm: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
