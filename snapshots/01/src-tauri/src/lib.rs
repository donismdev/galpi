//! galpi Rust core. Owns per-device settings today; the work-folder, save, commit,
//! watch and search paths are added from session 02 onward.

pub mod settings;

use settings::{AppSettings, UiLanguage};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

/// Serialises settings read-modify-write across windows.
struct SettingsLock(Mutex<()>);

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| settings::settings_path(&dir))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> Result<AppSettings, String> {
    Ok(settings::load(&settings_file(&app)?))
}

#[tauri::command]
fn set_ui_language(
    app: tauri::AppHandle,
    lock: tauri::State<'_, SettingsLock>,
    language: UiLanguage,
) -> Result<AppSettings, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    let path = settings_file(&app)?;
    let mut current = settings::load(&path);
    current.ui_language = language;
    settings::save(&path, &current).map_err(|e| e.to_string())?;
    Ok(current)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SettingsLock(Mutex::new(())))
        .invoke_handler(tauri::generate_handler![get_app_settings, set_ui_language])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
