//! Relative-path validation for everything written inside a work folder.
//! Records store uniform `/`-separated relative paths (WORKSPACE_FORMAT.md). Anything that could
//! leave the root — `..`, absolute/drive paths, ADS (`name:stream`), junctions/symlinks — is refused.

use super::error::WsError;
use std::path::{Component, Path, PathBuf};

const WINDOWS_RESERVED: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn bad(rel: &str) -> WsError {
    WsError::InvalidRelativePath {
        rel: rel.to_string(),
    }
}

/// Validates a stored relative path and returns it as a native relative `PathBuf`.
pub fn validate_relative(rel: &str) -> Result<PathBuf, WsError> {
    if rel.is_empty() || rel.starts_with('/') || rel.starts_with('\\') {
        return Err(bad(rel));
    }
    let mut out = PathBuf::new();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." || part == ".." {
            return Err(bad(rel));
        }
        if part.ends_with('.') || part.ends_with(' ') {
            return Err(bad(rel));
        }
        if part
            .chars()
            .any(|c| c.is_control() || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*'))
        {
            return Err(bad(rel));
        }
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if WINDOWS_RESERVED.contains(&stem.as_str()) {
            return Err(bad(rel));
        }
        out.push(part);
    }
    // Belt and braces: the platform parser must agree that every component is Normal.
    if !out.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(bad(rel));
    }
    Ok(out)
}

/// Resolves `rel` under `root` (already canonical) and proves the result cannot escape it,
/// following any existing junction/symlink on the way.
pub fn resolve_in_root(root: &Path, rel: &str) -> Result<PathBuf, WsError> {
    let relative = validate_relative(rel)?;
    let target = root.join(&relative);

    // Deepest existing ancestor (or the target itself) must canonicalize inside root.
    let mut probe = target.as_path();
    loop {
        if probe.exists() {
            let real = dunce::canonicalize(probe)?;
            if !real.starts_with(root) {
                return Err(WsError::PathOutsideWorkspace {
                    rel: rel.to_string(),
                });
            }
            break;
        }
        match probe.parent() {
            Some(p) => probe = p,
            None => break,
        }
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_paths() {
        for ok in [
            "workspace.json",
            "episodes/000001-e001/manuscript.md",
            "lore\\characters\\서린 (주인공)\\card.md",
        ] {
            assert!(validate_relative(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn rejects_escapes_and_windows_traps() {
        for badp in [
            "",
            "../x",
            "a/../../x",
            "/abs",
            "\\abs",
            "C:\\x",
            "C:x",
            "a//b",
            "./a",
            "a/file.md:stream",
            "a/CON",
            "a/nul.txt",
            "trailing. ",
            "trail.",
            "q?",
        ] {
            assert!(validate_relative(badp).is_err(), "{badp:?}");
        }
    }

    #[test]
    fn resolve_stays_inside_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let p = resolve_in_root(&root, "episodes/x/manuscript.md").unwrap();
        assert!(p.starts_with(&root));
        assert!(matches!(
            resolve_in_root(&root, "../outside.md"),
            Err(WsError::InvalidRelativePath { .. })
        ));
    }

    #[cfg(windows)]
    #[test]
    fn junction_pointing_outside_is_refused() {
        let base = tempfile::tempdir().unwrap();
        let root_dir = base.path().join("work");
        let outside = base.path().join("outside");
        std::fs::create_dir_all(&root_dir).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let link = root_dir.join("lore");
        // Directory junctions need no admin rights on Windows.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
        let root = dunce::canonicalize(&root_dir).unwrap();
        assert!(matches!(
            resolve_in_root(&root, "lore/card.md"),
            Err(WsError::PathOutsideWorkspace { .. })
        ));
        assert!(matches!(
            resolve_in_root(&root, "lore"),
            Err(WsError::PathOutsideWorkspace { .. })
        ));
    }
}
