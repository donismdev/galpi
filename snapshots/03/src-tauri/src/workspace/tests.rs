//! Session 02 acceptance tests (S02.A / S02.B / S02.C) against real temp folders.

use super::*;
use std::collections::BTreeMap;

fn opts(title: &str) -> CreateOptions {
    CreateOptions {
        title: title.into(),
        request_id: "req-1".into(),
        track_label: "본편".into(),
        confirm_non_empty: false,
    }
}

fn created(path: &Path, o: &CreateOptions) -> Manifest {
    match create(path, o, None).unwrap() {
        CreateOutcome::Created(m) => m,
        CreateOutcome::Interrupted(s) => panic!("interrupted at {s:?}"),
    }
}

/// Every file under `dir` (relative path → content hash).
fn tree_hashes(dir: &Path) -> BTreeMap<String, String> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
        for e in fs::read_dir(dir).unwrap() {
            let e = e.unwrap();
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap().display().to_string();
            if e.file_type().unwrap().is_dir() {
                out.insert(format!("{rel}/"), String::new());
                walk(base, &p, out);
            } else {
                out.insert(rel, content_hash(&fs::read(&p).unwrap()));
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

fn korean_dir(base: &Path) -> PathBuf {
    let p = base.join("내 소설 (초고) 2026");
    fs::create_dir_all(&p).unwrap();
    p
}

// ------------------------------------------------------------ S02.A

#[test]
fn s02a_create_close_reopen_keeps_id_on_korean_space_paren_path() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    assert_eq!(inspect(&dir, "새 작품").unwrap().kind, FolderKind::Empty);

    let m = created(&dir, &opts("잿빛 항구"));
    assert_eq!(m.schema_version, SCHEMA_VERSION);
    assert_eq!(m.story_tracks.len(), 1);
    for d in LAYOUT_DIRS {
        assert!(dir.join(d).is_dir(), "{d}");
    }
    assert!(!dir.join(INIT_MARKER).exists());

    let s1 = open(&dir).unwrap();
    assert_eq!(s1.workspace_id, m.workspace_id);
    assert_eq!(s1.mode, OpenMode::ReadWrite);
    let first_session = s1.session_id.clone();
    drop(s1); // close

    let s2 = open(&dir).unwrap();
    assert_eq!(s2.workspace_id, m.workspace_id);
    assert_eq!(s2.title, "잿빛 항구");
    assert_ne!(s2.session_id, first_session);
    assert!(s2.summary().root.contains("내 소설 (초고) 2026"));
    assert!(!s2.summary().root.starts_with(r"\\?\"));
}

#[test]
fn retried_create_does_not_make_a_second_work() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    let m = created(&dir, &opts("잿빛 항구"));
    let again = create(&dir, &opts("잿빛 항구"), None);
    assert!(
        matches!(again, Err(WsError::AlreadyWorkspace { workspace_id }) if workspace_id == m.workspace_id)
    );
}

// ------------------------------------------------------------ S02.B

#[test]
fn s02b_interrupted_init_resumes_with_same_id_at_every_step() {
    for step in [
        InitStep::AfterMarker,
        InitStep::AfterDirs,
        InitStep::AfterManifest,
    ] {
        let base = tempfile::tempdir().unwrap();
        let dir = korean_dir(base.path());
        let out = create(&dir, &opts("잿빛 항구"), Some(step)).unwrap();
        assert!(matches!(out, CreateOutcome::Interrupted(s) if s == step));

        let info = inspect(&dir, "x").unwrap();
        let id = match step {
            InitStep::AfterManifest => {
                // Commit point passed: it already is a work; opening clears the stale marker.
                assert_eq!(info.kind, FolderKind::Workspace);
                let s = open(&dir).unwrap();
                assert!(s.recovery.init_marker_cleared);
                assert!(!dir.join(INIT_MARKER).exists());
                s.workspace_id.clone()
            }
            _ => {
                assert_eq!(info.kind, FolderKind::IncompleteInit, "{step:?}");
                let marker_id = info.workspace_id.clone().unwrap();
                let m = created(&dir, &opts("다른 제목은 무시됨"));
                assert_eq!(m.workspace_id, marker_id, "{step:?}");
                assert_eq!(m.title, "잿빛 항구");
                marker_id
            }
        };
        assert_eq!(open(&dir).unwrap().workspace_id, id);
    }
}

#[test]
fn s02b_leftover_temp_files_are_cleaned_on_open() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    created(&dir, &opts("t"));
    let tmp = dir.join(TMP_DIR);
    fs::write(tmp.join(format!("half{}", atomic::TMP_SUFFIX)), b"partial").unwrap();
    fs::write(tmp.join("someone-elses.txt"), b"keep").unwrap();
    let s = open(&dir).unwrap();
    assert_eq!(s.recovery.tmp_files_removed, 1);
    assert!(tmp.join("someone-elses.txt").exists());
}

#[test]
fn s02b_newer_schema_opens_read_only_and_is_never_modified() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    fs::write(
        dir.join(MANIFEST_FILE),
        r#"{"schemaVersion": 7, "workspaceId": "future", "title": "미래 작품", "newThing": [1,2]}"#,
    )
    .unwrap();
    let before = tree_hashes(&dir);
    let info = inspect(&dir, "x").unwrap();
    assert_eq!(info.kind, FolderKind::NewerWorkspace);
    assert_eq!(info.schema_version, Some(7));

    let s = open(&dir).unwrap();
    assert_eq!(s.mode, OpenMode::ReadOnly);
    assert_eq!(s.read_only_reason, Some(ReadOnlyReason::NewerSchema));
    assert!(matches!(
        s.write_file("r", "a.md", b"x", Expect::Absent),
        Err(WsError::ReadOnly { .. })
    ));
    assert!(matches!(
        create(&dir, &opts("x"), None),
        Err(WsError::NewerSchema { found: 7, .. })
    ));
    drop(s);
    assert_eq!(
        tree_hashes(&dir),
        before,
        "newer work folder must stay byte-identical"
    );
}

#[test]
fn s02b_invalid_manifest_is_reported_and_untouched() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    fs::write(dir.join(MANIFEST_FILE), b"{ not json").unwrap();
    let before = tree_hashes(&dir);
    assert_eq!(
        inspect(&dir, "x").unwrap().kind,
        FolderKind::InvalidWorkspace
    );
    assert!(matches!(open(&dir), Err(WsError::InvalidManifest { .. })));
    assert!(matches!(
        create(&dir, &opts("x"), None),
        Err(WsError::InvalidManifest { .. })
    ));
    assert_eq!(tree_hashes(&dir), before);
}

#[test]
fn s02b_same_folder_opened_twice_second_is_read_only() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    created(&dir, &opts("t"));
    let first = open(&dir).unwrap();
    let second = open(&dir).unwrap();
    assert_eq!(first.mode, OpenMode::ReadWrite);
    assert_eq!(second.mode, OpenMode::ReadOnly);
    assert_eq!(second.read_only_reason, Some(ReadOnlyReason::LockedByOther));
    assert!(matches!(
        second.write_file("r", "a.md", b"x", Expect::Absent),
        Err(WsError::ReadOnly {
            reason: ReadOnlyReason::LockedByOther
        })
    ));
    drop(first);
    // Lock released on close: the next open writes again.
    let third = open(&dir).unwrap();
    assert_eq!(third.mode, OpenMode::ReadWrite);
}

#[test]
fn s02b_read_only_manifest_opens_read_only() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    created(&dir, &opts("t"));
    let mf = dir.join(MANIFEST_FILE);
    let mut perm = fs::metadata(&mf).unwrap().permissions();
    perm.set_readonly(true);
    fs::set_permissions(&mf, perm.clone()).unwrap();

    let s = open(&dir).unwrap();
    assert_eq!(s.mode, OpenMode::ReadOnly);
    assert_eq!(s.read_only_reason, Some(ReadOnlyReason::NoWritePermission));
    drop(s);

    #[allow(clippy::permissions_set_readonly_false)]
    perm.set_readonly(false);
    fs::set_permissions(&mf, perm).unwrap();
}

#[test]
fn missing_folder_and_file_are_distinct_errors() {
    let base = tempfile::tempdir().unwrap();
    assert!(matches!(
        inspect(&base.path().join("없는 폴더"), "x"),
        Err(WsError::NotFound { .. })
    ));
    let f = base.path().join("file.txt");
    fs::write(&f, b"x").unwrap();
    assert!(matches!(open(&f), Err(WsError::NotADirectory { .. })));
    assert!(matches!(
        open(base.path()),
        Err(WsError::NotAWorkspace { .. })
    ));
}

// ------------------------------------------------------------ S02.C

#[test]
fn s02c_unrelated_files_survive_create_and_need_confirmation() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    fs::write(dir.join("중요한 원고.txt"), "절대 바뀌면 안 되는 문장\r\n").unwrap();
    fs::create_dir_all(dir.join("자료")).unwrap();
    fs::write(dir.join("자료/지도.png"), [0u8, 159, 146, 150]).unwrap();
    let before = tree_hashes(&dir);

    let info = inspect(&dir, "새 작품").unwrap();
    assert_eq!(info.kind, FolderKind::NonEmpty);
    assert!(info.conflicts.is_empty());
    assert_eq!(info.entry_count, 2);

    assert!(matches!(
        create(&dir, &opts("t"), None),
        Err(WsError::NeedsConfirmation { entry_count: 2 })
    ));
    assert_eq!(
        tree_hashes(&dir),
        before,
        "unconfirmed attempt writes nothing"
    );

    let mut o = opts("t");
    o.confirm_non_empty = true;
    created(&dir, &o);
    let after = tree_hashes(&dir);
    for (k, v) in &before {
        assert_eq!(after.get(k), Some(v), "{k} changed");
    }
}

#[test]
fn s02c_name_conflicts_are_reported_and_untouched() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    fs::write(dir.join("Episodes"), "작가가 만든 같은 이름 파일").unwrap();
    fs::create_dir_all(dir.join("lore")).unwrap();
    fs::write(dir.join("lore/내 설정.md"), "# 설정").unwrap();
    let before = tree_hashes(&dir);

    let info = inspect(&dir, "새 작품").unwrap();
    assert_eq!(
        info.conflicts,
        vec!["Episodes".to_string(), "lore".to_string()]
    );
    let suggestion = info.suggestion.clone().unwrap();
    assert!(suggestion.ends_with("새 작품"));

    let mut o = opts("새 작품");
    o.confirm_non_empty = true;
    match create(&dir, &o, None) {
        Err(WsError::NameConflicts {
            conflicts,
            suggestion: Some(s),
        }) => {
            assert_eq!(conflicts.len(), 2);
            assert_eq!(s, suggestion);
        }
        other => panic!("expected NameConflicts, got {:?}", other.err()),
    }
    assert_eq!(
        tree_hashes(&dir),
        before,
        "conflicting folder must stay byte-identical"
    );

    // The suggested subfolder works and leaves the parent alone.
    let sub = PathBuf::from(&suggestion);
    fs::create_dir_all(&sub).unwrap();
    created(&sub, &o);
    let after = tree_hashes(&dir);
    for (k, v) in &before {
        assert_eq!(after.get(k), Some(v), "{k} changed");
    }
}

#[test]
fn s02c_writes_cannot_leave_the_root_or_touch_app_dir() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    fs::write(base.path().join("outside.md"), b"outside").unwrap();
    created(&dir, &opts("t"));
    let s = open(&dir).unwrap();
    for rel in [
        "../outside.md",
        "episodes/../../outside.md",
        "C:/Windows/x.md",
        ".galpi/lock",
        ".GALPI/tmp/x",
    ] {
        assert!(
            s.write_file("r", rel, b"pwned", Expect::Absent).is_err(),
            "{rel}"
        );
    }
    assert_eq!(
        fs::read(base.path().join("outside.md")).unwrap(),
        b"outside"
    );
}

#[test]
fn write_requires_the_version_that_was_read_and_is_idempotent() {
    let base = tempfile::tempdir().unwrap();
    let dir = korean_dir(base.path());
    created(&dir, &opts("t"));
    let s = open(&dir).unwrap();
    let rel = "episodes/test/manuscript.md";

    let h1 = s
        .write_file(
            "req-a",
            rel,
            "서린은 손끝에 불을 피웠다.".as_bytes(),
            Expect::Absent,
        )
        .unwrap();
    // Same request again: no second write, same result.
    assert_eq!(
        s.write_file("req-a", rel, b"ignored", Expect::Absent)
            .unwrap(),
        h1
    );
    // New request expecting "absent" now conflicts and writes nothing.
    assert!(matches!(
        s.write_file("req-b", rel, b"x", Expect::Absent),
        Err(WsError::WriteConflict {
            expected: None,
            actual: Some(_)
        })
    ));

    // External edit → our stale expectation is refused, external text kept.
    fs::write(dir.join(rel), "외부에서 고친 문장").unwrap();
    assert!(matches!(
        s.write_file("req-c", rel, b"mine", Expect::Hash(h1.clone())),
        Err(WsError::WriteConflict { .. })
    ));
    assert_eq!(
        fs::read_to_string(dir.join(rel)).unwrap(),
        "외부에서 고친 문장"
    );

    let (_, disk) = s.read_file(rel).unwrap();
    let h2 = s
        .write_file(
            "req-d",
            rel,
            "서린은 남은 불씨를 감지했다.".as_bytes(),
            Expect::Hash(disk),
        )
        .unwrap();
    assert_ne!(h1, h2);
    assert_eq!(
        fs::read_to_string(dir.join(rel)).unwrap(),
        "서린은 남은 불씨를 감지했다."
    );
    assert_eq!(fs::read_dir(dir.join(TMP_DIR)).unwrap().count(), 0);
}

#[test]
fn ensure_leaf_folder_creates_only_the_last_component() {
    let base = tempfile::tempdir().unwrap();
    let leaf = base.path().join("새 작품 (2)");
    ensure_leaf_folder(&leaf).unwrap();
    assert!(leaf.is_dir());
    ensure_leaf_folder(&leaf).unwrap(); // existing folder is fine
    assert!(matches!(
        ensure_leaf_folder(&base.path().join("없음/깊은/폴더")),
        Err(WsError::NotFound { .. })
    ));
    assert!(!base.path().join("없음").exists());
    let f = base.path().join("file");
    fs::write(&f, b"x").unwrap();
    assert!(ensure_leaf_folder(&f).is_err());
    assert_eq!(fs::read(&f).unwrap(), b"x");
}
