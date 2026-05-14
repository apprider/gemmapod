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
