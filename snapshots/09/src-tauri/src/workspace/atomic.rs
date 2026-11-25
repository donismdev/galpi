//! Single-file publish: write a temp file on the same volume, flush, then move it into place.
//!
//! Windows: `std::fs::rename` is `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`, a metadata swap on the
//! same NTFS volume — readers see either the old or the new bytes. `publish_new` uses a hard link
//! instead so it fails (rather than overwrites) if the target appeared meanwhile.
//! Temp files live only in `<root>/.galpi/tmp/` and carry `TMP_SUFFIX`; cleanup touches nothing else.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const TMP_SUFFIX: &str = ".galpi-tmp";

fn write_temp(tmp_dir: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    fs::create_dir_all(tmp_dir)?;
    let tmp = tmp_dir.join(format!("{}{}", Uuid::new_v4().simple(), TMP_SUFFIX));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(tmp)
}

/// Replaces (or creates) `target` with `bytes`. The caller has already checked the expected version.
pub fn replace_atomic(tmp_dir: &Path, target: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = write_temp(tmp_dir, bytes)?;
    fs::rename(&tmp, target).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

/// Creates `target` with `bytes`; fails with `AlreadyExists` instead of overwriting.
pub fn publish_new(tmp_dir: &Path, target: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = write_temp(tmp_dir, bytes)?;
    let linked = fs::hard_link(&tmp, target);
    let _ = fs::remove_file(&tmp);
    linked
}

pub const TMP_DIR_SUFFIX: &str = ".galpi-tmpdir";

/// Publishes several files as one new folder: they are written into a staging folder under
/// `tmp_dir`, flushed, and the staging folder is renamed to `target_dir` in one step.
/// Readers see either no folder or the complete folder. Fails if `target_dir` already exists.
pub fn publish_new_dir(
    tmp_dir: &Path,
    target_dir: &Path,
    files: &[(&str, &[u8])],
) -> io::Result<()> {
    fs::create_dir_all(tmp_dir)?;
    let stage = tmp_dir.join(format!("{}{}", Uuid::new_v4().simple(), TMP_DIR_SUFFIX));
    let result = (|| {
        fs::create_dir(&stage)?;
        for (name, bytes) in files {
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(stage.join(name))?;
            f.write_all(bytes)?;
            f.sync_all()?;
        }
        if target_dir.exists() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "target folder already exists",
            ));
        }
        // MoveFileExW without REPLACE_EXISTING semantics for directories: fails if target exists.
        fs::rename(&stage, target_dir)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}

/// Removes leftover temp files and staging folders written by this module. Only direct children
/// of `tmp_dir` ending in `TMP_SUFFIX` (files) or `TMP_DIR_SUFFIX` (folders) are touched.
pub fn cleanup_tmp(tmp_dir: &Path) -> io::Result<usize> {
    let entries = match fs::read_dir(tmp_dir) {
        Ok(e) => e,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name();
        let n = name.to_str().unwrap_or("");
        let ft = entry.file_type()?;
        if n.ends_with(TMP_SUFFIX) && ft.is_file() {
            fs::remove_file(entry.path())?;
            removed += 1;
        } else if n.ends_with(TMP_DIR_SUFFIX) && ft.is_dir() && !ft.is_symlink() {
            fs::remove_dir_all(entry.path())?;
            removed += 1;
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_overwrites_and_leaves_no_temp() {
        let d = tempfile::tempdir().unwrap();
        let tmp = d.path().join(".galpi/tmp");
        let target = d.path().join("a.md");
        replace_atomic(&tmp, &target, "첫 판".as_bytes()).unwrap();
        replace_atomic(&tmp, &target, "둘째 판".as_bytes()).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "둘째 판");
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
    }

    #[test]
    fn publish_new_never_overwrites() {
        let d = tempfile::tempdir().unwrap();
        let tmp = d.path().join("t");
        let target = d.path().join("workspace.json");
        fs::write(&target, b"author's file").unwrap();
        let err = publish_new(&tmp, &target, b"ours").unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&target).unwrap(), b"author's file");
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
    }

    #[test]
    fn publish_new_dir_is_all_or_nothing() {
        let d = tempfile::tempdir().unwrap();
        let tmp = d.path().join(".galpi/tmp");
        let target = d.path().join("episodes/000001-ab");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        publish_new_dir(
            &tmp,
            &target,
            &[("episode.json", b"{}"), ("manuscript.md", b"")],
        )
        .unwrap();
        assert_eq!(fs::read(target.join("episode.json")).unwrap(), b"{}");
        assert!(target.join("manuscript.md").exists());
        // Existing target: refused, original untouched, no staging left behind.
        fs::write(target.join("manuscript.md"), "작가 원고").unwrap();
        let err = publish_new_dir(&tmp, &target, &[("manuscript.md", b"x")]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            fs::read_to_string(target.join("manuscript.md")).unwrap(),
            "작가 원고"
        );
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
        // Interrupted staging folder is cleaned up.
        fs::create_dir_all(tmp.join(format!("half{TMP_DIR_SUFFIX}"))).unwrap();
        fs::write(tmp.join(format!("half{TMP_DIR_SUFFIX}/episode.json")), b"{").unwrap();
        assert_eq!(cleanup_tmp(&tmp).unwrap(), 1);
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
    }

    #[test]
    fn cleanup_only_removes_our_temp_files() {
        let d = tempfile::tempdir().unwrap();
        let tmp = d.path().join("tmp");
        fs::create_dir_all(tmp.join(format!("dir{TMP_SUFFIX}"))).unwrap();
        fs::write(tmp.join(format!("abc{TMP_SUFFIX}")), b"x").unwrap();
        fs::write(tmp.join("notes.txt"), b"keep").unwrap();
        fs::write(d.path().join(format!("outside{TMP_SUFFIX}")), b"keep").unwrap();
        assert_eq!(cleanup_tmp(&tmp).unwrap(), 1);
        assert!(tmp.join("notes.txt").exists());
        assert!(tmp.join(format!("dir{TMP_SUFFIX}")).exists());
        assert!(d.path().join(format!("outside{TMP_SUFFIX}")).exists());
        assert_eq!(cleanup_tmp(&d.path().join("missing")).unwrap(), 0);
    }
}
