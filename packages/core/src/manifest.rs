use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::keys::{SigningKey, VerifyingKey};

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("cbor decode: {0}")]
    Decode(String),
    #[error("cbor encode: {0}")]
    Encode(String),
    #[error("signature verification failed")]
    BadSignature,
    #[error("invalid public key in manifest")]
    BadPublicKey,
    #[error("malformed signature")]
    BadSignatureBytes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Schema version. v=1 for now.
    pub v: u8,
    /// Stable pod id (e.g. "raj-card").
    pub id: String,
    /// Display name shown in the chat widget header.
    pub name: String,
    /// Short persona blurb.
    pub persona: String,
    /// System prompt seeded into every chat turn.
    pub system_prompt: String,
    /// Preferred model identifier (e.g. "gemma4:e4b").
    pub model: String,
    /// Owner's Ed25519 public key (hex). Verification anchors to this.
    pub owner_pubkey: String,
    /// Transport configuration. JSON-shaped; the runtime interprets.
    pub transport: TransportSpec,
    /// Tools the pod is allowed to call.
    #[serde(default)]
    pub tools: Vec<ToolSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransportSpec {
    /// Ordered list of transports to try: e.g. ["webrtc", "fallback"].
    #[serde(default)]
    pub preferred: Vec<String>,
    #[serde(default)]
    pub webrtc: Option<WebRtcSpec>,
    #[serde(default)]
    pub direct: Option<DirectSpec>,
    #[serde(default)]
    pub fallback: Option<FallbackSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebRtcSpec {
    pub signal_url: String,
    pub pod_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectSpec {
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FallbackSpec {
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
}

/// Wire-format: a CBOR-encoded `Manifest` payload alongside a detached
/// Ed25519 signature over those exact bytes.
#[derive(Debug, Serialize, Deserialize)]
struct SignedManifestWire {
    /// Detached signature bytes (64).
    sig: Vec<u8>,
    /// CBOR-encoded `Manifest`. Stored as bytes so the signature covers the
    /// canonical encoding the signer saw.
    payload: Vec<u8>,
}

pub struct SignedManifest {
    pub manifest: Manifest,
    pub payload_bytes: Vec<u8>,
    pub signature: [u8; 64],
}

impl SignedManifest {
    pub fn decode(bytes: &[u8]) -> Result<Self, ManifestError> {
        let wire: SignedManifestWire =
            ciborium::de::from_reader(bytes).map_err(|e| ManifestError::Decode(e.to_string()))?;
        if wire.sig.len() != 64 {
            return Err(ManifestError::BadSignatureBytes);
        }
        let mut sig = [0u8; 64];
        sig.copy_from_slice(&wire.sig);
        let manifest: Manifest = ciborium::de::from_reader(wire.payload.as_slice())
            .map_err(|e| ManifestError::Decode(e.to_string()))?;
        Ok(SignedManifest {
            manifest,
            payload_bytes: wire.payload,
            signature: sig,
        })
    }

    pub fn encode(&self) -> Result<Vec<u8>, ManifestError> {
        let wire = SignedManifestWire {
            sig: self.signature.to_vec(),
            payload: self.payload_bytes.clone(),
        };
        let mut out = Vec::with_capacity(self.payload_bytes.len() + 96);
        ciborium::ser::into_writer(&wire, &mut out)
            .map_err(|e| ManifestError::Encode(e.to_string()))?;
        Ok(out)
    }

    pub fn sign(manifest: Manifest, key: &SigningKey) -> Result<Self, ManifestError> {
        let mut payload = Vec::new();
        ciborium::ser::into_writer(&manifest, &mut payload)
            .map_err(|e| ManifestError::Encode(e.to_string()))?;
        let sig = key.sign(&payload);
        Ok(SignedManifest {
            manifest,
            payload_bytes: payload,
            signature: sig,
        })
    }

    pub fn verify(&self) -> Result<(), ManifestError> {
        let pk_bytes = hex::decode(&self.manifest.owner_pubkey)
            .map_err(|_| ManifestError::BadPublicKey)?;
        let verifier = VerifyingKey::from_bytes(&pk_bytes).map_err(|_| ManifestError::BadPublicKey)?;
        verifier
            .verify(&self.payload_bytes, &self.signature)
            .map_err(|_| ManifestError::BadSignature)
    }
}
