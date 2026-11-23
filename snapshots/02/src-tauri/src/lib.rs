//! galpi Rust core. Owns per-device settings and the open work folder (session 02).
//! Episode, save, commit, watch and search paths build on `workspace::WorkspaceSession`.

pub mod settings;
pub mod workspace;

use settings::{AppSettings, RecentWorkspace, UiLanguage};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use workspace::error::WsError;
use workspace::{CreateOptions, CreateOutcome, Inspection, OpenedWorkspace, WorkspaceSession};

#[derive(Default)]
struct AppState {
    /// Serialises settings read-modify-write across windows.
    settings: Mutex<()>,
    /// The single open work folder. Replaced atomically on open/close.
    workspace: Mutex<Option<WorkspaceSession>>,
}

fn io_err(detail: impl ToString) -> WsError {
    WsError::Io {
        kind: "Other".into(),
        detail: detail.to_string(),
    }
}

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, WsError> {
    app.path()
        .app_config_dir()
        .map(|dir| settings::settings_path(&dir))
        .map_err(io_err)
}

fn update_settings(
    app: &tauri::AppHandle,
    state: &AppState,
    f: impl FnOnce(&mut AppSettings),
) -> Result<AppSettings, WsError> {
    let _guard = state.settings.lock().map_err(io_err)?;
    let path = settings_file(app)?;
    let mut current = settings::load(&path);
    f(&mut current);
    settings::save(&path, &current)?;
    Ok(current)
}

#[tauri::command]
fn get_app_settings(app: tauri::AppHandle) -> Result<AppSettings, WsError> {
    Ok(settings::load(&settings_file(&app)?))
}

#[tauri::command]
fn set_ui_language(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    language: UiLanguage,
) -> Result<AppSettings, WsError> {
    update_settings(&app, &state, |s| s.ui_language = language)
}

#[tauri::command]
fn forget_recent_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<AppSettings, WsError> {
    update_settings(&app, &state, |s| s.forget_workspace(&path))
}

#[tauri::command]
fn inspect_folder(path: String, suggest_name: String) -> Result<Inspection, WsError> {
    workspace::inspect(Path::new(&path), &suggest_name)
}

/// Closes the current work (releasing its lock) and opens `path` as the new current work.
fn switch_to(
    app: &tauri::AppHandle,
    state: &AppState,
    path: &Path,
) -> Result<OpenedWorkspace, WsError> {
    let mut slot = state.workspace.lock().map_err(io_err)?;
    // Drop the old session first so re-opening the same folder does not see our own lock.
    *slot = None;
    let session = workspace::open(path)?;
    let summary = session.summary();
    *slot = Some(session);
    drop(slot);

    if !summary.workspace_id.is_empty() {
        // Recent list is a convenience: failing to save it must not fail the open.
        let _ = update_settings(app, state, |s| {
            s.remember_workspace(RecentWorkspace {
                path: summary.root.clone(),
                title: summary.title.clone(),
                workspace_id: summary.workspace_id.clone(),
                last_opened_at: workspace::manifest::now_rfc3339(),
            })
        });
    }
    Ok(summary)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRequest {
    path: String,
    title: String,
    request_id: String,
    track_label: String,
    confirm_non_empty: bool,
    /// Create `path` itself first (used for the suggested subfolder after a name conflict).
    create_folder: bool,
}

#[tauri::command]
fn create_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    request: CreateRequest,
) -> Result<OpenedWorkspace, WsError> {
    let p = PathBuf::from(&request.path);
    if request.create_folder {
        workspace::ensure_leaf_folder(&p)?;
    }
    let opts = CreateOptions {
        title: request.title,
        request_id: request.request_id,
        track_label: request.track_label,
        confirm_non_empty: request.confirm_non_empty,
    };
    match workspace::create(&p, &opts, None)? {
        CreateOutcome::Created(_) => switch_to(&app, &state, &p),
        CreateOutcome::Interrupted(step) => Err(io_err(format!("interrupted at {step:?}"))),
    }
}

#[tauri::command]
fn open_workspace(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<OpenedWorkspace, WsError> {
    switch_to(&app, &state, Path::new(&path))
}

#[tauri::command]
fn close_workspace(state: tauri::State<'_, AppState>, session_id: String) -> Result<(), WsError> {
    let mut slot = state.workspace.lock().map_err(io_err)?;
    match slot.as_ref() {
        Some(s) if s.session_id == session_id => {
            *slot = None;
            Ok(())
        }
        Some(_) => Err(WsError::StaleSession),
        None => Err(WsError::NoWorkspaceOpen),
    }
}

#[tauri::command]
fn current_workspace(
    state: tauri::State<'_, AppState>,
) -> Result<Option<OpenedWorkspace>, WsError> {
    let slot = state.workspace.lock().map_err(io_err)?;
    Ok(slot.as_ref().map(WorkspaceSession::summary))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            set_ui_language,
            forget_recent_workspace,
            inspect_folder,
            create_workspace,
            open_workspace,
            close_workspace,
            current_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
