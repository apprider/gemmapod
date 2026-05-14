//! gemmapod-core: signed manifest parsing + Ed25519 verification for pod blobs.
//!
//! Two surfaces:
//!   - the plain Rust API in this file's `pub fn` items, used by tests and
//!     the (future) pack CLI when run via wasm-bindgen from Node.
//!   - the `GemmaPodCore` wasm_bindgen wrapper at the bottom, which is what
//!     the browser shim imports.

mod manifest;
mod keys;

pub use keys::{SigningKey, VerifyingKey};
pub use manifest::{Manifest, ManifestError, SignedManifest, TransportSpec, ToolSpec};

use wasm_bindgen::prelude::*;

/// Public test/library surface. Browsers go through `GemmaPodCore` below;
/// `cargo test` and Node-side callers can use these directly.
pub mod testing {
    use super::*;

    pub use crate::manifest::{Manifest, TransportSpec};

    pub fn generate_key() -> (String, String) {
        let sk = SigningKey::generate();
        (sk.public_hex(), sk.secret_hex())
    }

    pub fn sign(manifest: Manifest, secret_hex: &str) -> Result<Vec<u8>, String> {
        let bytes = hex::decode(secret_hex).map_err(|e| e.to_string())?;
        let key = SigningKey::from_raw_bytes(&bytes).map_err(|e| e.to_string())?;
        let signed = SignedManifest::sign(manifest, &key).map_err(|e| e.to_string())?;
        signed.encode().map_err(|e| e.to_string())
    }

    pub fn verify(bytes: &[u8]) -> Result<Manifest, String> {
        let signed = SignedManifest::decode(bytes).map_err(|e| e.to_string())?;
        signed.verify().map_err(|e| e.to_string())?;
        Ok(signed.manifest)
    }

    pub fn sign_bytes(payload: &[u8], secret_hex: &str) -> Result<Vec<u8>, String> {
        let bytes = hex::decode(secret_hex).map_err(|e| e.to_string())?;
        let key = SigningKey::from_raw_bytes(&bytes).map_err(|e| e.to_string())?;
        Ok(key.sign(payload).to_vec())
    }

    pub fn verify_bytes(payload: &[u8], signature: &[u8], public_hex: &str) -> Result<(), String> {
        if signature.len() != 64 {
            return Err("signature must be 64 bytes".into());
        }
        let pk_bytes = hex::decode(public_hex).map_err(|e| e.to_string())?;
        let verifier = VerifyingKey::from_bytes(&pk_bytes).map_err(|e| e.to_string())?;
        let mut sig = [0u8; 64];
        sig.copy_from_slice(signature);
        verifier.verify(payload, &sig).map_err(|e| e.to_string())
    }
}

#[wasm_bindgen(start)]
pub fn _start() {
    std::panic::set_hook(Box::new(|info| {
        web_sys_log(&format!("{info}"));
    }));
}

fn web_sys_log(msg: &str) {
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace = console)]
        fn error(s: &str);
    }
    error(msg);
}

#[wasm_bindgen]
pub struct GemmaPodCore;

#[wasm_bindgen]
impl GemmaPodCore {
    #[wasm_bindgen(js_name = verifyManifest)]
    pub fn verify_manifest(bytes: &[u8]) -> Result<JsValue, JsError> {
        let signed = SignedManifest::decode(bytes)?;
        signed.verify()?;
        serde_wasm_bindgen::to_value(&signed.manifest).map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = signManifest)]
    pub fn sign_manifest(manifest_js: JsValue, secret_key: &[u8]) -> Result<Vec<u8>, JsError> {
        let manifest: Manifest = serde_wasm_bindgen::from_value(manifest_js)
            .map_err(|e| JsError::new(&format!("invalid manifest shape: {e}")))?;
        let key = SigningKey::from_raw_bytes(secret_key).map_err(|e| JsError::new(&e))?;
        let signed = SignedManifest::sign(manifest, &key)?;
        signed.encode().map_err(|e| JsError::new(&e.to_string()))
    }

    #[wasm_bindgen(js_name = signBytes)]
    pub fn sign_bytes(payload: &[u8], secret_key: &[u8]) -> Result<Vec<u8>, JsError> {
        let key = SigningKey::from_raw_bytes(secret_key).map_err(|e| JsError::new(&e))?;
        Ok(key.sign(payload).to_vec())
    }

    #[wasm_bindgen(js_name = verifyBytes)]
    pub fn verify_bytes(
        payload: &[u8],
        signature: &[u8],
        public_key: &[u8],
    ) -> Result<bool, JsError> {
        if signature.len() != 64 {
            return Err(JsError::new("signature must be 64 bytes"));
        }
        let verifier = VerifyingKey::from_bytes(public_key).map_err(|e| JsError::new(e))?;
        let mut sig = [0u8; 64];
        sig.copy_from_slice(signature);
        Ok(verifier.verify(payload, &sig).is_ok())
    }

    #[wasm_bindgen(js_name = generateKey)]
    pub fn generate_key() -> Result<JsValue, JsError> {
        let sk = SigningKey::generate();
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(&obj, &"publicKey".into(), &sk.public_hex().into())
            .map_err(|_| JsError::new("Reflect.set publicKey failed"))?;
        js_sys::Reflect::set(&obj, &"secretKey".into(), &sk.secret_hex().into())
            .map_err(|_| JsError::new("Reflect.set secretKey failed"))?;
        Ok(obj.into())
    }
}
