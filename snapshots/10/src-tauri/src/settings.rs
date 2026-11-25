//! Per-device app settings (UI language for now).
//!
//! These live in the OS app-config directory, never inside a writer's work folder
//! (see docs/development/WORKSPACE_FORMAT.md, "쓰기와 복구" 6).

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub const SETTINGS_FILE: &str = "settings.json";
pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiLanguage {
    #[default]
    Ko,
    En,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub ui_language: UiLanguage,
    /// Most recent first. Device data only; never written into a work folder. (02회)
    #[serde(default)]
    pub recent_workspaces: Vec<RecentWorkspace>,
    /// Default external editor and optional VS Code location. (03회)
    #[serde(default)]
    pub editor: crate::editor::EditorSettings,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentWorkspace {
    pub path: String,
    pub title: String,
    pub workspace_id: String,
    pub last_opened_at: String,
}

pub const MAX_RECENT: usize = 10;

impl AppSettings {
    /// Moves/inserts `entry` to the front. The same folder path (case-insensitive) appears once;
    /// a copied work folder at another path keeps its own row even with the same workspaceId.
    pub fn remember_workspace(&mut self, entry: RecentWorkspace) {
        self.recent_workspaces
            .retain(|r| !r.path.eq_ignore_ascii_case(&entry.path));
        self.recent_workspaces.insert(0, entry);
        self.recent_workspaces.truncate(MAX_RECENT);
    }

    pub fn forget_workspace(&mut self, path: &str) {
        self.recent_workspaces
            .retain(|r| !r.path.eq_ignore_ascii_case(path));
    }
}

fn default_schema_version() -> u32 {
    SETTINGS_SCHEMA_VERSION
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            ui_language: UiLanguage::default(),
            recent_workspaces: Vec::new(),
            editor: crate::editor::EditorSettings::default(),
        }
    }
}

pub fn settings_path(config_dir: &Path) -> PathBuf {
    config_dir.join(SETTINGS_FILE)
}

/// Reads settings. A missing or unreadable file yields defaults; the file itself is left untouched.
/// A UTF-8 BOM (e.g. from Windows PowerShell 5.1 or Notepad) is tolerated.
pub fn load(path: &Path) -> AppSettings {
    match fs::read(path) {
        Ok(bytes) => {
            let body = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
            serde_json::from_slice(body).unwrap_or_default()
        }
        Err(_) => AppSettings::default(),
    }
}

/// Writes settings via a temp file in the same directory, then renames over the target.
pub fn save(path: &Path, settings: &AppSettings) -> io::Result<()> {
    let dir = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "settings path has no parent")
    })?;
    fs::create_dir_all(dir)?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        let body = serde_json::to_vec_pretty(settings).map_err(io::Error::other)?;
        file.write_all(&body)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_defaults_to_korean() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(&settings_path(dir.path()));
        assert_eq!(s.ui_language, UiLanguage::Ko);
        assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);
    }

    #[test]
    fn save_then_load_round_trips_language() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(&dir.path().join("nested"));
        let s = AppSettings {
            ui_language: UiLanguage::En,
            ..AppSettings::default()
        };
        save(&path, &s).unwrap();
        assert_eq!(load(&path), s);
        // overwrite an existing file
        save(&path, &AppSettings::default()).unwrap();
        assert_eq!(load(&path).ui_language, UiLanguage::Ko);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn corrupt_file_falls_back_without_deleting_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        fs::write(&path, b"{ not json").unwrap();
        assert_eq!(load(&path), AppSettings::default());
        assert_eq!(fs::read(&path).unwrap(), b"{ not json");
    }

    #[test]
    fn session01_file_without_recent_list_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        fs::write(&path, br#"{ "schemaVersion": 1, "uiLanguage": "en" }"#).unwrap();
        let s = load(&path);
        assert_eq!(s.ui_language, UiLanguage::En);
        assert!(s.recent_workspaces.is_empty());
        assert_eq!(s.editor.kind, crate::editor::EditorKind::Vscode);
    }

    #[test]
    fn recent_list_dedupes_by_path_and_caps() {
        let mut s = AppSettings::default();
        let e = |p: &str, id: &str| RecentWorkspace {
            path: p.into(),
            title: "t".into(),
            workspace_id: id.into(),
            last_opened_at: "x".into(),
        };
        s.remember_workspace(e(r"C:\a", "1"));
        s.remember_workspace(e(r"C:\copy-of-a", "1"));
        s.remember_workspace(e(r"c:\A", "1"));
        assert_eq!(s.recent_workspaces.len(), 2);
        assert_eq!(s.recent_workspaces[0].path, r"c:\A");
        for i in 0..20 {
            s.remember_workspace(e(&format!(r"C:\w{i}"), "x"));
        }
        assert_eq!(s.recent_workspaces.len(), MAX_RECENT);
        s.forget_workspace(r"C:\W19");
        assert_eq!(s.recent_workspaces[0].path, r"C:\w18");
    }

    #[test]
    fn hand_edited_file_with_bom_is_read() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        fs::write(
            &path,
            b"\xEF\xBB\xBF{ \"schemaVersion\": 1, \"uiLanguage\": \"en\" }\r\n",
        )
        .unwrap();
        assert_eq!(load(&path).ui_language, UiLanguage::En);
    }

    #[test]
    fn unknown_language_is_rejected_on_the_wire() {
        let parsed: Result<UiLanguage, _> = serde_json::from_str("\"fr\"");
        assert!(parsed.is_err());
        let parsed: UiLanguage = serde_json::from_str("\"en\"").unwrap();
        assert_eq!(parsed, UiLanguage::En);
    }
}
