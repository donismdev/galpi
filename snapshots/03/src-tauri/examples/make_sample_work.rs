//! Dev fixture: creates a synthetic work with N empty episodes using the real app code paths.
//! Never point it at a real manuscript folder.
//!
//!   cargo run --example make_sample_work -- "<empty folder>" [title] [episodes]

use galpi_lib::workspace::{self, CreateOptions, CreateOutcome, episodes};
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(args.next().expect("usage: <empty folder> [title] [episodes]"));
    let title = args.next().unwrap_or_else(|| "잿빛 항구".into());
    let count: u32 = args.next().and_then(|n| n.parse().ok()).unwrap_or(3);
    std::fs::create_dir_all(&dir).expect("create folder");
    let opts = CreateOptions {
        title,
        request_id: "sample".into(),
        track_label: "본편".into(),
        confirm_non_empty: false,
    };
    match workspace::create(&dir, &opts, None).expect("create work") {
        CreateOutcome::Created(m) => println!("workspaceId {}", m.workspace_id),
        CreateOutcome::Interrupted(s) => panic!("interrupted at {s:?}"),
    }
    let s = workspace::open(&dir).expect("open");
    for i in 0..count {
        let e = episodes::create_next(&s, &format!("sample-{i}"))
            .expect("episode")
            .episode;
        println!("{} {}", e.number, e.manuscript_path);
    }
}
