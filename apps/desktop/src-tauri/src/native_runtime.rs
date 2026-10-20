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
fn hash(path: &Path, cancelled: &impl Fn() -> bool) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|_| "runtime.missing")?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        if cancelled() {
            return Err("runtime.preflight".into());
        }
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
fn verified_entries(
    root: &Path,
    expected: &str,
    cancelled: impl Fn() -> bool,
) -> Result<(PathBuf, PathBuf), String> {
    if cancelled() {
        return Err("runtime.preflight".into());
    }
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
        if !metadata.is_file()
            || metadata.len() != file.size
            || hash(&path, &cancelled)? != file.sha256
        {
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
    startup_epoch: Arc<AtomicU64>,
    stopping: AtomicBool,
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
            startup_epoch: Arc::new(AtomicU64::new(0)),
            stopping: AtomicBool::new(false),
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
        let expected = option_env!("OPENFILM_RUNTIME_MANIFEST_SHA256").unwrap_or("unconfigured");
        self.start_verified(root, data, projects, expected)
    }
    fn start_verified(
        &self,
        root: PathBuf,
        data: PathBuf,
        projects: PathBuf,
        expected: &str,
    ) -> Value {
        // Capture before waiting for another start. A close cancels this exact
        // attempt even if a later failed stop permits a fresh explicit Retry.
        let epoch = self.0.startup_epoch.load(Ordering::SeqCst);
        let Ok(_guard) = self.0.operation.lock() else {
            return self.blocked("runtime.preflight");
        };
        if self.cancelled(epoch) {
            return self.status();
        }
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
        let result = self.launch(root, data, projects, expected, epoch);
        if self.cancelled(epoch) {
            return self.status();
        }
        match result {
            Ok(value) => value,
            Err(code) => self.blocked(&code),
        }
    }
    fn cancelled(&self, epoch: u64) -> bool {
        self.0.stopping.load(Ordering::SeqCst)
            || self.exiting()
            || self.0.startup_epoch.load(Ordering::SeqCst) != epoch
    }
    fn launch(
        &self,
        root: PathBuf,
        data: PathBuf,
        projects: PathBuf,
        expected: &str,
        epoch: u64,
    ) -> Result<Value, String> {
        let (node, launcher) = verified_entries(&root, expected, || self.cancelled(epoch))?;
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
        // The cancellation check and publication of the spawned child share
        // the same lock used by close; no late start can escape a completed stop.
        let mut owned = self.0.child.lock().map_err(|_| "runtime.preflight")?;
        if self.cancelled(epoch) {
            return Err("runtime.preflight".into());
        }
        let mut child = command.spawn().map_err(|_| "runtime.node")?;
        let stdout = child.stdout.take().ok_or("runtime.handshake")?;
        *owned = Some(child);
        let status = self.0.status.clone();
        let reader_done = self.0.reader_done.clone();
        reader_done.store(false, Ordering::SeqCst);
        let startup_epoch = self.0.startup_epoch.clone();
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
                            // This reader still owns the child until reader_done
                            // permits replacement. Its terminal close evidence
                            // survives attempt cancellation; late ready does not.
                            if startup_epoch.load(Ordering::SeqCst) == epoch
                                || value["state"] == "closed"
                                || (value["state"] == "blocked"
                                    && value["code"] == "runtime.closeFailed")
                            {
                                *current = value.clone();
                            }
                        }
                        let _ = sender.send(value);
                    }
                }
            }
            if let Ok(mut current) = status.lock() {
                if startup_epoch.load(Ordering::SeqCst) == epoch && current["state"] == "ready" {
                    *current = json!({"state":"blocked","code":"runtime.serviceExited"});
                }
            }
            reader_done.store(true, Ordering::SeqCst);
        });
        drop(owned);
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
        // Close must reach the owner channel during hashing/readiness waits.
        // A successful final close remains terminal until the shell exits.
        self.0.stopping.store(true, Ordering::SeqCst);
        self.0.startup_epoch.fetch_add(1, Ordering::SeqCst);
        let result = self.stop_inner();
        if result.is_err() {
            self.blocked("runtime.closeFailed");
            self.0.stopping.store(false, Ordering::SeqCst);
        } else if let Ok(mut status) = self.0.status.lock() {
            *status = json!({"state":"closed"});
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
        assert!(verified_entries(Path::new("/missing"), "unconfigured", || false).is_err());
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
    fn close_reaches_a_real_starting_child_without_waiting_for_the_start_operation() {
        let service = NativeService::default();
        let mut child = Command::new("/bin/sh")
            .args([
                "-c",
                "read request; printf '%s\\n' '{\"state\":\"closed\"}'; exit 0",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        *service.0.child.lock().unwrap() = Some(child);
        service.0.reader_done.store(false, Ordering::SeqCst);
        let observed = service.clone();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                *observed.0.status.lock().unwrap() = serde_json::from_str(&line).unwrap();
            }
            observed.0.reader_done.store(true, Ordering::SeqCst);
        });
        // Startup owns this mutex through verification and its readiness wait.
        let operation = service.0.operation.lock().unwrap();
        let closing = service.clone();
        let (sender, receiver) = mpsc::channel();
        let close = std::thread::spawn(move || {
            sender.send(closing.stop()).unwrap();
        });
        let immediate = receiver.recv_timeout(Duration::from_secs(1));
        let cancelled_before_start_returned = immediate.is_ok();
        drop(operation);
        let result =
            immediate.unwrap_or_else(|_| receiver.recv_timeout(Duration::from_secs(3)).unwrap());
        close.join().unwrap();
        reader.join().unwrap();
        assert!(result.is_ok());
        assert!(
            cancelled_before_start_returned,
            "close waited behind the startup operation mutex"
        );
        assert!(!service.has_child());
    }
    #[cfg(unix)]
    fn verified_shell_fixture(script: &str) -> (PathBuf, PathBuf, String) {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "openfilm-start-cancel-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let data = root.join("data");
        fs::create_dir_all(&data).unwrap();
        fs::copy("/bin/sh", root.join("node")).unwrap();
        fs::set_permissions(root.join("node"), fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(root.join("launcher.sh"), script).unwrap();
        for name in ["service.js", "ffmpeg", "ffprobe", "font.ttf"] {
            fs::write(root.join(name), b"Synthetic process fixture only").unwrap();
        }
        let entries = json!({"node":"node","launcher":"launcher.sh","service":"service.js","ffmpeg":"ffmpeg","ffprobe":"ffprobe","font":"font.ttf"});
        let files: Vec<Value> = entries.as_object().unwrap().values().map(|path| {
            let name = path.as_str().unwrap();
            let bytes = fs::read(root.join(name)).unwrap();
            json!({"path":name,"sha256":format!("{:x}",Sha256::digest(&bytes)),"size":bytes.len(),"executable":name=="node","component":"synthetic-test-only"})
        }).collect();
        let manifest = serde_json::to_vec(&json!({"schemaVersion":1,"appVersion":env!("CARGO_PKG_VERSION"),"nodeVersion":"24.14.0","platform":std::env::consts::OS.replace("macos","darwin"),"architecture":std::env::consts::ARCH.replace("x86_64","x64").replace("aarch64","arm64"),"projectSchema":"1.0.0","entries":entries,"files":files,"components":[{"id":"synthetic-test-only"}],"updates":{"mode":"manual","automatic":false,"signatureRequired":true},"optionalCapabilities":{"exiftool":false,"whisper":false},"distribution":{"status":"test-only"}})).unwrap();
        let expected = format!("{:x}", Sha256::digest(&manifest));
        fs::write(root.join("runtime-manifest.json"), manifest).unwrap();
        (root, data, expected)
    }
    #[cfg(unix)]
    #[test]
    fn cancels_a_verified_pending_launcher_and_rejects_its_late_ready_message() {
        let (root, data, expected) = verified_shell_fixture("printf pending > \"$2/pending\"\nread request\nprintf '%s\\n' '{\"state\":\"ready\",\"port\":1}' '{\"state\":\"closed\"}'\n");
        let service = NativeService::default();
        let starting = service.clone();
        let start_root = root.clone();
        let start_data = data.clone();
        let start = std::thread::spawn(move || {
            starting.start_verified(
                start_root,
                start_data.clone(),
                start_data.join("projects"),
                &expected,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        while !data.join("pending").exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            data.join("pending").exists(),
            "verified launcher did not reach its real pending wait"
        );
        let closing = service.clone();
        let (sender, receiver) = mpsc::channel();
        let close = std::thread::spawn(move || {
            sender.send(closing.stop()).unwrap();
        });
        let prompt = receiver.recv_timeout(Duration::from_secs(2));
        if prompt.is_err() {
            // Failure cleanup only; never let a RED cancellation test hang60s.
            if let Some(child) = service.0.child.lock().unwrap().as_mut() {
                child
                    .stdin
                    .as_mut()
                    .unwrap()
                    .write_all(b"{\"type\":\"shutdown\"}\n")
                    .unwrap();
            }
        }
        let result = start.join().unwrap();
        close.join().unwrap();
        assert!(prompt.is_ok(), "close waited behind pending startup");
        assert!(prompt.unwrap().is_ok());
        assert_ne!(result["state"], "ready");
        assert_eq!(service.status()["state"], "closed");
        assert!(!service.has_child());
        assert_eq!(
            service.start(root.clone(), data.clone(), data.join("projects"))["state"],
            "closed"
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_interrupts_runtime_hash_reads() {
        let cancelled = std::cell::Cell::new(0);
        let path =
            std::env::temp_dir().join(format!("openfilm-cancel-hash-{}", std::process::id()));
        fs::write(&path, vec![0u8; 3 * 65536]).unwrap();
        let result = hash(&path, &|| {
            cancelled.set(cancelled.get() + 1);
            cancelled.get() == 2
        });
        fs::remove_file(path).unwrap();
        assert_eq!(cancelled.get(), 2);
        assert_eq!(result.unwrap_err(), "runtime.preflight");
    }
    #[cfg(unix)]
    #[test]
    fn one_retry_consumes_the_owned_terminal_ack_after_a_failed_stop_epoch() {
        let (root, data, expected) = verified_shell_fixture("printf '%s\\n' '{\"state\":\"ready\",\"port\":1}'\nread request\nprintf '%s\\n' '{\"state\":\"closed\"}'\n");
        let service = NativeService::default();
        assert_eq!(
            service.start_verified(root.clone(), data.clone(), data.join("projects"), &expected)
                ["state"],
            "ready"
        );
        // Reproduce the exact metadata of a timed-out failed close while the
        // verified child/reader remains owned, without waiting45s in this test.
        service.0.startup_epoch.fetch_add(1, Ordering::SeqCst);
        service.blocked("runtime.closeFailed");
        assert!(!service.0.stopping.load(Ordering::SeqCst));
        // Retry sends real shutdown, consumes the old owner's real closed/exit
        // and starts the replacement on this first call.
        assert_eq!(
            service.start_verified(root.clone(), data.clone(), data.join("projects"), &expected)
                ["state"],
            "ready"
        );
        assert!(service.has_child());
        assert!(service.stop().is_ok());
        assert!(!service.has_child());
        fs::remove_dir_all(root).unwrap();
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
