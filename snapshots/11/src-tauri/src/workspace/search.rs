//! Work search index (session 11).
//!
//! The index is a cache: a SQLite file in the app's local data folder, never inside the work.
//! It is rebuilt from the work's own files at any time (deleting it loses nothing).
//!
//! - Cache file: `<app local data>/index/<key>.sqlite`, `key` = first 32 hex of
//!   sha256(workspaceId NUL lowercase canonical root). A copy of a work at another path has its
//!   own cache (same workspaceId, different key).
//! - Schema (`INDEX_SCHEMA` = 1): `meta(key, value)`, `docs` (one row per source document with
//!   a size/mtime stamp and a content hash), `paras` (paragraph text + char offset in the
//!   document), `fts` = `fts5(text, tokenize = 'trigram')` keyed by `paras.rowid`.
//!   A missing/corrupt file or another schema/workspace is deleted and rebuilt.
//! - Sources: working manuscripts (`manuscript`), committed revisions (`revision`, history only
//!   when asked), summaries (`summary`), next-episode notes (`note`), world cards (`card`, title =
//!   name, aliases kept), events (`event`, title + detail).
//! - Offsets are Unicode scalar (char) indices into the document text with the BOM removed and
//!   CRLF turned into LF — the same text the editors show.
//! - Search: 3+ chars → FTS5 trigram phrase (substring, case-insensitive), then verified in the
//!   original paragraph; 1–2 chars → direct scan of the paragraph text in pages of
//!   `SHORT_SCAN_PAGE` paragraphs (`next` continues), so even one character eventually finds
//!   every match. Titles, aliases and episode numbers are looked up separately (`meta`).
//! - Sync: a stamp (size + mtime) skips unchanged files; a changed stamp re-hashes; only a
//!   changed hash re-indexes that document. Documents whose source is gone are removed.

use super::error::WsError;
use super::manifest::strip_bom;
use super::{WorkspaceSession, content_hash, episodes, history, lore, timelines};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const INDEX_SCHEMA: i64 = 1;
pub const SHORT_SCAN_PAGE: i64 = 5000;
const SNIPPET: usize = 24;

fn db_err(e: rusqlite::Error) -> WsError {
    WsError::Io {
        kind: "Index".into(),
        detail: e.to_string(),
    }
}

pub fn cache_key(workspace_id: &str, root: &Path) -> String {
    let canon = dunce::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut h = Sha256::new();
    h.update(workspace_id.as_bytes());
    h.update([0]);
    h.update(canon.to_string_lossy().to_lowercase().as_bytes());
    h.finalize()
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn cache_path(cache_dir: &Path, workspace_id: &str, root: &Path) -> PathBuf {
    cache_dir
        .join("index")
        .join(format!("{}.sqlite", cache_key(workspace_id, root)))
}

pub fn remove_db_files(path: &Path) {
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut p = path.as_os_str().to_owned();
        p.push(suffix);
        let _ = fs::remove_file(PathBuf::from(p));
    }
}

const SCHEMA_SQL: &str = "
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs(
  doc_key TEXT PRIMARY KEY, kind TEXT NOT NULL, doc_id TEXT NOT NULL, rev_id TEXT,
  episode_id TEXT, episode_number INTEGER, title TEXT NOT NULL, aliases TEXT NOT NULL,
  rel TEXT NOT NULL, stamp TEXT NOT NULL, hash TEXT NOT NULL, history INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paras(
  id INTEGER PRIMARY KEY, doc_key TEXT NOT NULL, para INTEGER NOT NULL, start INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS paras_doc ON paras(doc_key);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(text, tokenize = 'trigram');
";

/// Opens (or recreates) the index at `path` for this work. Returns the connection and whether
/// the file was (re)created.
pub fn open_index(
    path: &Path,
    workspace_id: &str,
    root: &Path,
) -> Result<(Connection, bool), WsError> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let expect_root = cache_key(workspace_id, root);
    let usable = |c: &Connection| -> bool {
        let get = |k: &str| -> Option<String> {
            c.query_row("SELECT value FROM meta WHERE key = ?1", [k], |r| r.get(0))
                .optional()
                .ok()
                .flatten()
        };
        get("schema").as_deref() == Some(&INDEX_SCHEMA.to_string())
            && get("key").as_deref() == Some(expect_root.as_str())
    };
    if path.exists() {
        if let Ok(c) = Connection::open(path) {
            let ok = c
                .query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
                .map(|s| s == "ok")
                .unwrap_or(false);
            if ok && usable(&c) {
                return Ok((c, false));
            }
        }
        remove_db_files(path); // corrupt, other schema or other work: rebuild
    }
    let c = Connection::open(path).map_err(db_err)?;
    c.execute_batch(SCHEMA_SQL).map_err(db_err)?;
    c.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema', ?1)",
        [INDEX_SCHEMA.to_string()],
    )
    .map_err(db_err)?;
    c.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('key', ?1)",
        [&expect_root],
    )
    .map_err(db_err)?;
    Ok((c, true))
}

/// True when the bundled SQLite has FTS5 with the trigram tokenizer (S11.A).
pub fn fts5_trigram_available() -> bool {
    Connection::open_in_memory()
        .and_then(|c| c.execute_batch("CREATE VIRTUAL TABLE t USING fts5(x, tokenize = 'trigram'); INSERT INTO t VALUES ('불씨를 감지했다'); SELECT * FROM t WHERE t MATCH '\"감지했\"';"))
        .is_ok()
}

// ---------------------------------------------------------------- sources

#[derive(Clone, Debug)]
struct Source {
    key: String,
    kind: &'static str,
    doc_id: String,
    rev_id: Option<String>,
    episode_id: Option<String>,
    episode_number: Option<u32>,
    title: String,
    aliases: Vec<String>,
    rel: String,
    files: Vec<String>,
    history: bool,
}

fn collect(s: &WorkspaceSession) -> Result<Vec<Source>, WsError> {
    let mut out = Vec::new();
    let eps = episodes::list(s)?.episodes;
    for ep in &eps {
        let label = if ep.title.is_empty() {
            format!("{}화", ep.number)
        } else {
            format!("{}화 · {}", ep.number, ep.title)
        };
        out.push(Source {
            key: format!("manuscript:{}", ep.episode_id),
            kind: "manuscript",
            doc_id: ep.episode_id.clone(),
            rev_id: None,
            episode_id: Some(ep.episode_id.clone()),
            episode_number: Some(ep.number),
            title: label.clone(),
            aliases: Vec::new(),
            rel: ep.manuscript_rel.clone(),
            files: vec![ep.manuscript_rel.clone()],
            history: false,
        });
        for r in history::list(s, &ep.episode_id)?.revisions {
            let rel = format!("{}/manuscript.md", r.folder);
            out.push(Source {
                key: format!("revision:{}:{}", ep.episode_id, r.revision_id),
                kind: "revision",
                doc_id: ep.episode_id.clone(),
                rev_id: Some(r.revision_id.clone()),
                episode_id: Some(ep.episode_id.clone()),
                episode_number: Some(ep.number),
                title: format!("{label} · r{}", r.ordinal),
                aliases: Vec::new(),
                rel: rel.clone(),
                files: vec![rel],
                history: true,
            });
        }
        for (kind, rel, what) in [
            (
                "summary",
                format!("summaries/{}/summary.md", ep.episode_id),
                "요약",
            ),
            (
                "note",
                format!("notes/next/{}.md", ep.episode_id),
                "다음 화 메모",
            ),
        ] {
            if s.root.join(&rel).is_file() {
                out.push(Source {
                    key: format!("{kind}:{}", ep.episode_id),
                    kind,
                    doc_id: ep.episode_id.clone(),
                    rev_id: None,
                    episode_id: Some(ep.episode_id.clone()),
                    episode_number: Some(ep.number),
                    title: format!("{}화 {what}", ep.number),
                    aliases: Vec::new(),
                    rel: rel.clone(),
                    files: vec![rel],
                    history: false,
                });
            }
        }
    }
    for c in lore::list(s)?.cards {
        out.push(Source {
            key: format!("card:{}", c.card_id),
            kind: "card",
            doc_id: c.card_id.clone(),
            rev_id: None,
            episode_id: None,
            episode_number: None,
            title: c.name.clone(),
            aliases: c.aliases.clone(),
            rel: format!("{}/card.md", c.dir),
            files: vec![format!("{}/card.md", c.dir), format!("{}/card.json", c.dir)],
            history: false,
        });
    }
    let d = timelines::load(s)?;
    for e in d.events {
        let rel = format!("{}/{}.json", timelines::EVENTS_DIR, e.record.event_id);
        out.push(Source {
            key: format!("event:{}", e.record.event_id),
            kind: "event",
            doc_id: e.record.event_id.clone(),
            rev_id: None,
            episode_id: e.record.episode_id.clone(),
            episode_number: e.episode_number,
            title: e.record.title.clone(),
            aliases: Vec::new(),
            rel: rel.clone(),
            // the episode number can change without the event file changing
            files: vec![rel],
            history: false,
        });
    }
    Ok(out)
}

fn stamp(s: &WorkspaceSession, src: &Source) -> String {
    let mut parts: Vec<String> = src
        .files
        .iter()
        .map(|f| match fs::metadata(s.root.join(f)) {
            Ok(m) => format!("{}:{:?}", m.len(), m.modified().ok()),
            Err(_) => "missing".into(),
        })
        .collect();
    parts.push(format!("ep:{:?}", src.episode_number));
    parts.push(format!("t:{}|{}", src.title, src.aliases.join("\u{1}")));
    parts.join(";")
}

/// The text a document is searched by, or None when it cannot be read as UTF-8.
fn load_text(s: &WorkspaceSession, src: &Source) -> Result<Option<(String, String)>, WsError> {
    let mut bytes = Vec::new();
    for f in &src.files {
        match fs::read(s.root.join(f)) {
            Ok(b) => bytes.extend_from_slice(&b),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        bytes.push(0);
    }
    let hash = content_hash(&bytes);
    let text = match src.kind {
        "event" => {
            let b = fs::read(s.root.join(&src.rel))?;
            let v: serde_json::Value = match serde_json::from_slice(strip_bom(&b)) {
                Ok(v) => v,
                Err(_) => return Ok(None),
            };
            let t = v.get("title").and_then(|x| x.as_str()).unwrap_or("");
            let d = v.get("detail").and_then(|x| x.as_str()).unwrap_or("");
            format!("{t}\n\n{d}")
        }
        _ => match fs::read(s.root.join(&src.rel)) {
            Ok(b) => match String::from_utf8(strip_bom(&b).to_vec()) {
                Ok(t) => t,
                Err(_) => return Ok(None), // non-UTF-8 manuscript (04): not indexed, reported
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(e) => return Err(e.into()),
        },
    };
    Ok(Some((text.replace("\r\n", "\n"), hash)))
}

/// Paragraphs separated by blank lines, with their char offset in the document.
fn paragraphs(text: &str) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut start = 0usize; // char offset
    let mut cur = String::new();
    let mut cur_start = 0usize;
    for line in text.split('\n') {
        let len = line.chars().count();
        if line.trim().is_empty() {
            if !cur.is_empty() {
                out.push((cur_start, std::mem::take(&mut cur)));
            }
        } else {
            if cur.is_empty() {
                cur_start = start;
            } else {
                cur.push('\n');
            }
            cur.push_str(line);
        }
        start += len + 1;
    }
    if !cur.is_empty() {
        out.push((cur_start, cur));
    }
    out
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncStats {
    pub scanned: usize,
    /// Documents (re)indexed because their content hash changed or they are new.
    pub changed: Vec<String>,
    pub removed: Vec<String>,
    /// Documents whose stamp changed but content did not (e.g. saved without changes).
    pub touched: usize,
    /// Sources that could not be read as UTF-8 (kept out of the index).
    pub unreadable: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum SyncError {
    Cancelled,
    Failed(WsError),
}

impl From<WsError> for SyncError {
    fn from(e: WsError) -> Self {
        SyncError::Failed(e)
    }
}

impl From<rusqlite::Error> for SyncError {
    fn from(e: rusqlite::Error) -> Self {
        SyncError::Failed(db_err(e))
    }
}

/// Brings the index in line with the work's files. Reads the work only.
pub fn sync(
    c: &mut Connection,
    s: &WorkspaceSession,
    cancel: &AtomicBool,
) -> Result<SyncStats, SyncError> {
    let sources = collect(s)?;
    let mut known: HashMap<String, (String, String)> = HashMap::new();
    {
        let mut st = c.prepare("SELECT doc_key, stamp, hash FROM docs")?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, String>(1)?, r.get::<_, String>(2)?),
            ))
        })?;
        for r in rows {
            let (k, v) = r?;
            known.insert(k, v);
        }
    }
    let mut stats = SyncStats {
        scanned: sources.len(),
        ..Default::default()
    };
    for src in &sources {
        if cancel.load(Ordering::Relaxed) {
            return Err(SyncError::Cancelled);
        }
        let st = stamp(s, src);
        let old = known.remove(&src.key);
        if old.as_ref().is_some_and(|(stp, _)| *stp == st) {
            continue;
        }
        let Some((text, hash)) = load_text(s, src)? else {
            stats.unreadable.push(src.key.clone());
            remove_doc(c, &src.key)?;
            continue;
        };
        if old.as_ref().is_some_and(|(_, h)| *h == hash) {
            c.execute(
                "UPDATE docs SET stamp = ?1 WHERE doc_key = ?2",
                params![st, src.key],
            )?;
            stats.touched += 1;
            continue;
        }
        let tx = c.transaction()?;
        remove_doc(&tx, &src.key)?;
        tx.execute(
            "INSERT INTO docs(doc_key, kind, doc_id, rev_id, episode_id, episode_number, title, aliases, rel, stamp, hash, history)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                src.key,
                src.kind,
                src.doc_id,
                src.rev_id,
                src.episode_id,
                src.episode_number,
                src.title,
                src.aliases.join("\u{1}"),
                src.rel,
                st,
                hash,
                src.history
            ],
        )?;
        for (i, (start, text)) in paragraphs(&text).into_iter().enumerate() {
            tx.execute(
                "INSERT INTO paras(doc_key, para, start, text) VALUES (?1, ?2, ?3, ?4)",
                params![src.key, i as i64, start as i64, text],
            )?;
            let id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO fts(rowid, text) VALUES (?1, ?2)",
                params![id, text],
            )?;
        }
        tx.commit()?;
        stats.changed.push(src.key.clone());
    }
    // sources that are gone (deleted, renamed, moved): no ghost results
    for key in known.into_keys() {
        remove_doc(c, &key)?;
        stats.removed.push(key);
    }
    stats.changed.sort();
    stats.removed.sort();
    Ok(stats)
}

fn remove_doc(c: &Connection, key: &str) -> Result<(), rusqlite::Error> {
    c.execute(
        "DELETE FROM fts WHERE rowid IN (SELECT id FROM paras WHERE doc_key = ?1)",
        [key],
    )?;
    c.execute("DELETE FROM paras WHERE doc_key = ?1", [key])?;
    c.execute("DELETE FROM docs WHERE doc_key = ?1", [key])?;
    Ok(())
}

/// Builds a fresh index next to `path` and swaps it in (generation switch). The old file serves
/// until the swap; a cancelled build leaves the old file untouched.
pub fn rebuild(
    path: &Path,
    s: &WorkspaceSession,
    cancel: &AtomicBool,
) -> Result<SyncStats, SyncError> {
    let (building, stats) = build_fresh(path, s, cancel)?;
    swap_in(&building, path)?;
    Ok(stats)
}

pub fn building_path(path: &Path) -> PathBuf {
    let mut b = path.as_os_str().to_owned();
    b.push(".building");
    PathBuf::from(b)
}

/// Step 1 of a rebuild: a complete new index in `<path>.building`. Removed again on failure.
pub fn build_fresh(
    path: &Path,
    s: &WorkspaceSession,
    cancel: &AtomicBool,
) -> Result<(PathBuf, SyncStats), SyncError> {
    let building = building_path(path);
    remove_db_files(&building);
    let result = (|| {
        let (mut c, _) = open_index(&building, &s.workspace_id, &s.root)?;
        let stats = sync(&mut c, s, cancel)?;
        drop(c);
        Ok(stats)
    })();
    match result {
        Ok(stats) => Ok((building, stats)),
        Err(e) => {
            remove_db_files(&building);
            Err(e)
        }
    }
}

/// Step 2: replace the current index file. Any connection to `path` must be closed first.
pub fn swap_in(building: &Path, path: &Path) -> Result<(), SyncError> {
    remove_db_files(path);
    fs::rename(building, path).map_err(|e| SyncError::Failed(e.into()))
}

pub fn delete_cache(path: &Path) {
    remove_db_files(path);
    remove_db_files(&building_path(path));
}

// ---------------------------------------------------------------- search

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    /// Merge committed revisions into the results (off by default).
    #[serde(default)]
    pub include_history: bool,
    /// Only these kinds (empty = all).
    #[serde(default)]
    pub kinds: Vec<String>,
    /// Continue a short (1–2 char) scan from here (`SearchResult.next`).
    #[serde(default)]
    pub cursor: Option<i64>,
    /// Inclusive episode number range (documents without an episode are excluded when set).
    #[serde(default)]
    pub episode_from: Option<u32>,
    #[serde(default)]
    pub episode_to: Option<u32>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub doc_key: String,
    pub kind: String,
    pub doc_id: String,
    pub rev_id: Option<String>,
    pub episode_id: Option<String>,
    pub episode_number: Option<u32>,
    pub title: String,
    pub para: i64,
    /// Char offset of the match in the document (see module docs).
    pub offset: i64,
    pub length: i64,
    pub before: String,
    pub matched: String,
    pub after: String,
    pub history: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetaHit {
    pub doc_key: String,
    pub kind: String,
    pub doc_id: String,
    pub title: String,
    /// title | alias | number
    pub by: String,
    pub value: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub query: String,
    /// fts (3+ chars) or scan (1–2 chars)
    pub path: String,
    pub hits: Vec<Hit>,
    pub meta: Vec<MetaHit>,
    /// Set when a short scan stopped at its page limit: pass it back as `cursor` for more.
    pub next: Option<i64>,
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// Char positions of `needle` in `hay`, case-insensitive per character (1:1 char mapping).
pub fn find_all_ci(hay: &str, needle: &str) -> Vec<usize> {
    let h: Vec<char> = hay.chars().map(fold).collect();
    let n: Vec<char> = needle.chars().map(fold).collect();
    if n.is_empty() || n.len() > h.len() {
        return Vec::new();
    }
    (0..=h.len() - n.len())
        .filter(|&i| h[i..i + n.len()] == n[..])
        .collect()
}

struct Row {
    id: i64,
    doc_key: String,
    para: i64,
    start: i64,
    text: String,
    kind: String,
    doc_id: String,
    rev_id: Option<String>,
    episode_id: Option<String>,
    episode_number: Option<u32>,
    title: String,
    history: bool,
}

const ROW_SELECT: &str = "SELECT p.id, p.doc_key, p.para, p.start, p.text, d.kind, d.doc_id, d.rev_id, d.episode_id, d.episode_number, d.title, d.history
  FROM paras p JOIN docs d ON d.doc_key = p.doc_key";

fn map_row(r: &rusqlite::Row) -> rusqlite::Result<Row> {
    Ok(Row {
        id: r.get(0)?,
        doc_key: r.get(1)?,
        para: r.get(2)?,
        start: r.get(3)?,
        text: r.get(4)?,
        kind: r.get(5)?,
        doc_id: r.get(6)?,
        rev_id: r.get(7)?,
        episode_id: r.get(8)?,
        episode_number: r.get(9)?,
        title: r.get(10)?,
        history: r.get(11)?,
    })
}

fn wanted(row: &Row, o: &SearchOptions) -> bool {
    (o.include_history || !row.history)
        && (o.kinds.is_empty() || o.kinds.contains(&row.kind))
        && (o.episode_from.is_none() && o.episode_to.is_none()
            || row.episode_number.is_some_and(|n| {
                o.episode_from.is_none_or(|f| n >= f) && o.episode_to.is_none_or(|t| n <= t)
            }))
}

fn hits_in(row: &Row, q: &str, out: &mut Vec<Hit>) {
    let chars: Vec<char> = row.text.chars().collect();
    let qlen = q.chars().count();
    for i in find_all_ci(&row.text, q) {
        let from = i.saturating_sub(SNIPPET);
        let to = (i + qlen + SNIPPET).min(chars.len());
        out.push(Hit {
            doc_key: row.doc_key.clone(),
            kind: row.kind.clone(),
            doc_id: row.doc_id.clone(),
            rev_id: row.rev_id.clone(),
            episode_id: row.episode_id.clone(),
            episode_number: row.episode_number,
            title: row.title.clone(),
            para: row.para,
            offset: row.start + i as i64,
            length: qlen as i64,
            before: chars[from..i].iter().collect(),
            matched: chars[i..i + qlen].iter().collect(),
            after: chars[i + qlen..to].iter().collect(),
            history: row.history,
        });
    }
}

const KIND_ORDER: [&str; 6] = ["manuscript", "summary", "note", "event", "card", "revision"];

pub fn search(c: &Connection, query: &str, o: &SearchOptions) -> Result<SearchResult, WsError> {
    let q = query.trim();
    let n = q.chars().count();
    let mut hits = Vec::new();
    let mut next = None;
    let path;
    if n == 0 {
        path = "none";
    } else if n >= 3 {
        path = "fts";
        let phrase = format!("\"{}\"", q.replace('"', "\"\""));
        let mut st = c.prepare(&format!("{ROW_SELECT} WHERE p.id IN (SELECT rowid FROM fts WHERE fts MATCH ?1) ORDER BY p.id")).map_err(db_err)?;
        let rows = st.query_map([phrase], map_row).map_err(db_err)?;
        for r in rows {
            let r = r.map_err(db_err)?;
            if wanted(&r, o) {
                hits_in(&r, q, &mut hits);
            }
        }
    } else {
        path = "scan";
        let from = o.cursor.unwrap_or(0);
        let mut st = c
            .prepare(&format!(
                "{ROW_SELECT} WHERE p.id > ?1 ORDER BY p.id LIMIT ?2"
            ))
            .map_err(db_err)?;
        let rows: Vec<Row> = st
            .query_map(params![from, SHORT_SCAN_PAGE], map_row)
            .map_err(db_err)?
            .collect::<Result<_, _>>()
            .map_err(db_err)?;
        if rows.len() as i64 == SHORT_SCAN_PAGE {
            next = rows.last().map(|r| r.id);
        }
        for r in &rows {
            if wanted(r, o) {
                hits_in(r, q, &mut hits);
            }
        }
    }
    hits.sort_by(|a, b| {
        let ka = KIND_ORDER.iter().position(|k| *k == a.kind).unwrap_or(9);
        let kb = KIND_ORDER.iter().position(|k| *k == b.kind).unwrap_or(9);
        (
            ka,
            a.episode_number.unwrap_or(u32::MAX),
            &a.doc_key,
            a.offset,
        )
            .cmp(&(
                kb,
                b.episode_number.unwrap_or(u32::MAX),
                &b.doc_key,
                b.offset,
            ))
    });
    Ok(SearchResult {
        query: q.into(),
        path: path.into(),
        meta: if n == 0 {
            Vec::new()
        } else {
            meta_search(c, q)?
        },
        hits,
        next,
    })
}

/// Titles, aliases and episode numbers (`3`, `3화`) — exact lookups, not body search.
fn meta_search(c: &Connection, q: &str) -> Result<Vec<MetaHit>, WsError> {
    let number: Option<u32> = q.strip_suffix('화').unwrap_or(q).trim().parse().ok();
    let mut st = c
        .prepare("SELECT doc_key, kind, doc_id, title, aliases, episode_number FROM docs WHERE history = 0 ORDER BY kind, title")
        .map_err(db_err)?;
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<u32>>(5)?,
            ))
        })
        .map_err(db_err)?;
    let mut out = Vec::new();
    for r in rows {
        let (doc_key, kind, doc_id, title, aliases, ep) = r.map_err(db_err)?;
        let hit = |by: &str, value: &str| MetaHit {
            doc_key: doc_key.clone(),
            kind: kind.clone(),
            doc_id: doc_id.clone(),
            title: title.clone(),
            by: by.into(),
            value: value.into(),
        };
        if kind == "manuscript" && number.is_some() && ep == number {
            out.push(hit("number", &format!("{}화", ep.unwrap_or_default())));
        } else if matches!(kind.as_str(), "card" | "event" | "manuscript")
            && !find_all_ci(&title, q).is_empty()
        {
            out.push(hit("title", &title));
        } else if let Some(a) = aliases
            .split('\u{1}')
            .find(|a| !a.is_empty() && !find_all_ci(a, q).is_empty())
        {
            out.push(hit("alias", a));
        }
    }
    Ok(out)
}

pub fn doc_count(c: &Connection) -> Result<i64, WsError> {
    c.query_row("SELECT count(*) FROM docs", [], |r| r.get(0))
        .map_err(db_err)
}

// ---------------------------------------------------------------- CH3: card-based lookups

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NameHit {
    /// Which of the card's names matched (the name or an alias).
    pub name: String,
    pub offset: i64,
    pub before: String,
    pub after: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeHits<T> {
    pub episode_id: String,
    pub number: u32,
    pub hits: Vec<T>,
}

/// (episode id, number, spans already taken, hits)
type EpisodeSlot = (String, u32, Vec<(i64, i64)>, Vec<NameHit>);

/// (1) ‘이름·별칭 본문 검색’: the card's name and aliases, literally, in working manuscripts.
/// A shorter name inside a longer one at the same place (린 in 서린) is reported once, as the
/// longer name.
pub fn name_search(
    c: &Connection,
    names: &[String],
    from: Option<u32>,
    to: Option<u32>,
) -> Result<Vec<EpisodeHits<NameHit>>, WsError> {
    let mut names: Vec<&String> = names.iter().filter(|n| !n.trim().is_empty()).collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.chars().count()));
    names.dedup();
    let o = SearchOptions {
        kinds: vec!["manuscript".into()],
        episode_from: from,
        episode_to: to,
        ..Default::default()
    };
    // (episode id, number) -> spans taken + hits
    let mut by_ep: Vec<EpisodeSlot> = Vec::new();
    for name in names {
        let mut cursor = None;
        loop {
            let r = search(
                c,
                name.trim(),
                &SearchOptions {
                    cursor,
                    ..o.clone()
                },
            )?;
            for h in r.hits {
                let (Some(ep), Some(num)) = (h.episode_id.clone(), h.episode_number) else {
                    continue;
                };
                let slot = match by_ep.iter().position(|x| x.0 == ep) {
                    Some(i) => i,
                    None => {
                        by_ep.push((ep, num, Vec::new(), Vec::new()));
                        by_ep.len() - 1
                    }
                };
                let e = &mut by_ep[slot];
                let (s, l) = (h.offset, h.length);
                if e.2.iter().any(|&(a, b)| s >= a && s + l <= a + b) {
                    continue; // inside a longer name already found here
                }
                e.2.push((s, l));
                e.3.push(NameHit {
                    name: name.trim().into(),
                    offset: s,
                    before: h.before,
                    after: h.after,
                });
            }
            match r.next {
                Some(n) => cursor = Some(n),
                None => break,
            }
        }
    }
    let mut out: Vec<EpisodeHits<NameHit>> = by_ep
        .into_iter()
        .map(|(episode_id, number, _, mut hits)| {
            hits.sort_by_key(|h| h.offset);
            EpisodeHits {
                episode_id,
                number,
                hits,
            }
        })
        .collect();
    out.sort_by_key(|e| e.number);
    Ok(out)
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkEvidence {
    /// event (13: sentence links will add `link`)
    pub kind: String,
    pub id: String,
    pub title: String,
}

/// (2) ‘연결된 회차’: episodes of events tied to this card (related card or state change),
/// counted by card ID — never by matching text.
pub fn linked_episodes(
    s: &WorkspaceSession,
    card_id: &str,
    from: Option<u32>,
    to: Option<u32>,
) -> Result<Vec<EpisodeHits<LinkEvidence>>, WsError> {
    let d = timelines::load(s)?;
    let mut out: Vec<EpisodeHits<LinkEvidence>> = Vec::new();
    for e in d.events {
        let tied = e.record.related_card_ids.iter().any(|x| x == card_id)
            || e.record.changes.iter().any(|c| c.entity_id == card_id);
        let (Some(ep), Some(num)) = (e.record.episode_id.clone(), e.episode_number) else {
            continue;
        };
        if !tied || from.is_some_and(|f| num < f) || to.is_some_and(|t| num > t) {
            continue;
        }
        let ev = LinkEvidence {
            kind: "event".into(),
            id: e.record.event_id.clone(),
            title: e.record.title.clone(),
        };
        match out.iter_mut().find(|x| x.episode_id == ep) {
            Some(x) => x.hits.push(ev),
            None => out.push(EpisodeHits {
                episode_id: ep,
                number: num,
                hits: vec![ev],
            }),
        }
    }
    out.sort_by_key(|e| e.number);
    Ok(out)
}

#[cfg(test)]
pub(crate) mod fixture {
    //! The S11 fixture: three episodes with the texts below, card 서린 (alias 린), an event in
    //! 3화 tied to 서린. Expected results are asserted in `tests`.
    use super::*;
    use crate::workspace::lore::{MetaPatch, TemplateId};
    use crate::workspace::manuscript::{LineEnding, save};
    use crate::workspace::timelines::{EventDraft, ViewMode};

    pub const EP1: &str = "서린은 손끝에 불을 피웠다.\n\n\"불씨\"라는 말이 50% 확률로 돌았다. snake_case 표기와 Hello World.";
    pub const EP2: &str = "편지에는 린이라고만 적혀 있었다.";
    pub const EP3: &str = "그 아이는 남은 불씨를 감지했다.\r\n\r\n서린이 웃었다.";

    pub struct Made {
        pub eps: Vec<String>,
        pub card: String,
        pub event: String,
    }

    pub fn write(s: &WorkspaceSession, eps: &[String], texts: &[&str]) {
        for (id, text) in eps.iter().zip(texts) {
            let p = crate::workspace::manuscript::file_path(s, id).unwrap();
            let h = fs::read(&p).ok().map(|b| content_hash(&b));
            save(
                s,
                &uuid::Uuid::new_v4().to_string(),
                id,
                text,
                h.as_deref(),
                false,
                LineEnding::Lf,
            )
            .unwrap();
        }
    }

    pub fn make(s: &WorkspaceSession, eps: Vec<String>) -> Made {
        write(s, &eps, &[EP1, EP2, EP3]);
        let card = lore::create(
            s,
            "c",
            TemplateId::Character,
            "서린",
            None,
            "# 서린\n\n미래 메모: 327화에서 회귀자임이 밝혀짐",
        )
        .unwrap();
        let doc = lore::read(s, &card.card_id).unwrap();
        lore::update_meta(
            s,
            "m",
            &card.card_id,
            &MetaPatch {
                aliases: Some(vec!["린".into()]),
                ..Default::default()
            },
            &doc.meta_hash,
        )
        .unwrap();
        let k = timelines::create_collection(s, "k", "주인공", ViewMode::Episode)
            .unwrap()
            .collection
            .collection_id;
        let ev = timelines::save_event(
            s,
            "e",
            None,
            None,
            &EventDraft {
                collection_ids: vec![k],
                title: "그 아이의 정체".into(),
                detail: "서린과 연결".into(),
                related_card_ids: vec![card.card_id.clone()],
                episode_id: Some(eps[2].clone()),
                ..Default::default()
            },
        )
        .unwrap();
        Made {
            eps,
            card: card.card_id,
            event: ev.record.event_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixture::*;
    use super::*;
    use crate::workspace::open;
    use crate::workspace::sample::make_sample;

    struct T {
        _b: tempfile::TempDir,
        dir: PathBuf,
        cache: PathBuf,
        s: WorkspaceSession,
        m: Made,
    }

    fn setup() -> T {
        let b = tempfile::tempdir().unwrap();
        let dir = b.path().join("검색 작품 (11)");
        let made = make_sample(&dir, "검색", 3).unwrap();
        let s = open(&dir).unwrap();
        let m = make(
            &s,
            made.episodes.iter().map(|e| e.episode_id.clone()).collect(),
        );
        let cache = b.path().join("appdata");
        T {
            _b: b,
            dir,
            cache,
            s,
            m,
        }
    }

    fn index(t: &T) -> Connection {
        let (mut c, _) = open_index(
            &cache_path(&t.cache, &t.s.workspace_id, &t.s.root),
            &t.s.workspace_id,
            &t.s.root,
        )
        .unwrap();
        sync(&mut c, &t.s, &AtomicBool::new(false)).unwrap();
        c
    }

    fn eps_of(r: &SearchResult, kind: &str) -> Vec<u32> {
        let mut v: Vec<u32> = r
            .hits
            .iter()
            .filter(|h| h.kind == kind)
            .filter_map(|h| h.episode_number)
            .collect();
        v.dedup();
        v
    }

    fn all_pages(c: &Connection, q: &str, o: &SearchOptions) -> Vec<Hit> {
        let mut out = Vec::new();
        let mut cursor = None;
        loop {
            let r = search(
                c,
                q,
                &SearchOptions {
                    cursor,
                    ..o.clone()
                },
            )
            .unwrap();
            out.extend(r.hits);
            match r.next {
                Some(n) => cursor = Some(n),
                None => return out,
            }
        }
    }

    // S11.A — FTS5 trigram available; expected documents per query.
    #[test]
    fn s11a_fts5_and_expected_hits() {
        assert!(fts5_trigram_available());
        let t = setup();
        let c = index(&t);
        let o = SearchOptions::default();
        let q = |s: &str| search(&c, s, &o).unwrap();
        assert_eq!(
            (q("린").path.as_str(), eps_of(&q("린"), "manuscript")),
            ("scan", vec![1, 2, 3])
        );
        assert_eq!(
            (q("서린").path.as_str(), eps_of(&q("서린"), "manuscript")),
            ("scan", vec![1, 3])
        );
        assert_eq!(
            (
                q("감지했다").path.as_str(),
                eps_of(&q("감지했다"), "manuscript")
            ),
            ("fts", vec![3])
        );
        assert_eq!(eps_of(&q("불씨"), "manuscript"), vec![1, 3]);
        assert_eq!(eps_of(&q("hello world"), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("HELLO"), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("\"불씨\""), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("%"), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("_"), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("50%"), "manuscript"), vec![1]);
        assert_eq!(eps_of(&q("snake_case"), "manuscript"), vec![1]);
        // offsets point into the LF-normalized text (3화 is saved with CRLF in the fixture text)
        let h = q("서린")
            .hits
            .into_iter()
            .find(|h| h.episode_number == Some(3) && h.kind == "manuscript")
            .unwrap();
        let text = EP3.replace("\r\n", "\n");
        let at: String = text.chars().skip(h.offset as usize).take(2).collect();
        assert_eq!(at, "서린");
        // other kinds: card body, event
        assert!(q("회귀자").hits.iter().any(|h| h.kind == "card"));
        assert!(
            q("그 아이의 정체")
                .hits
                .iter()
                .any(|h| h.kind == "event" && h.doc_id == t.m.event)
        );
        // metadata: name, alias, episode number
        assert!(
            q("서린")
                .meta
                .iter()
                .any(|m| m.kind == "card" && m.by == "title")
        );
        assert!(
            q("린")
                .meta
                .iter()
                .any(|m| m.kind == "card" && m.by == "title" || m.by == "alias")
        );
        assert!(
            q("3화")
                .meta
                .iter()
                .any(|m| m.by == "number" && m.doc_id == t.m.eps[2])
        );
        // one character over the whole range, page by page, ends with every match
        let all = all_pages(&c, "불", &o);
        let mut eps: Vec<u32> = all
            .iter()
            .filter(|h| h.kind == "manuscript")
            .filter_map(|h| h.episode_number)
            .collect();
        eps.dedup();
        assert_eq!(eps, vec![1, 3]);
        assert_eq!(
            all.iter()
                .filter(|h| h.kind == "manuscript" && h.episode_number == Some(1))
                .count(),
            2
        );
    }

    #[test]
    fn short_scan_pages_until_the_end() {
        let t = setup();
        let mut c = index(&t);
        // add many paragraphs so one page is not enough
        let big: String = (0..(SHORT_SCAN_PAGE + 20))
            .map(|i| format!("줄 {i}\n\n"))
            .collect::<String>()
            + "마지막에 휘";
        write(&t.s, &t.m.eps[1..2], &[&big]);
        sync(&mut c, &t.s, &AtomicBool::new(false)).unwrap();
        let first = search(&c, "휘", &SearchOptions::default()).unwrap();
        assert!(first.next.is_some());
        assert_eq!(all_pages(&c, "휘", &SearchOptions::default()).len(), 1);
    }

    // S11.B — only the changed document is re-indexed; deletes/renames leave no ghosts.
    #[test]
    fn s11b_incremental_and_no_ghosts() {
        let t = setup();
        let mut c = index(&t);
        let none = AtomicBool::new(false);
        assert!(sync(&mut c, &t.s, &none).unwrap().changed.is_empty());
        let p = crate::workspace::manuscript::file_path(&t.s, &t.m.eps[1]).unwrap();
        fs::write(&p, "편지에는 린이라고만 적혀 있었다.\n밖에서 고친 줄").unwrap();
        let st = sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(st.changed, vec![format!("manuscript:{}", t.m.eps[1])]);
        assert!(st.removed.is_empty());
        assert_eq!(
            eps_of(
                &search(&c, "밖에서 고친", &SearchOptions::default()).unwrap(),
                "manuscript"
            ),
            vec![2]
        );
        // same bytes rewritten: stamp changes, content does not
        let b = fs::read(&p).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&p, &b).unwrap();
        let st = sync(&mut c, &t.s, &none).unwrap();
        assert!(st.changed.is_empty());
        // card folder moved outside the app → same key, new path, old text not duplicated
        let card = lore::find(&t.s, &t.m.card).unwrap();
        fs::create_dir_all(t.s.root.join("lore/characters/주연")).unwrap();
        fs::rename(
            t.s.root.join(&card.dir),
            t.s.root.join(format!("lore/characters/주연/{}", t.m.card)),
        )
        .unwrap();
        sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(
            search(&c, "회귀자", &SearchOptions::default())
                .unwrap()
                .hits
                .len(),
            1
        );
        // event deleted outside the app → its hits are gone
        fs::remove_file(
            t.s.root
                .join(format!("{}/{}.json", timelines::EVENTS_DIR, t.m.event)),
        )
        .unwrap();
        let st = sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(st.removed, vec![format!("event:{}", t.m.event)]);
        assert!(
            search(&c, "그 아이의 정체", &SearchOptions::default())
                .unwrap()
                .hits
                .is_empty()
        );
    }

    // S11.C — closed-app edit, DB deleted/corrupt, copy at another path, history apart,
    // rebuild leaves the work byte-identical and gives the same results.
    #[test]
    fn s11c_rebuild_copy_and_history() {
        let t = setup();
        let none = AtomicBool::new(false);
        let path = cache_path(&t.cache, &t.s.workspace_id, &t.s.root);
        {
            let _c = index(&t);
        }
        // commit 3화, then change the working copy
        history::commit(&t.s, "r1", &t.m.eps[2], "", None).unwrap();
        write(&t.s, &t.m.eps[2..3], &["그 아이는 남은 불씨를 다스렸다."]);
        // "app closed" (no sync) → edit outside → open again
        let p = crate::workspace::manuscript::file_path(&t.s, &t.m.eps[0]).unwrap();
        fs::write(&p, format!("{EP1}\n\n꺼진 동안 쓴 줄")).unwrap();
        let (mut c, created) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert!(!created);
        sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(
            eps_of(
                &search(&c, "꺼진 동안", &SearchOptions::default()).unwrap(),
                "manuscript"
            ),
            vec![1]
        );
        // history apart unless asked
        let o = SearchOptions::default();
        let with_h = SearchOptions {
            include_history: true,
            ..Default::default()
        };
        assert!(search(&c, "감지했다", &o).unwrap().hits.is_empty());
        let h = search(&c, "감지했다", &with_h).unwrap();
        assert_eq!(h.hits.len(), 1);
        assert!(h.hits[0].history && h.hits[0].kind == "revision" && h.hits[0].rev_id.is_some());
        let before = |c: &Connection| {
            ["린", "불씨", "감지했다", "꺼진 동안", "회귀자"]
                .iter()
                .map(|q| search(c, q, &with_h).unwrap().hits)
                .collect::<Vec<_>>()
        };
        let expect = before(&c);
        let work_hash = |dir: &Path| {
            let mut v = Vec::new();
            fn walk(d: &Path, v: &mut Vec<(String, String)>) {
                for e in fs::read_dir(d).unwrap().flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        if !p.ends_with(".galpi") {
                            walk(&p, v);
                        }
                    } else {
                        v.push((
                            p.to_string_lossy().into_owned(),
                            content_hash(&fs::read(&p).unwrap()),
                        ));
                    }
                }
            }
            walk(dir, &mut v);
            v.sort();
            v
        };
        let files_before = work_hash(&t.dir);
        drop(c);
        // DB deleted → rebuilt → same results
        remove_db_files(&path);
        let (mut c, created) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert!(created);
        sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(before(&c), expect);
        drop(c);
        // corrupt file → rebuilt
        fs::write(&path, b"not a database").unwrap();
        let (mut c, created) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert!(created);
        sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(before(&c), expect);
        drop(c);
        // generation switch + a cancelled rebuild keeps the old index
        assert_eq!(
            rebuild(&path, &t.s, &AtomicBool::new(true)),
            Err(SyncError::Cancelled)
        );
        let (c, created) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert!(!created);
        assert_eq!(before(&c), expect);
        drop(c);
        rebuild(&path, &t.s, &none).unwrap();
        let (c, _) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert_eq!(before(&c), expect);
        assert_eq!(work_hash(&t.dir), files_before);
        drop(c);
        // a copy of the work at another path: same workspaceId, separate cache
        let copy = t._b.path().join("검색 작품 사본");
        copy_dir(&t.dir, &copy);
        let s2 = open(&copy).unwrap();
        assert_eq!(s2.workspace_id, t.s.workspace_id);
        let p2 = cache_path(&t.cache, &s2.workspace_id, &s2.root);
        assert_ne!(p2, path);
        let (mut c2, created) = open_index(&p2, &s2.workspace_id, &s2.root).unwrap();
        assert!(created);
        sync(&mut c2, &s2, &none).unwrap();
        assert_eq!(before(&c2), expect);
    }

    // S11.C ordering: a file edited after the fresh build read it is still found, because the
    // swap is followed by one incremental sync (what IndexService does).
    #[test]
    fn edit_during_rebuild_is_not_lost() {
        let t = setup();
        let none = AtomicBool::new(false);
        let path = cache_path(&t.cache, &t.s.workspace_id, &t.s.root);
        drop(index(&t));
        let (building, _) = build_fresh(&path, &t.s, &none).unwrap();
        write(&t.s, &t.m.eps[1..2], &["재생성 도중에 고친 문장"]);
        swap_in(&building, &path).unwrap();
        let (mut c, created) = open_index(&path, &t.s.workspace_id, &t.s.root).unwrap();
        assert!(!created);
        assert!(
            search(&c, "도중에 고친", &SearchOptions::default())
                .unwrap()
                .hits
                .is_empty()
        );
        let st = sync(&mut c, &t.s, &none).unwrap();
        assert_eq!(st.changed, vec![format!("manuscript:{}", t.m.eps[1])]);
        assert_eq!(
            eps_of(
                &search(&c, "도중에 고친", &SearchOptions::default()).unwrap(),
                "manuscript"
            ),
            vec![2]
        );
    }

    fn copy_dir(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for e in fs::read_dir(from).unwrap().flatten() {
            let p = e.path();
            if p.file_name().is_some_and(|n| n == ".galpi") {
                continue;
            }
            if p.is_dir() {
                copy_dir(&p, &to.join(e.file_name()));
            } else {
                fs::copy(&p, to.join(e.file_name())).unwrap();
            }
        }
    }

    // S11.D — CH3 data: name/alias search vs linked episodes, both with a range.
    #[test]
    fn s11d_name_search_and_linked_episodes() {
        let t = setup();
        let c = index(&t);
        let names = vec!["서린".to_string(), "린".to_string()];
        let found = name_search(&c, &names, None, None).unwrap();
        let summary: Vec<(u32, Vec<&str>)> = found
            .iter()
            .map(|e| (e.number, e.hits.iter().map(|h| h.name.as_str()).collect()))
            .collect();
        assert_eq!(
            summary,
            vec![(1, vec!["서린"]), (2, vec!["린"]), (3, vec!["서린"])]
        );
        let linked = linked_episodes(&t.s, &t.m.card, None, None).unwrap();
        assert_eq!(linked.iter().map(|e| e.number).collect::<Vec<_>>(), vec![3]);
        assert_eq!(linked[0].hits[0].id, t.m.event);
        let narrowed = name_search(&c, &names, Some(3), Some(3)).unwrap();
        assert_eq!(
            narrowed.iter().map(|e| e.number).collect::<Vec<_>>(),
            vec![3]
        );
        assert!(
            linked_episodes(&t.s, &t.m.card, Some(1), Some(2))
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn unreadable_manuscript_is_reported_not_indexed() {
        let t = setup();
        let p = crate::workspace::manuscript::file_path(&t.s, &t.m.eps[1]).unwrap();
        fs::write(&p, [0xB8u8, 0xB0, 0xC1, 0xF6]).unwrap(); // CP949 bytes
        let (mut c, _) = open_index(
            &cache_path(&t.cache, &t.s.workspace_id, &t.s.root),
            &t.s.workspace_id,
            &t.s.root,
        )
        .unwrap();
        let st = sync(&mut c, &t.s, &AtomicBool::new(false)).unwrap();
        assert_eq!(st.unreadable, vec![format!("manuscript:{}", t.m.eps[1])]);
        assert_eq!(fs::read(&p).unwrap(), vec![0xB8u8, 0xB0, 0xC1, 0xF6]);
    }
}
