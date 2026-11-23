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

/// Removes leftover temp files written by `write_temp`. Only direct children of `tmp_dir`
/// that are regular files ending in `TMP_SUFFIX` are touched.
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
        let is_ours = name.to_str().is_some_and(|n| n.ends_with(TMP_SUFFIX));
        if is_ours && entry.file_type()?.is_file() {
            fs::remove_file(entry.path())?;
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
