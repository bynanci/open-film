use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
use serde::Serialize;
use std::path::Path;
mod native_benchmark;
mod native_runtime;
use native_benchmark::{CheckpointKind, NativeBenchmark};
use native_runtime::NativeService;

fn benchmark_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| "Native window URL is unavailable")?;
    if native_benchmark::local_main_window(window.label(), url.scheme(), url.host_str(), url.port())
    {
        Ok(())
    } else {
        Err("Native benchmark is restricted to the local main window".into())
    }
}

#[tauri::command]
fn native_benchmark_enabled(
    window: tauri::WebviewWindow,
    benchmark: tauri::State<'_, NativeBenchmark>,
) -> Result<bool, String> {
    benchmark_window(&window)?;
    Ok(benchmark.enabled())
}

#[tauri::command]
fn native_checkpoint(
    window: tauri::WebviewWindow,
    benchmark: tauri::State<'_, NativeBenchmark>,
    kind: CheckpointKind,
    clip_count: Option<u32>,
    client_elapsed_ms: f64,
    client_time_origin_ms: f64,
) -> Result<(), String> {
    benchmark_window(&window)?;
    benchmark.record(kind, clip_count, client_elapsed_ms, client_time_origin_ms)
}

// Native commands are limited to desktop integration. The loopback application
// service owns project/catalog/media operations and never runs shell strings.
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .map(|folder| {
                folder
                    .into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_folders(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folders()
            .unwrap_or_default()
            .into_iter()
            .map(|folder| {
                folder
                    .into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn native_runtime_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: tauri::State<'_, NativeService>,
) -> Result<serde_json::Value, String> {
    benchmark_window(&window)?;
    if cfg!(debug_assertions)
        && option_env!("OPENFILM_RUNTIME_MANIFEST_SHA256").unwrap_or("unconfigured")
            == "unconfigured"
    {
        return Ok(serde_json::json!({"state":"development"}));
    }
    let root = app
        .path()
        .resource_dir()
        .map_err(|_| "runtime.missing")?
        .join("runtime");
    let data = app.path().app_data_dir().map_err(|_| "runtime.storage")?;
    let projects = app
        .path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|_| "runtime.storage")?
        .join("OpenFilm");
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.start(root, data, projects))
        .await
        .map_err(|_| "runtime.preflight".into())
}
#[tauri::command]
fn native_runtime_status(
    window: tauri::WebviewWindow,
    service: tauri::State<'_, NativeService>,
) -> Result<serde_json::Value, String> {
    benchmark_window(&window)?;
    Ok(service.status())
}

#[tauri::command]
async fn native_runtime_close(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    service: tauri::State<'_, NativeService>,
    request_id: u64,
    cancel: bool,
) -> Result<(), String> {
    benchmark_window(&window)?;
    service.acknowledge_close(request_id)?;
    if cancel {
        return Ok(());
    }
    let service = service.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.stop()?;
        service.set_exiting();
        app.exit(0);
        Ok(())
    })
    .await
    .map_err(|_| "runtime.closeFailed".to_string())?
}

#[tauri::command]
async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_file()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn pick_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| {
                file.into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

const MAX_DROPPED_PATHS: usize = 10_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum DroppedPathKind {
    File,
    Folder,
    Symlink,
    Unsupported,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedPath {
    path: String,
    kind: DroppedPathKind,
}

fn classify_dropped_path(path: String) -> DroppedPath {
    let kind = match std::fs::symlink_metadata(Path::new(&path)) {
        Ok(metadata) if metadata.file_type().is_symlink() => DroppedPathKind::Symlink,
        Ok(metadata) if metadata.is_file() => DroppedPathKind::File,
        Ok(metadata) if metadata.is_dir() => DroppedPathKind::Folder,
        Ok(_) => DroppedPathKind::Unsupported,
        Err(_) => DroppedPathKind::Unreadable,
    };
    DroppedPath { path, kind }
}

fn classify_dropped_paths_sync(paths: Vec<String>) -> Result<Vec<DroppedPath>, String> {
    if paths.len() > MAX_DROPPED_PATHS {
        return Err(format!(
            "A drop may contain at most {MAX_DROPPED_PATHS} paths"
        ));
    }
    Ok(paths.into_iter().map(classify_dropped_path).collect())
}

#[tauri::command]
async fn classify_dropped_paths(paths: Vec<String>) -> Result<Vec<DroppedPath>, String> {
    tauri::async_runtime::spawn_blocking(move || classify_dropped_paths_sync(paths))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let origin = std::time::Instant::now();
    let benchmark = NativeBenchmark::from_env(origin).unwrap_or_else(|error| {
        eprintln!("Native benchmark disabled: {error}");
        NativeBenchmark::disabled(origin)
    });
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let service = window.state::<NativeService>();
                if !service.exiting() {
                    api.prevent_close();
                    service.request_close();
                }
            }
        })
        .manage(benchmark)
        .manage(NativeService::default())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            pick_folders,
            pick_file,
            pick_files,
            classify_dropped_paths,
            native_benchmark_enabled,
            native_checkpoint,
            native_runtime_start,
            native_runtime_status,
            native_runtime_close
        ])
        .build(tauri::generate_context!())
        .expect("Could not initialize the OpenFilm desktop shell");

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let service = handle.state::<NativeService>();
            if !service.exiting() {
                api.prevent_exit();
                service.request_close();
            }
        }
    });
}

#[cfg(test)]
mod source_picker_tests {
    use super::*;
    use std::fs::{create_dir, remove_dir_all, write};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "openfilm-source-picker-{}-{nonce}",
            std::process::id()
        ));
        create_dir(&root).expect("create fixture");
        root
    }

    #[test]
    fn classifies_files_folders_and_missing_paths_without_following_links() {
        let root = fixture();
        let folder = root.join("folder");
        let file = root.join("memory.mp4");
        create_dir(&folder).expect("create folder");
        write(&file, b"synthetic").expect("create file");
        let found = classify_dropped_paths_sync(vec![
            file.to_string_lossy().into_owned(),
            folder.to_string_lossy().into_owned(),
            root.join("missing").to_string_lossy().into_owned(),
        ])
        .expect("classify");
        assert_eq!(found[0].kind, DroppedPathKind::File);
        assert_eq!(found[1].kind, DroppedPathKind::Folder);
        assert_eq!(found[2].kind, DroppedPathKind::Unreadable);
        remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn rejects_an_unbounded_drop_before_touching_the_filesystem() {
        let paths = vec![String::from("missing"); MAX_DROPPED_PATHS + 1];
        assert!(classify_dropped_paths_sync(paths).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_symlink_instead_of_following_it() {
        use std::os::unix::fs::symlink;
        let root = fixture();
        let target = root.join("target");
        let link = root.join("link");
        create_dir(&target).expect("create target");
        symlink(&target, &link).expect("create link");
        assert_eq!(
            classify_dropped_path(link.to_string_lossy().into_owned()).kind,
            DroppedPathKind::Symlink
        );
        remove_dir_all(root).expect("remove fixture");
    }
}
