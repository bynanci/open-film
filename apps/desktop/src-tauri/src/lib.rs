use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog::DialogExt;

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

struct LocalService(Mutex<Option<Child>>);

fn configured_service() -> Result<Option<Child>, String> {
    let Some(script) = std::env::var_os("OPENFILM_SERVER_PATH") else {
        // Development starts the server through `pnpm dev`; an already-running
        // loopback service is also supported. Packaging must configure a verified
        // local Node runtime and bundled server rather than assume Node is present.
        return Ok(None);
    };
    let script = PathBuf::from(script);
    if !script.is_absolute() || !script.is_file() {
        return Err("OPENFILM_SERVER_PATH must point to an existing absolute server script".into());
    }
    let executable = std::env::var_os("OPENFILM_NODE_PATH")
        .map(PathBuf::from)
        .ok_or("OPENFILM_NODE_PATH must name the absolute Node executable")?;
    if !executable.is_absolute() || !executable.is_file() {
        return Err("OPENFILM_NODE_PATH must point to an existing absolute Node executable".into());
    }
    Command::new(executable)
        .arg(script)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map(Some)
        .map_err(|error| format!("Could not start OpenFilm's local service: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![pick_folder])
        .setup(|app| {
            let child = configured_service().map_err(std::io::Error::other)?;
            app.manage(LocalService(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not initialize the OpenFilm desktop shell");

    app.run(|handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(service) = handle.try_state::<LocalService>() {
                if let Ok(mut guard) = service.0.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }
    });
}
