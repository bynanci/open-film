use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;
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
            pick_file,
            pick_files,
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
