// Security headers applied to every pod blob and metadata response served
// from the cloud broker. Defense in depth: even if our own code grew an
// XSS or our blob-serving became an open redirect, the headers below
// constrain what an attacker can do from a `<host>/<id>` pod page.
//
// The CSP needs to support:
//   - Inline boot scripts in the pod blob (`'unsafe-inline'`).
//   - `WebAssembly.instantiate` of the WASM core (`'wasm-unsafe-eval'`).
//   - WebRTC signaling to arbitrary `wss:` hosts (the manifest decides).
//   - On-demand load of transformers.js from jsDelivr + the model from
//     Hugging Face when the visitor opts into the in-browser fallback.
//
// Override via the `headers` option on `createSignalServer` if you need a
// stricter CSP or different model CDNs for your deployment.

const DEFAULT_CSP_PARTS = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  // wss: covers any owner-chosen signaling endpoint.
  // huggingface.co + *.hf.co + cas-bridge.xethub.hf.co: model + LFS CDN.
  // cdn.jsdelivr.net: transformers.js itself (loaded only on user click).
  "connect-src 'self' wss: stun: https://cdn.jsdelivr.net https://huggingface.co https://*.hf.co https://cas-bridge.xethub.hf.co",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Pods are designed to be embedded anywhere (email, third-party sites).
  // The owner accepts this risk when they sign the manifest. Restrict per
  // pod via the `podHeaders` extra map if you need site-specific framing.
  "frame-ancestors *",
  "form-action 'none'",
  "base-uri 'self'",
];
export const DEFAULT_POD_CSP = DEFAULT_CSP_PARTS.join("; ");

const DEFAULT_PERMISSIONS = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "magnetometer=()",
  "accelerometer=()",
  "gyroscope=()",
].join(", ");

export interface PodHeaderOptions {
  /** Override the full CSP string. Default: `DEFAULT_POD_CSP`. */
  csp?: string;
  /** Override the Permissions-Policy header. Default: deny most sensors. */
  permissionsPolicy?: string;
}

/** Headers attached to `/:id` — the served pod blob. */
export function podHeaders(
  extra: Record<string, string> = {},
  options: PodHeaderOptions = {},
): Record<string, string> {
  return {
    "Content-Security-Policy": options.csp ?? DEFAULT_POD_CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": options.permissionsPolicy ?? DEFAULT_PERMISSIONS,
    // Pods speak WebRTC, not legacy XHR — let proxies cache them but
    // re-validate frequently so a re-uploaded blob takes effect quickly.
    "Cache-Control": "public, max-age=300, must-revalidate",
    ...extra,
  };
}

/** Headers for the JSON metadata endpoint. No CSP — it isn't an HTML
 *  document. */
export function metaHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cache-Control": "private, no-store",
  };
}
