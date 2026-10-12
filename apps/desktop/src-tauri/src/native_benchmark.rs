use std::{
    ffi::OsString,
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CheckpointKind {
    WelcomeReady,
    LibraryReady,
    EditEnter,
    EditReady,
    EditLeave,
}

struct Configuration {
    run_id: String,
    file: Mutex<File>,
}

pub struct NativeBenchmark {
    origin: Instant,
    configuration: Option<Configuration>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Checkpoint<'a> {
    run_id: &'a str,
    pid: u32,
    kind: CheckpointKind,
    native_elapsed_ms: f64,
    unix_ms: u64,
    client_elapsed_ms: f64,
    client_time_origin_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    clip_count: Option<u32>,
}

impl NativeBenchmark {
    pub fn disabled(origin: Instant) -> Self {
        Self {
            origin,
            configuration: None,
        }
    }

    pub fn from_env(origin: Instant) -> Result<Self, String> {
        let run_id = std::env::var_os("OPENFILM_NATIVE_BENCHMARK_RUN_ID")
            .map(|value| value.into_string())
            .transpose()
            .map_err(|_| "Native benchmark run ID must be ASCII".to_string())?;
        Self::configured(
            origin,
            std::env::var_os("OPENFILM_NATIVE_BENCHMARK_EVENTS"),
            run_id,
        )
    }

    fn configured(
        origin: Instant,
        path: Option<OsString>,
        run_id: Option<String>,
    ) -> Result<Self, String> {
        let (path, run_id) = match (path, run_id) {
            (None, None) => return Ok(Self::disabled(origin)),
            (Some(path), Some(run_id)) => (path, run_id),
            _ => return Err("Native benchmark needs both event file and run ID".into()),
        };
        if run_id.is_empty()
            || run_id.len() > 80
            || !run_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(
                "Native benchmark run ID must use 1-80 ASCII letters, numbers, _ or -".into(),
            );
        }
        let path = PathBuf::from(path);
        if !path.is_absolute() {
            return Err("Native benchmark event path must be absolute".into());
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|_| "Native benchmark event file must already exist".to_string())?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("Native benchmark event file must be a regular non-symlink file".into());
        }
        let file = OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|_| "Native benchmark event file cannot be opened".to_string())?;
        let opened = file
            .metadata()
            .map_err(|_| "Native benchmark event file metadata is unavailable".to_string())?;
        if !opened.is_file() {
            return Err("Native benchmark event file must be regular".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.dev() != opened.dev() || metadata.ino() != opened.ino() {
                return Err("Native benchmark event file changed while opening".into());
            }
        }
        Ok(Self {
            origin,
            configuration: Some(Configuration {
                run_id,
                file: Mutex::new(file),
            }),
        })
    }

    pub fn enabled(&self) -> bool {
        self.configuration.is_some()
    }

    pub fn record(
        &self,
        kind: CheckpointKind,
        clip_count: Option<u32>,
        client_elapsed_ms: f64,
        client_time_origin_ms: f64,
    ) -> Result<(), String> {
        let Some(configuration) = &self.configuration else {
            return Ok(());
        };
        if !client_elapsed_ms.is_finite()
            || client_elapsed_ms < 0.0
            || !client_time_origin_ms.is_finite()
            || client_time_origin_ms <= 0.0
        {
            return Err(
                "Native benchmark client clocks must be finite with a positive origin".into(),
            );
        }
        if clip_count.is_some_and(|count| count > 1_000_000) {
            return Err("Native benchmark clip count exceeds the recording limit".into());
        }
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| "System clock precedes Unix epoch".to_string())?
            .as_millis() as u64;
        let event = Checkpoint {
            run_id: &configuration.run_id,
            pid: std::process::id(),
            kind,
            native_elapsed_ms: self.origin.elapsed().as_secs_f64() * 1000.0,
            unix_ms,
            client_elapsed_ms,
            client_time_origin_ms,
            clip_count,
        };
        let mut bytes = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        configuration
            .file
            .lock()
            .map_err(|_| "Native benchmark event lock is unavailable".to_string())?
            .write_all(&bytes)
            .map_err(|_| "Native benchmark event file write failed".to_string())
    }
}

pub fn local_main_window(label: &str, scheme: &str, host: Option<&str>, port: Option<u16>) -> bool {
    label == "main"
        && ((scheme == "tauri" && host == Some("localhost"))
            || ((scheme == "http" || scheme == "https") && host == Some("tauri.localhost"))
            || (scheme == "http"
                && matches!(host, Some("127.0.0.1" | "localhost"))
                && port == Some(1420)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "openfilm-native-checkpoint-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self) -> PathBuf {
            self.0.join("events.jsonl")
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn no_configuration_is_disabled_and_creates_no_file() {
        let directory = Directory::new();
        let benchmark = NativeBenchmark::configured(Instant::now(), None, None).unwrap();
        assert!(!benchmark.enabled());
        benchmark
            .record(CheckpointKind::WelcomeReady, None, 1.0, 1_000.0)
            .unwrap();
        assert!(!directory.file().exists());
    }

    #[test]
    fn rejects_partial_relative_missing_directory_and_invalid_run_ids() {
        let directory = Directory::new();
        let path = directory.file();
        fs::write(&path, b"preserved\n").unwrap();
        for (file, id) in [
            (Some(path.clone().into_os_string()), None),
            (None, Some("run".into())),
            (Some(OsString::from("relative.jsonl")), Some("run".into())),
            (
                Some(directory.0.join("missing.jsonl").into_os_string()),
                Some("run".into()),
            ),
            (
                Some(directory.0.clone().into_os_string()),
                Some("run".into()),
            ),
            (
                Some(path.clone().into_os_string()),
                Some("../foreign".into()),
            ),
            (Some(path.clone().into_os_string()), Some("".into())),
            (Some(path.clone().into_os_string()), Some("青森".into())),
            (Some(path.clone().into_os_string()), Some("a".repeat(81))),
        ] {
            assert!(NativeBenchmark::configured(Instant::now(), file, id).is_err());
        }
        assert_eq!(fs::read(&path).unwrap(), b"preserved\n");
        assert!(!directory.0.join("missing.jsonl").exists());
    }

    #[test]
    fn append_records_only_fixed_checkpoint_fields_and_native_clock() {
        let directory = Directory::new();
        let path = directory.file();
        fs::write(&path, b"").unwrap();
        let benchmark = NativeBenchmark::configured(
            Instant::now(),
            Some(path.clone().into_os_string()),
            Some("run_1-abc".into()),
        )
        .unwrap();
        assert!(benchmark.enabled());
        benchmark
            .record(CheckpointKind::EditEnter, Some(500), 1.0, 1_000.0)
            .unwrap();
        benchmark
            .record(CheckpointKind::EditReady, Some(500), 90.0, 1_000.0)
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        let events: Vec<serde_json::Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0]["kind"], "edit-enter");
        assert_eq!(events[1]["kind"], "edit-ready");
        assert_eq!(events[1]["clipCount"], 500);
        assert_eq!(events[1]["runId"], "run_1-abc");
        assert_eq!(events[1]["pid"], std::process::id());
        assert_eq!(events[0]["clientElapsedMs"], 1.0);
        assert_eq!(events[1]["clientElapsedMs"], 90.0);
        assert_eq!(events[1]["clientTimeOriginMs"], 1_000.0);
        assert!(events[1]["unixMs"].as_u64().unwrap() > 0);
        assert!(
            events[1]["nativeElapsedMs"].as_f64().unwrap()
                >= events[0]["nativeElapsedMs"].as_f64().unwrap()
        );
        assert_eq!(events[1].as_object().unwrap().len(), 8);
    }

    #[test]
    fn invalid_clip_count_does_not_append() {
        let directory = Directory::new();
        let path = directory.file();
        fs::write(&path, b"").unwrap();
        let benchmark = NativeBenchmark::configured(
            Instant::now(),
            Some(path.clone().into_os_string()),
            Some("run".into()),
        )
        .unwrap();
        assert!(benchmark
            .record(CheckpointKind::EditReady, Some(1_000_001), 1.0, 1_000.0)
            .is_err());
        assert!(fs::read(path).unwrap().is_empty());
    }

    #[test]
    fn invalid_client_clocks_do_not_append() {
        let directory = Directory::new();
        let path = directory.file();
        fs::write(&path, b"").unwrap();
        let benchmark = NativeBenchmark::configured(
            Instant::now(),
            Some(path.clone().into_os_string()),
            Some("run".into()),
        )
        .unwrap();
        for (elapsed, origin) in [
            (f64::NAN, 1_000.0),
            (f64::INFINITY, 1_000.0),
            (-1.0, 1_000.0),
            (1.0, f64::NAN),
            (1.0, f64::INFINITY),
            (1.0, 0.0),
            (1.0, -1.0),
        ] {
            assert!(benchmark
                .record(CheckpointKind::EditReady, Some(500), elapsed, origin)
                .is_err());
        }
        assert!(fs::read(path).unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_symlink_targets() {
        let directory = Directory::new();
        let path = directory.file();
        let target = directory.0.join("target.jsonl");
        fs::write(&target, b"untouched").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert!(NativeBenchmark::configured(
            Instant::now(),
            Some(path.into_os_string()),
            Some("run".into()),
        )
        .is_err());
        assert_eq!(fs::read(target).unwrap(), b"untouched");
    }

    #[test]
    fn only_local_main_window_may_access_diagnostics() {
        assert!(local_main_window("main", "tauri", Some("localhost"), None));
        assert!(local_main_window(
            "main",
            "http",
            Some("tauri.localhost"),
            None
        ));
        assert!(local_main_window(
            "main",
            "https",
            Some("tauri.localhost"),
            None
        ));
        assert!(local_main_window(
            "main",
            "http",
            Some("127.0.0.1"),
            Some(1420)
        ));
        assert!(!local_main_window(
            "foreign",
            "tauri",
            Some("localhost"),
            None
        ));
        assert!(!local_main_window(
            "main",
            "https",
            Some("example.com"),
            None
        ));
        assert!(!local_main_window(
            "main",
            "http",
            Some("127.0.0.1"),
            Some(4310)
        ));
    }
}
