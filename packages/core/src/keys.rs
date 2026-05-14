use ed25519_dalek::{Signer, SigningKey as DalekSigningKey, Verifier, VerifyingKey as DalekVerifyingKey};
use rand_core::OsRng;

pub struct SigningKey(DalekSigningKey);

impl SigningKey {
    pub fn generate() -> Self {
        let mut csprng = OsRng;
        SigningKey(DalekSigningKey::generate(&mut csprng))
    }

    pub fn from_raw_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != 32 {
            return Err("secret key must be 32 bytes".into());
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(bytes);
        Ok(SigningKey(DalekSigningKey::from_bytes(&arr)))
    }

    pub fn sign(&self, payload: &[u8]) -> [u8; 64] {
        self.0.sign(payload).to_bytes()
    }

    pub fn public_hex(&self) -> String {
        hex::encode(self.0.verifying_key().to_bytes())
    }

    pub fn secret_hex(&self) -> String {
        hex::encode(self.0.to_bytes())
    }
}

pub struct VerifyingKey(DalekVerifyingKey);

impl VerifyingKey {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() != 32 {
            return Err("public key must be 32 bytes");
        }
        let mut arr = [0u8; 32];
        arr.copy_from_slice(bytes);
        DalekVerifyingKey::from_bytes(&arr)
            .map(VerifyingKey)
            .map_err(|_| "invalid public key")
    }

    pub fn verify(&self, payload: &[u8], sig: &[u8; 64]) -> Result<(), &'static str> {
        let signature = ed25519_dalek::Signature::from_bytes(sig);
        self.0
            .verify(payload, &signature)
            .map_err(|_| "signature verification failed")
    }
}
