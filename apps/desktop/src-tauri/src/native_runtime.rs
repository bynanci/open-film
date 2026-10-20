// Modified by OpenFilm contributors on 2026-10-20. See LICENSE and NOTICE.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RuntimeFile {
    path: String,
    sha256: String,
    size: u64,
    executable: bool,
    component: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    app_version: String,
    node_version: String,
    platform: String,
    architecture: String,
    project_schema: String,
    entries: std::collections::HashMap<String, String>,
    files: Vec<RuntimeFile>,
    components: Vec<Value>,
    updates: Value,
    optional_capabilities: Value,
    distribution: Value,
}
fn hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "runtime.missing")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "runtime.hash")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty()
        || relative.len() > 240
        || relative.contains(['\\', ':'])
        || relative.split('/').any(|part| {
            part.is_empty()
                || part == "."
                || part == ".."
                || part.ends_with(['.', ' '])
                || part.chars().any(char::is_control)
        })
    {
        return Err("runtime.invalid".into());
    }
    let path = Path::new(relative);
    if path
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("runtime.invalid".into());
    }
    let mut current = root.to_path_buf();
    for part in path.components() {
        current.push(part);
        if fs::symlink_metadata(&current)
            .map_err(|_| "runtime.missing")?
            .file_type()
            .is_symlink()
        {
            return Err("runtime.invalid".into());
        }
    }
    Ok(current)
}
fn verified_manifest(reader: impl Read, expected: &str) -> Result<Manifest, String> {
    let mut bytes = Vec::new();
    reader
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "runtime.missing")?;
    if bytes.len() > 8 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != expected {
        return Err("runtime.hash".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "runtime.invalid".into())
}
fn verified_entries(root: &Path, expected: &str) -> Result<(PathBuf, PathBuf), String> {
    if expected == "unconfigured" {
        return Err("runtime.missing".into());
    }
    if fs::symlink_metadata(root)
        .map_err(|_| "runtime.missing")?
        .file_type()
        .is_symlink()
    {
        return Err("runtime.invalid".into());
    }
    let manifest_path = safe_path(root, "runtime-manifest.json")?;
    if fs::metadata(&manifest_path)
        .map_err(|_| "runtime.missing")?
        .len()
        > 8 * 1024 * 1024
    {
        return Err("runtime.hash".into());
    }
    let manifest = verified_manifest(
        fs::File::open(manifest_path).map_err(|_| "runtime.missing")?,
        expected,
    )?;
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    if manifest.schema_version != 1
        || manifest.project_schema != "1.0.0"
        || manifest.app_version != env!("CARGO_PKG_VERSION")
        || manifest.platform != platform
        || manifest.architecture != architecture
        || !manifest.node_version.starts_with("24.")
        || manifest.files.len() > 20000
        || manifest.files.len() < 6
        || manifest.components.is_empty()
        || manifest.updates != json!({"mode":"manual","automatic":false,"signatureRequired":true})
        || manifest.optional_capabilities != json!({"exiftool":false,"whisper":false})
    {
        return Err("runtime.platform".into());
    }
    if !cfg!(debug_assertions) && manifest.distribution["status"] != "reviewed" {
        return Err("runtime.license".into());
    }
    let mut paths = HashSet::new();
    let mut total = 0u64;
    for file in &manifest.files {
        if !paths.insert(file.path.to_lowercase())
            || file.component.is_empty()
            || file.sha256.len() != 64
            || file.size > 1024 * 1024 * 1024
        {
            return Err("runtime.invalid".into());
        }
        total = total.checked_add(file.size).ok_or("runtime.invalid")?;
        if total > 4 * 1024 * 1024 * 1024 {
            return Err("runtime.invalid".into());
        }
        let path = safe_path(root, &file.path)?;
        let metadata = fs::metadata(&path).map_err(|_| "runtime.missing")?;
        if !metadata.is_file() || metadata.len() != file.size || hash(&path)? != file.sha256 {
            return Err("runtime.hash".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o6000 != 0
                || (file.executable && metadata.permissions().mode() & 0o111 == 0)
            {
                return Err("runtime.permissions".into());
            }
        }
        #[cfg(not(unix))]
        let _ = file.executable;
    }
    for key in ["node", "launcher", "service", "ffmpeg", "ffprobe", "font"] {
        if !manifest
            .entries
            .get(key)
            .is_some_and(|path| manifest.files.iter().any(|file| &file.path == path))
        {
            return Err("runtime.invalid".into());
        }
    }
    Ok((
        safe_path(root, &manifest.entries["node"])?,
        safe_path(root, &manifest.entries["launcher"])?,
    ))
}
struct Inner {
    child: Mutex<Option<Child>>,
    status: Arc<Mutex<Value>>,
    operation: Mutex<()>,
    reader_done: Arc<AtomicBool>,
    pub exiting: AtomicBool,
    pending_close: AtomicU64,
    close_sequence: AtomicU64,
}
#[derive(Clone)]
pub struct NativeService(Arc<Inner>);
impl Default for NativeService {
    fn default() -> Self {
        Self(Arc::new(Inner {
            child: Mutex::new(None),
            status: Arc::new(Mutex::new(json!({"state":"starting"}))),
            operation: Mutex::new(()),
            reader_done: Arc::new(AtomicBool::new(true)),
            exiting: AtomicBool::new(false),
            pending_close: AtomicU64::new(0),
            close_sequence: AtomicU64::new(0),
        }))
    }
}
impl NativeService {
    pub fn status(&self) -> Value {
        let mut value = self
            .0
            .status
            .lock()
            .map(|value| value.clone())
            .unwrap_or(json!({"state":"blocked","code":"runtime.preflight"}));
        let request = self.0.pending_close.load(Ordering::SeqCst);
        if request != 0 {
            value["closeRequestId"] = json!(request);
        }
        value
    }
    pub fn request_close(&self) {
        if self.0.pending_close.load(Ordering::SeqCst) == 0 {
            let id = self.0.close_sequence.fetch_add(1, Ordering::SeqCst) + 1;
            let _ =
                self.0
                    .pending_close
                    .compare_exchange(0, id, Ordering::SeqCst, Ordering::SeqCst);
        }
    }
    pub fn acknowledge_close(&self, id: u64) -> Result<(), String> {
        if id == 0
            || self
                .0
                .pending_close
                .compare_exchange(id, 0, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
        {
            return Err("runtime.handshake".into());
        }
        Ok(())
    }
    pub fn exiting(&self) -> bool {
        self.0.exiting.load(Ordering::SeqCst)
    }
    pub fn has_child(&self) -> bool {
        self.0
            .child
            .lock()
            .map(|child| child.is_some())
            .unwrap_or(true)
    }
    pub fn set_exiting(&self) {
        self.0.exiting.store(true, Ordering::SeqCst);
    }
    fn blocked(&self, code: &str) -> Value {
        let value = json!({"state":"blocked","code":code});
        if let Ok(mut status) = self.0.status.lock() {
            *status = value.clone();
        }
        value
    }
    pub fn start(&self, root: PathBuf, data: PathBuf, projects: PathBuf) -> Value {
        let Ok(_guard) = self.0.operation.lock() else {
            return self.blocked("runtime.preflight");
        };
        if let Ok(mut child) = self.0.child.lock() {
            if child
                .as_mut()
                .is_some_and(|owned| matches!(owned.try_wait(), Ok(Some(_))))
            {
                let deadline = Instant::now();
                while !self.0.reader_done.load(Ordering::SeqCst) {
                    if deadline.elapsed() > Duration::from_secs(5) {
                        return self.blocked("runtime.timeout");
                    }
                    std::thread::sleep(Duration::from_millis(10));
                }
                *child = None;
            }
        }
        if self.has_child() {
            if self.status()["state"] == "ready" {
                return self.status();
            }
            if self.stop_inner().is_err() {
                return self.blocked("runtime.closeFailed");
            }
        }
        match self.launch(root, data, projects) {
            Ok(value) => value,
            Err(code) => self.blocked(&code),
        }
    }
    fn launch(&self, root: PathBuf, data: PathBuf, projects: PathBuf) -> Result<Value, String> {
        let expected = option_env!("OPENFILM_RUNTIME_MANIFEST_SHA256").unwrap_or("unconfigured");
        let (node, launcher) = verified_entries(&root, expected)?;
        fs::create_dir_all(&data).map_err(|_| "runtime.storage")?;
        let mut command = Command::new(node);
        command
            .arg(launcher)
            .arg(&root)
            .arg(&data)
            .arg(projects)
            .current_dir(&data)
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for key in [
            "HOME",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "SystemRoot",
            "WINDIR",
            "TEMP",
            "TMP",
            "TMPDIR",
            "LANG",
            "LC_ALL",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|_| "runtime.node")?;
        let stdout = child.stdout.take().ok_or("runtime.handshake")?;
        *self.0.child.lock().map_err(|_| "runtime.preflight")? = Some(child);
        let status = self.0.status.clone();
        let reader_done = self.0.reader_done.clone();
        reader_done.store(false, Ordering::SeqCst);
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                if line.len() > 16384 {
                    break;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if ["ready", "blocked", "closed"]
                        .iter()
                        .any(|state| value["state"] == *state)
                    {
                        if let Ok(mut current) = status.lock() {
                            *current = value.clone();
                        }
                        let _ = sender.send(value);
                    }
                }
            }
            if let Ok(mut current) = status.lock() {
                if current["state"] == "ready" {
                    *current = json!({"state":"blocked","code":"runtime.serviceExited"});
                }
            }
            reader_done.store(true, Ordering::SeqCst);
        });
        receiver
            .recv_timeout(Duration::from_secs(60))
            .map_err(|_| "runtime.timeout".into())
    }
    fn stop_inner(&self) -> Result<(), String> {
        let mut guard = self.0.child.lock().map_err(|_| "runtime.closeFailed")?;
        let Some(child) = guard.as_mut() else {
            return Ok(());
        };
        let already_exited = child
            .try_wait()
            .map_err(|_| "runtime.closeFailed")?
            .is_some();
        if let Some(stdin) = child.stdin.as_mut().filter(|_| !already_exited) {
            let _ = stdin.write_all(b"{\"type\":\"shutdown\"}\n");
            let _ = stdin.flush();
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(45) {
            if let Some(code) = child.try_wait().map_err(|_| "runtime.closeFailed")? {
                if !self.0.reader_done.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                }
                let closed = self.status()["state"] == "closed";
                *guard = None;
                return if already_exited || (code.success() && closed) {
                    Ok(())
                } else {
                    Err("runtime.closeFailed".into())
                };
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        Err("runtime.closeFailed".into())
    }
    pub fn stop(&self) -> Result<(), String> {
        let _guard = self.0.operation.lock().map_err(|_| "runtime.closeFailed")?;
        let result = self.stop_inner();
        if result.is_err() {
            self.blocked("runtime.closeFailed");
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_verification_parses_the_hashed_bytes_after_a_file_replacement() {
        struct ReplaceAtEof {
            source: fs::File,
            path: PathBuf,
            replacement: Vec<u8>,
        }
        impl Read for ReplaceAtEof {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                let count = self.source.read(output)?;
                if count == 0 {
                    fs::write(&self.path, &self.replacement)?;
                }
                Ok(count)
            }
        }
        let value = json!({"schemaVersion":1,"appVersion":env!("CARGO_PKG_VERSION"),"nodeVersion":"24.14.0","platform":"linux","architecture":"x64","projectSchema":"1.0.0","entries":{},"files":[],"components":[],"updates":{},"optionalCapabilities":{},"distribution":{}});
        let original = serde_json::to_vec(&value).unwrap();
        let mut replacement = value.clone();
        replacement["appVersion"] = json!("99.0.0");
        let replacement = serde_json::to_vec(&replacement).unwrap();
        let expected = format!("{:x}", Sha256::digest(&original));
        let path = std::env::temp_dir().join(format!(
            "openfilm-manifest-race-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, original).unwrap();
        let reader = ReplaceAtEof {
            source: fs::File::open(&path).unwrap(),
            path: path.clone(),
            replacement: replacement.clone(),
        };
        let parsed = verified_manifest(reader, &expected).unwrap();
        assert_eq!(parsed.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(fs::read(&path).unwrap(), replacement);
        assert_eq!(
            verified_manifest(fs::File::open(&path).unwrap(), &expected)
                .err()
                .unwrap(),
            "runtime.hash"
        );
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn manifest_reader_bounds_the_actual_bytes_even_if_the_file_grows() {
        let bytes = vec![b' '; 8 * 1024 * 1024 + 1];
        let expected = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(
            verified_manifest(std::io::Cursor::new(bytes), &expected)
                .err()
                .unwrap(),
            "runtime.hash"
        );
    }
    #[test]
    fn rejects_unconfigured_runtime_before_execution() {
        assert!(verified_entries(Path::new("/missing"), "unconfigured").is_err());
    }
    #[test]
    fn rejects_path_escapes() {
        for path in ["../node", "/node", "C:/node", "bin\\node", "bin//node"] {
            assert!(safe_path(Path::new("/missing"), path).is_err());
        }
    }
    #[test]
    fn close_requests_reject_stale_acknowledgements() {
        let service = NativeService::default();
        service.request_close();
        let first = service.status()["closeRequestId"].as_u64().unwrap();
        service.acknowledge_close(first).unwrap();
        service.request_close();
        let second = service.status()["closeRequestId"].as_u64().unwrap();
        assert!(second > first);
        assert!(service.acknowledge_close(first).is_err());
        assert!(service.acknowledge_close(second).is_ok());
    }
    #[cfg(unix)]
    #[test]
    fn close_waits_for_delayed_stdout_ack_after_process_exit() {
        let service = NativeService::default();
        let child = Command::new("/bin/sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        *service.0.child.lock().unwrap() = Some(child);
        service.0.reader_done.store(false, Ordering::SeqCst);
        let reader = service.clone();
        let thread = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            *reader.0.status.lock().unwrap() = json!({"state":"closed"});
            reader.0.reader_done.store(true, Ordering::SeqCst);
        });
        assert!(service.stop().is_ok());
        thread.join().unwrap();
        assert!(!service.has_child());
    }
    #[test]
    fn stopping_without_owned_child_is_safe() {
        let service = NativeService::default();
        assert!(service.stop().is_ok());
        assert!(!service.has_child());
    }
    #[cfg(unix)]
    #[test]
    fn stopping_an_already_dead_child_does_not_require_a_new_ack() {
        let service = NativeService::default();
        let mut child = Command::new("/bin/sh")
            .args(["-c", "exit 7"])
            .spawn()
            .unwrap();
        child.wait().unwrap();
        *service.0.child.lock().unwrap() = Some(child);
        *service.0.status.lock().unwrap() =
            json!({"state":"blocked","code":"runtime.serviceExited"});
        assert!(service.stop().is_ok());
        assert!(!service.has_child());
    }
    #[cfg(unix)]
    #[test]
    fn live_shutdown_still_requires_the_matching_acknowledgement() {
        let service = NativeService::default();
        let child = Command::new("/bin/sh")
            .args(["-c", "read line; exit 7"])
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        *service.0.child.lock().unwrap() = Some(child);
        assert!(service.stop().is_err());
        assert!(!service.has_child());
    }
}
