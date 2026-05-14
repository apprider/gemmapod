/* tslint:disable */
/* eslint-disable */

export class GemmaPodCore {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    static generateKey(): any;
    static signBytes(payload: Uint8Array, secret_key: Uint8Array): Uint8Array;
    static signManifest(manifest_js: any, secret_key: Uint8Array): Uint8Array;
    static verifyBytes(payload: Uint8Array, signature: Uint8Array, public_key: Uint8Array): boolean;
    static verifyManifest(bytes: Uint8Array): any;
}

export function _start(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_gemmapodcore_free: (a: number, b: number) => void;
    readonly _start: () => void;
    readonly gemmapodcore_generateKey: (a: number) => void;
    readonly gemmapodcore_signBytes: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly gemmapodcore_signManifest: (a: number, b: number, c: number, d: number) => void;
    readonly gemmapodcore_verifyBytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly gemmapodcore_verifyManifest: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export3: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
