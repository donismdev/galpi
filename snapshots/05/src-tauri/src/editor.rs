//! External editors. A successful launch only means "the open request was sent" (CH1):
//! galpi never waits for the editor, and the editor closing says nothing about saving or
//! confirming a draft. Disk changes are judged from file contents (session 05).
//!
//! The program and its arguments are passed separately (no shell), so paths with Korean
//! text, spaces, `&`, `%`, `'`, `#`, `(`, `)` reach the editor unchanged.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum EditorKind {
    /// VS Code: opens the work root (Explorer) and the manuscript (editor area).
    #[default]
    Vscode,
    /// Windows Notepad: opens the manuscript only.
    Notepad,
    /// Built-in editor (session 04).
    Builtin,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EditorSettings {
    #[serde(default)]
    pub kind: EditorKind,
    /// Optional explicit VS Code location (Code.exe, or its bin\code.cmd). Empty = auto-detect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vscode_path: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(
    tag = "code",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LaunchError {
    /// No executable found. `tried` lists every location checked, in order.
    EditorNotFound {
        editor: EditorKind,
        tried: Vec<String>,
    },
    /// The executable exists but the OS refused to start it.
    EditorLaunchFailed {
        editor: EditorKind,
        program: String,
        detail: String,
    },
    /// The built-in editor arrives in session 04.
    EditorNotReady { editor: EditorKind },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub editor: EditorKind,
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    pub editor: EditorKind,
    pub program: String,
    pub args: Vec<String>,
    /// Always true on success: the request was handed to the editor; nothing more is implied.
    pub request_sent: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedEditors {
    pub vscode: Option<String>,
    pub vscode_tried: Vec<String>,
    pub notepad: Option<String>,
}

fn env_path(var: &str, rest: &[&str]) -> Option<PathBuf> {
    let mut p = PathBuf::from(std::env::var_os(var)?);
    for r in rest {
        p.push(r);
    }
    Some(p)
}

/// `...\Microsoft VS Code\bin\code.cmd` → `...\Microsoft VS Code\Code.exe`.
fn code_exe_from_cli(cli: &Path) -> Option<PathBuf> {
    let exe = cli.parent()?.parent()?.join("Code.exe");
    exe.is_file().then_some(exe)
}

/// Finds VS Code's Code.exe. Order: explicit setting → per-user install → machine install → PATH.
pub fn find_vscode(custom: Option<&str>) -> Result<PathBuf, Vec<String>> {
    let mut tried = Vec::new();
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        tried.push(p.display().to_string());
        let is_cli = p
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.eq_ignore_ascii_case("code.cmd") || n.eq_ignore_ascii_case("code"));
        if is_cli {
            if let Some(exe) = code_exe_from_cli(&p) {
                return Ok(exe);
            }
        } else if p.is_file() {
            return Ok(p);
        }
        // An explicit path that does not work is a failure; do not silently pick another VS Code.
        return Err(tried);
    }
    let candidates = [
        env_path(
            "LOCALAPPDATA",
            &["Programs", "Microsoft VS Code", "Code.exe"],
        ),
        env_path("ProgramFiles", &["Microsoft VS Code", "Code.exe"]),
        env_path("ProgramFiles(x86)", &["Microsoft VS Code", "Code.exe"]),
    ];
    for c in candidates.into_iter().flatten() {
        tried.push(c.display().to_string());
        if c.is_file() {
            return Ok(c);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let cli = dir.join("code.cmd");
            if cli.is_file() {
                tried.push(cli.display().to_string());
                if let Some(exe) = code_exe_from_cli(&cli) {
                    return Ok(exe);
                }
            }
        }
    }
    Err(tried)
}

pub fn find_notepad() -> Option<PathBuf> {
    env_path("WINDIR", &["System32", "notepad.exe"]).filter(|p| p.is_file())
}

pub fn detect(settings: &EditorSettings) -> DetectedEditors {
    let (vscode, vscode_tried) = match find_vscode(settings.vscode_path.as_deref()) {
        Ok(p) => (Some(p.display().to_string()), Vec::new()),
        Err(t) => (None, t),
    };
    DetectedEditors {
        vscode,
        vscode_tried,
        notepad: find_notepad().map(|p| p.display().to_string()),
    }
}

/// Builds program + arguments. VS Code gets `<work root> <manuscript>` so the Explorer shows the
/// work and the manuscript is the active editor; Notepad gets only the manuscript.
pub fn plan(
    editor: EditorKind,
    settings: &EditorSettings,
    work_root: &Path,
    manuscript: &Path,
) -> Result<LaunchPlan, LaunchError> {
    match editor {
        EditorKind::Vscode => {
            let program = find_vscode(settings.vscode_path.as_deref())
                .map_err(|tried| LaunchError::EditorNotFound { editor, tried })?;
            Ok(LaunchPlan {
                editor,
                program,
                args: vec![work_root.into(), manuscript.into()],
            })
        }
        EditorKind::Notepad => {
            let program = find_notepad().ok_or_else(|| LaunchError::EditorNotFound {
                editor,
                tried: vec![r"%WINDIR%\System32\notepad.exe".into()],
            })?;
            Ok(LaunchPlan {
                editor,
                program,
                args: vec![manuscript.into()],
            })
        }
        EditorKind::Builtin => Err(LaunchError::EditorNotReady { editor }),
    }
}

/// Starts the editor and returns immediately. The child is not awaited.
pub fn launch(p: &LaunchPlan) -> Result<LaunchResult, LaunchError> {
    let mut cmd = Command::new(&p.program);
    cmd.args(&p.args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        // Code.exe would otherwise run as plain Node if galpi was itself started from a
        // shell that set this (e.g. via code.cmd).
        cmd.env_remove("ELECTRON_RUN_AS_NODE");
    }
    match cmd.spawn() {
        Ok(_child) => Ok(LaunchResult {
            editor: p.editor,
            program: p.program.display().to_string(),
            args: p
                .args
                .iter()
                .map(|a| a.to_string_lossy().into_owned())
                .collect(),
            request_sent: true,
        }),
        Err(e) => Err(LaunchError::EditorLaunchFailed {
            editor: p.editor,
            program: p.program.display().to_string(),
            detail: e.to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vscode_gets_root_then_file_as_separate_arguments() {
        let d = tempfile::tempdir().unwrap();
        let exe = d.path().join("Code.exe");
        std::fs::write(&exe, b"").unwrap();
        let root = Path::new(r"C:\작품\잿빛 항구 (테스트) #1 & 'x' 100%");
        let file = root.join(r"episodes\000001-abcd\manuscript.md");
        let s = EditorSettings {
            kind: EditorKind::Vscode,
            vscode_path: Some(exe.display().to_string()),
        };
        let p = plan(EditorKind::Vscode, &s, root, &file).unwrap();
        assert_eq!(p.program, exe);
        assert_eq!(p.args, vec![OsString::from(root), OsString::from(&file)]);
    }

    #[test]
    fn code_cmd_setting_resolves_to_code_exe() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("bin")).unwrap();
        std::fs::write(d.path().join("bin/code.cmd"), b"@echo off").unwrap();
        std::fs::write(d.path().join("Code.exe"), b"").unwrap();
        let found = find_vscode(Some(&d.path().join("bin/code.cmd").display().to_string()));
        assert_eq!(found.unwrap(), d.path().join("Code.exe"));
    }

    #[test]
    fn wrong_explicit_path_fails_and_lists_it() {
        let s = EditorSettings {
            kind: EditorKind::Vscode,
            vscode_path: Some(r"C:\없는 경로\Code.exe".into()),
        };
        match plan(
            EditorKind::Vscode,
            &s,
            Path::new("C:\\w"),
            Path::new("C:\\w\\m.md"),
        ) {
            Err(LaunchError::EditorNotFound { editor, tried }) => {
                assert_eq!(editor, EditorKind::Vscode);
                assert_eq!(tried, vec![r"C:\없는 경로\Code.exe".to_string()]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn notepad_gets_only_the_file_and_builtin_is_not_ready() {
        let file = Path::new(r"C:\작품\m.md");
        if find_notepad().is_some() {
            let p = plan(
                EditorKind::Notepad,
                &EditorSettings::default(),
                Path::new("C:\\"),
                file,
            )
            .unwrap();
            assert_eq!(p.args, vec![OsString::from(file)]);
        }
        assert!(matches!(
            plan(
                EditorKind::Builtin,
                &EditorSettings::default(),
                Path::new("C:\\"),
                file
            ),
            Err(LaunchError::EditorNotReady { .. })
        ));
    }

    #[test]
    fn spawn_failure_is_reported_not_hidden() {
        let d = tempfile::tempdir().unwrap();
        let fake = d.path().join("not-an-exe.exe");
        std::fs::write(&fake, b"this is text, not a program").unwrap();
        let p = LaunchPlan {
            editor: EditorKind::Vscode,
            program: fake.clone(),
            args: vec![],
        };
        assert!(matches!(
            launch(&p),
            Err(LaunchError::EditorLaunchFailed { .. })
        ));
    }

    #[test]
    fn settings_default_to_vscode_and_round_trip() {
        let s: EditorSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(s.kind, EditorKind::Vscode);
        let j = serde_json::to_string(&EditorSettings {
            kind: EditorKind::Notepad,
            vscode_path: None,
        })
        .unwrap();
        assert_eq!(j, r#"{"kind":"notepad"}"#);
    }
}
