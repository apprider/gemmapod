//! End-to-end test of the manifest sign/verify/tamper round-trip in native
//! Rust. The WASM bindings are a thin wrapper around this same code, so
//! passing here gives us high confidence the in-browser flow is correct.

use gemmapod_core::testing::{
    generate_key, sign, sign_bytes, verify, verify_bytes, Manifest, TransportSpec,
};

#[test]
fn sign_verify_roundtrip() {
    let (pk, sk) = generate_key();
    let manifest = Manifest {
        v: 1,
        id: "raj-card".into(),
        name: "raj-card".into(),
        persona: "test".into(),
        system_prompt: "be terse".into(),
        model: None,
        owner_pubkey: pk.clone(),
        transport: TransportSpec::default(),
        tools: vec![],
    };
    let bytes = sign(manifest.clone(), &sk).expect("sign");
    let recovered = verify(&bytes).expect("verify");
    assert_eq!(recovered.id, manifest.id);
    assert_eq!(recovered.owner_pubkey, pk);
}

#[test]
fn tampered_payload_rejected() {
    let (pk, sk) = generate_key();
    let manifest = Manifest {
        v: 1,
        id: "x".into(),
        name: "x".into(),
        persona: "x".into(),
        system_prompt: "x".into(),
        model: None,
        owner_pubkey: pk,
        transport: TransportSpec::default(),
        tools: vec![],
    };
    let mut bytes = sign(manifest, &sk).expect("sign");
    let idx = bytes.len() * 6 / 10;
    bytes[idx] ^= 0xff;
    assert!(
        verify(&bytes).is_err(),
        "verify must reject tampered manifest"
    );
}

#[test]
fn wrong_pubkey_rejected() {
    let (_pk1, sk1) = generate_key();
    let (pk2, _sk2) = generate_key();
    let manifest = Manifest {
        v: 1,
        id: "x".into(),
        name: "x".into(),
        persona: "x".into(),
        system_prompt: "x".into(),
        model: None,
        // Claim pk2 owns this, but sign with sk1 → verification anchored to
        // pk2 must reject the sk1-produced signature.
        owner_pubkey: pk2,
        transport: TransportSpec::default(),
        tools: vec![],
    };
    let bytes = sign(manifest, &sk1).expect("sign");
    assert!(verify(&bytes).is_err());
}

#[test]
fn arbitrary_bytes_can_be_signed_for_dartc() {
    let (pk, sk) = generate_key();
    let payload = br#"{"from":"alice","msg_id":"msg-1","topic":"dartc.hello"}"#;
    let sig = sign_bytes(payload, &sk).expect("sign bytes");

    verify_bytes(payload, &sig, &pk).expect("verify bytes");

    let mut tampered = payload.to_vec();
    tampered[10] ^= 0x01;
    assert!(verify_bytes(&tampered, &sig, &pk).is_err());
}
