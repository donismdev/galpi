//! galpi Rust core. Owns per-device settings, the open work folder (02), episodes and
//! external editors (03). Save, commit, watch and search build on `workspace::WorkspaceSession`.

pub mod debug_tools;
pub mod editor;
pub mod settings;
pub mod workspace;

use editor::{DetectedEditors, EditorKind, EditorSettings, LaunchError, LaunchResult};
use std::sync::Arc;
use tauri::Emitter;
use workspace::episodes::{self, CreatedEpisode, EpisodeInfo, EpisodeList};
use workspace::manuscript::{self, DiskProbe, Draft, LineEnding, ManuscriptRead, SavedManuscript};
use workspace::watch::{self, WatchHandle};

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
    workspace: Mutex<Option<Arc<WorkspaceSession>>>,
    /// Disk watcher of the open work (05). Replaced together with `workspace`.
    watch: Mutex<Option<WatchHandle>>,
}

/// Errors from commands that can fail in either the work folder or an external editor.
#[derive(serde::Serialize, Debug)]
#[serde(untagged)]
enum CmdError {
    Ws(WsError),
    Launch(LaunchError),
}

impl From<WsError> for CmdError {
    fn from(e: WsError) -> Self {
        CmdError::Ws(e)
    }
}

impl From<LaunchError> for CmdError {
    fn from(e: LaunchError) -> Self {
        CmdError::Launch(e)
    }
}

/// The open work, only if `session_id` still names it. The Arc lets long operations run
/// without holding the slot lock; a stale id (work closed or switched) is refused.
fn session(state: &AppState, session_id: &str) -> Result<Arc<WorkspaceSession>, WsError> {
    let slot = state.workspace.lock().map_err(io_err)?;
    match slot.as_ref() {
        Some(s) if s.session_id == session_id => Ok(Arc::clone(s)),
        Some(_) => Err(WsError::StaleSession),
        None => Err(WsError::NoWorkspaceOpen),
    }
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
    // Drop the old session (and its watcher) first so re-opening the same folder does not see
    // our own lock and late reports of the old work stop.
    if let Ok(mut w) = state.watch.lock() {
        *w = None;
    }
    *slot = None;
    let session = Arc::new(workspace::open(path)?);
    let summary = session.summary();
    // Watching only reads; still skip works from a newer galpi (we promise not to touch them at all).
    if session.read_only_reason != Some(workspace::error::ReadOnlyReason::NewerSchema) {
        let app2 = app.clone();
        match watch::start(&session, move |change| {
            let _ = app2.emit("manuscript-changed", change);
        }) {
            Ok(h) => {
                if let Ok(mut w) = state.watch.lock() {
                    *w = Some(h);
                }
            }
            Err(e) => eprintln!("galpi: file watching unavailable: {e}"),
        }
    }
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
            if let Ok(mut w) = state.watch.lock() {
                *w = None;
            }
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
    Ok(slot.as_ref().map(|s| s.summary()))
}

#[tauri::command]
fn list_episodes(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<EpisodeList, WsError> {
    episodes::list(&*session(&state, &session_id)?)
}

#[tauri::command]
fn create_episode(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
) -> Result<CreatedEpisode, WsError> {
    episodes::create_next(&*session(&state, &session_id)?, &request_id)
}

#[tauri::command]
fn rename_episode(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    episode_id: String,
    title: String,
) -> Result<EpisodeInfo, WsError> {
    episodes::rename(
        &*session(&state, &session_id)?,
        &request_id,
        &episode_id,
        &title,
    )
}

/// Sends an "open" request to an external editor. Success means only that the request was sent.
#[tauri::command]
fn open_episode_external(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    editor: EditorKind,
) -> Result<LaunchResult, CmdError> {
    let s = session(&state, &session_id)?;
    let ep = episodes::find(&s, &episode_id)?;
    let prefs = settings::load(&settings_file(&app)?).editor;
    let plan = editor::plan(editor, &prefs, &s.root, Path::new(&ep.manuscript_path))?;
    Ok(editor::launch(&plan)?)
}

#[tauri::command]
fn detect_editors(app: tauri::AppHandle) -> Result<DetectedEditors, WsError> {
    let prefs = settings::load(&settings_file(&app)?).editor;
    Ok(editor::detect(&prefs))
}

#[tauri::command]
fn set_editor_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    editor: EditorSettings,
) -> Result<AppSettings, WsError> {
    update_settings(&app, &state, |s| {
        s.editor = EditorSettings {
            kind: editor.kind,
            vscode_path: editor
                .vscode_path
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty()),
        }
    })
}

// ---------------------------------------------------------------- manuscript (built-in editor, 04)

#[tauri::command]
fn read_manuscript(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<ManuscriptRead, WsError> {
    manuscript::read(&*session(&state, &session_id)?, &episode_id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveRequest {
    session_id: String,
    request_id: String,
    episode_id: String,
    text: String,
    /// None = the file must not exist (re-create after an outside delete).
    base_hash: Option<String>,
    bom: bool,
    line_ending: LineEnding,
}

#[tauri::command]
fn save_manuscript(
    state: tauri::State<'_, AppState>,
    request: SaveRequest,
) -> Result<SavedManuscript, WsError> {
    let s = session(&state, &request.session_id)?;
    let saved = manuscript::save(
        &s,
        &request.request_id,
        &request.episode_id,
        &request.text,
        request.base_hash.as_deref(),
        request.bom,
        request.line_ending,
    )?;
    // A successful save makes any earlier unsaved draft obsolete.
    let _ = manuscript::discard_draft(&s, &request.episode_id);
    Ok(saved)
}

#[tauri::command]
fn save_draft(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    base_hash: Option<String>,
    base_text: Option<String>,
    text: String,
) -> Result<Draft, WsError> {
    manuscript::save_draft(
        &*session(&state, &session_id)?,
        &episode_id,
        base_hash.as_deref(),
        base_text.as_deref(),
        &text,
    )
}

#[tauri::command]
fn probe_manuscript(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<DiskProbe, WsError> {
    manuscript::probe(&*session(&state, &session_id)?, &episode_id)
}

#[tauri::command]
fn load_draft(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<Option<Draft>, WsError> {
    manuscript::load_draft(&*session(&state, &session_id)?, &episode_id)
}

#[tauri::command]
fn discard_draft(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<(), WsError> {
    manuscript::discard_draft(&*session(&state, &session_id)?, &episode_id)
}

/// Opens Explorer with the manuscript selected ("원본 위치 열기").
#[tauri::command]
fn reveal_episode_file(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<(), WsError> {
    let p = manuscript::file_path(&*session(&state, &session_id)?, &episode_id)?;
    let mut cmd = std::process::Command::new("explorer.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer parses its own command line: /select,"<path>" (Windows paths cannot contain ").
        cmd.raw_arg(format!("/select,\"{}\"", workspace::display_path(&p)));
    }
    #[cfg(not(windows))]
    cmd.arg(&p);
    cmd.spawn().map_err(WsError::from)?;
    Ok(())
}

// ---------------------------------------------------------------- history (06)

#[tauri::command]
fn list_revisions(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<workspace::history::History, WsError> {
    workspace::history::list(&*session(&state, &session_id)?, &episode_id)
}

#[tauri::command]
fn read_revision(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    revision_id: String,
) -> Result<workspace::history::RevisionText, WsError> {
    workspace::history::read(&*session(&state, &session_id)?, &episode_id, &revision_id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitRequest {
    session_id: String,
    request_id: String,
    episode_id: String,
    message: String,
    /// Hash of the working file the editor last read/saved; the commit is refused if the disk differs.
    expected_hash: Option<String>,
}

#[tauri::command]
fn commit_episode(
    state: tauri::State<'_, AppState>,
    request: CommitRequest,
) -> Result<workspace::history::CommitResult, WsError> {
    workspace::history::commit(
        &*session(&state, &request.session_id)?,
        &request.request_id,
        &request.episode_id,
        &request.message,
        request.expected_hash.as_deref(),
    )
}

#[tauri::command]
fn backup_working_copy(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<String, WsError> {
    workspace::history::backup_working_copy(&*session(&state, &session_id)?, &episode_id)
}

// ---------------------------------------------------------------- summaries (07)

#[tauri::command]
fn list_summaries(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<workspace::summaries::SummaryStatus>, WsError> {
    workspace::summaries::list(&*session(&state, &session_id)?)
}

#[tauri::command]
fn read_summary(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
) -> Result<workspace::summaries::SummaryDoc, WsError> {
    workspace::summaries::read(&*session(&state, &session_id)?, &episode_id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveSummaryRequest {
    session_id: String,
    request_id: String,
    episode_id: String,
    kind: workspace::summaries::TextKind,
    text: String,
    /// Hash read before editing; None = the file did not exist.
    expected_hash: Option<String>,
}

#[tauri::command]
fn save_summary_text(
    state: tauri::State<'_, AppState>,
    request: SaveSummaryRequest,
) -> Result<workspace::summaries::SummaryDoc, WsError> {
    workspace::summaries::save_text(
        &*session(&state, &request.session_id)?,
        &request.request_id,
        &request.episode_id,
        request.kind,
        &request.text,
        request.expected_hash.as_deref(),
    )
}

#[tauri::command]
fn confirm_summary(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    episode_id: String,
    revision_id: String,
) -> Result<workspace::summaries::SummaryDoc, WsError> {
    workspace::summaries::confirm(
        &*session(&state, &session_id)?,
        &request_id,
        &episode_id,
        &revision_id,
    )
}

// ---------------------------------------------------------------- world cards & tags (08)

use workspace::lore;

#[tauri::command]
fn list_cards(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<lore::CardList, WsError> {
    lore::list(&*session(&state, &session_id)?)
}

#[tauri::command]
fn read_card(
    state: tauri::State<'_, AppState>,
    session_id: String,
    card_id: String,
) -> Result<lore::CardDoc, WsError> {
    lore::read(&*session(&state, &session_id)?, &card_id)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCardRequest {
    session_id: String,
    request_id: String,
    template_id: lore::TemplateId,
    name: String,
    folder: Option<String>,
    /// Template text in the UI language at this moment; stored as the writer's text.
    body: String,
}

#[tauri::command]
fn create_card(
    state: tauri::State<'_, AppState>,
    request: CreateCardRequest,
) -> Result<lore::CardInfo, WsError> {
    lore::create(
        &*session(&state, &request.session_id)?,
        &request.request_id,
        request.template_id,
        &request.name,
        request.folder.as_deref(),
        &request.body,
    )
}

#[tauri::command]
fn save_card_body(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    card_id: String,
    text: String,
    expected_hash: Option<String>,
) -> Result<lore::CardDoc, WsError> {
    lore::save_body(
        &*session(&state, &session_id)?,
        &request_id,
        &card_id,
        &text,
        expected_hash.as_deref(),
    )
}

#[tauri::command]
fn update_card_meta(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    card_id: String,
    patch: lore::MetaPatch,
    expected_meta_hash: String,
) -> Result<lore::CardDoc, WsError> {
    lore::update_meta(
        &*session(&state, &session_id)?,
        &request_id,
        &card_id,
        &patch,
        &expected_meta_hash,
    )
}

#[tauri::command]
fn move_card(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    card_id: String,
    folder: String,
) -> Result<lore::CardDoc, WsError> {
    lore::move_card(
        &*session(&state, &session_id)?,
        &request_id,
        &card_id,
        &folder,
    )
}

#[tauri::command]
fn create_card_folder(
    state: tauri::State<'_, AppState>,
    session_id: String,
    folder: String,
) -> Result<String, WsError> {
    lore::create_folder(&*session(&state, &session_id)?, &folder)
}

#[tauri::command]
fn list_tags(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<Vec<lore::TagInfo>, WsError> {
    lore::list_tags(&*session(&state, &session_id)?)
}

#[tauri::command]
fn create_tag(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    label: String,
) -> Result<lore::TagInfo, WsError> {
    lore::create_tag(&*session(&state, &session_id)?, &request_id, &label)
}

#[tauri::command]
fn rename_tag(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    tag_id: String,
    label: String,
) -> Result<lore::TagInfo, WsError> {
    lore::rename_tag(
        &*session(&state, &session_id)?,
        &request_id,
        &tag_id,
        &label,
    )
}

#[tauri::command]
fn delete_tag_everywhere(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    tag_id: String,
) -> Result<usize, WsError> {
    lore::delete_tag_everywhere(&*session(&state, &session_id)?, &request_id, &tag_id)
}

// ---------------------------------------------------------------- timelines & events (09)

use workspace::timelines;

#[tauri::command]
fn load_timelines(
    state: tauri::State<'_, AppState>,
    session_id: String,
) -> Result<timelines::TimelineData, WsError> {
    timelines::load(&*session(&state, &session_id)?)
}

#[tauri::command]
fn create_timeline(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    name: String,
    default_mode: timelines::ViewMode,
) -> Result<timelines::CollectionInfo, WsError> {
    timelines::create_collection(
        &*session(&state, &session_id)?,
        &request_id,
        &name,
        default_mode,
    )
}

#[tauri::command]
fn update_timeline(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    collection_id: String,
    name: String,
    default_mode: timelines::ViewMode,
    expected_hash: String,
) -> Result<(), WsError> {
    timelines::update_collection(
        &*session(&state, &session_id)?,
        &request_id,
        &collection_id,
        &name,
        default_mode,
        &expected_hash,
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEventRequest {
    session_id: String,
    request_id: String,
    /// None = new event.
    event_id: Option<String>,
    expected_hash: Option<String>,
    draft: timelines::EventDraft,
}

#[tauri::command]
fn save_event(
    state: tauri::State<'_, AppState>,
    request: SaveEventRequest,
) -> Result<timelines::EventInfo, WsError> {
    timelines::save_event(
        &*session(&state, &request.session_id)?,
        &request.request_id,
        request.event_id.as_deref(),
        request.expected_hash.as_deref(),
        &request.draft,
    )
}

#[tauri::command]
fn confirm_event(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    event_id: String,
    revision_id: String,
) -> Result<timelines::EventInfo, WsError> {
    timelines::confirm_event(
        &*session(&state, &session_id)?,
        &request_id,
        &event_id,
        &revision_id,
    )
}

#[tauri::command]
fn add_story_track(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    label: String,
    expected_hash: String,
) -> Result<Vec<workspace::manifest::StoryTrack>, WsError> {
    timelines::add_track(
        &*session(&state, &session_id)?,
        &request_id,
        &label,
        &expected_hash,
    )
}

#[tauri::command]
fn rename_story_track(
    state: tauri::State<'_, AppState>,
    session_id: String,
    request_id: String,
    track_id: String,
    label: String,
    expected_hash: String,
) -> Result<Vec<workspace::manifest::StoryTrack>, WsError> {
    timelines::rename_track(
        &*session(&state, &session_id)?,
        &request_id,
        &track_id,
        &label,
        &expected_hash,
    )
}

// ---------------------------------------------------------------- debug tab

#[tauri::command]
fn debug_file_info(
    state: tauri::State<'_, AppState>,
    locks: tauri::State<'_, debug_tools::DebugLocks>,
    session_id: String,
    episode_id: String,
) -> Result<debug_tools::FileInfo, WsError> {
    debug_tools::file_info(&*session(&state, &session_id)?, &episode_id, &locks)
}

#[tauri::command]
fn debug_write_fixture(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    fixture: debug_tools::Fixture,
) -> Result<(), WsError> {
    debug_tools::write_fixture(&*session(&state, &session_id)?, &episode_id, fixture)
}

#[tauri::command]
fn debug_set_lock(
    state: tauri::State<'_, AppState>,
    locks: tauri::State<'_, debug_tools::DebugLocks>,
    session_id: String,
    episode_id: String,
    on: bool,
) -> Result<(), WsError> {
    debug_tools::set_lock(&*session(&state, &session_id)?, &episode_id, on, &locks)
}

#[tauri::command]
fn debug_external_edit(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    action: debug_tools::ExternalAction,
) -> Result<(), WsError> {
    debug_tools::external_edit(&*session(&state, &session_id)?, &episode_id, action)
}

#[tauri::command]
fn debug_history_fixture(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    action: debug_tools::HistoryAction,
) -> Result<String, WsError> {
    debug_tools::history_fixture(&*session(&state, &session_id)?, &episode_id, action)
}

#[tauri::command]
fn debug_summary_fixture(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    action: debug_tools::SummaryAction,
) -> Result<String, WsError> {
    debug_tools::summary_fixture(&*session(&state, &session_id)?, &episode_id, action)
}

#[tauri::command]
fn debug_lore_fixture(
    state: tauri::State<'_, AppState>,
    session_id: String,
    action: debug_tools::LoreAction,
) -> Result<String, WsError> {
    debug_tools::lore_fixture(&*session(&state, &session_id)?, action)
}

#[tauri::command]
fn debug_timeline_fixture(
    state: tauri::State<'_, AppState>,
    session_id: String,
    action: debug_tools::TimelineAction,
) -> Result<String, WsError> {
    debug_tools::timeline_fixture(&*session(&state, &session_id)?, action)
}

#[tauri::command]
fn debug_set_readonly(
    state: tauri::State<'_, AppState>,
    session_id: String,
    episode_id: String,
    on: bool,
) -> Result<(), WsError> {
    debug_tools::set_readonly(&*session(&state, &session_id)?, &episode_id, on)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    /// true for `tauri dev` / `tauri build --debug` (Rust debug_assertions). The debug tab shows only then.
    debug: bool,
    version: String,
    os: &'static str,
    arch: &'static str,
    settings_path: String,
}

#[tauri::command]
fn build_info(app: tauri::AppHandle) -> Result<BuildInfo, WsError> {
    Ok(BuildInfo {
        debug: cfg!(debug_assertions),
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        settings_path: settings_file(&app)?.display().to_string(),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleResult {
    path: String,
    workspace_id: String,
    episodes: Vec<EpisodeInfo>,
}

/// Debug builds only: makes a synthetic work (new/empty folder) with N empty episodes.
#[tauri::command]
fn debug_make_sample_work(
    path: String,
    title: String,
    count: u32,
) -> Result<SampleResult, WsError> {
    if !cfg!(debug_assertions) {
        return Err(WsError::Io {
            kind: "Unsupported".into(),
            detail: "debug builds only".into(),
        });
    }
    let p = PathBuf::from(&path);
    let s = workspace::sample::make_sample(&p, &title, count)?;
    Ok(SampleResult {
        path: workspace::display_path(&p),
        workspace_id: s.workspace_id,
        episodes: s.episodes,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(debug_tools::DebugLocks::default())
        .invoke_handler(tauri::generate_handler![
            get_app_settings,
            set_ui_language,
            forget_recent_workspace,
            inspect_folder,
            create_workspace,
            open_workspace,
            close_workspace,
            current_workspace,
            list_episodes,
            create_episode,
            rename_episode,
            open_episode_external,
            detect_editors,
            set_editor_settings,
            build_info,
            debug_make_sample_work,
            read_manuscript,
            list_summaries,
            read_summary,
            save_summary_text,
            confirm_summary,
            list_cards,
            read_card,
            create_card,
            save_card_body,
            update_card_meta,
            move_card,
            create_card_folder,
            list_tags,
            create_tag,
            rename_tag,
            delete_tag_everywhere,
            load_timelines,
            create_timeline,
            update_timeline,
            save_event,
            confirm_event,
            add_story_track,
            rename_story_track,
            list_revisions,
            read_revision,
            commit_episode,
            backup_working_copy,
            probe_manuscript,
            save_manuscript,
            save_draft,
            load_draft,
            discard_draft,
            reveal_episode_file,
            debug_file_info,
            debug_write_fixture,
            debug_set_lock,
            debug_set_readonly,
            debug_external_edit,
            debug_history_fixture,
            debug_summary_fixture,
            debug_lore_fixture,
            debug_timeline_fixture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
