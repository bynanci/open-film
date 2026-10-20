use sha2::{Digest, Sha256};
fn main() {
    let manifest = std::path::Path::new("resources/runtime/runtime-manifest.json");
    println!("cargo:rerun-if-changed=resources/runtime");
    let digest = std::fs::read(manifest)
        .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
        .unwrap_or_else(|_| "unconfigured".into());
    println!("cargo:rustc-env=OPENFILM_RUNTIME_MANIFEST_SHA256={digest}");
    tauri_build::build();
}
