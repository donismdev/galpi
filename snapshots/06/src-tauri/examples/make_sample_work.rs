//! Dev fixture: creates a synthetic work with N empty episodes using the real app code paths.
//! Never point it at a real manuscript folder. (Same as the debug tab's "합성 작품 만들기".)
//!
//!   cargo run --example make_sample_work -- "<new or empty folder>" [title] [episodes]

use galpi_lib::workspace::sample::make_sample;
use std::path::PathBuf;

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = PathBuf::from(
        args.next()
            .expect("usage: <new or empty folder> [title] [episodes]"),
    );
    let title = args.next().unwrap_or_else(|| "잿빛 항구".into());
    let count: u32 = args.next().and_then(|n| n.parse().ok()).unwrap_or(3);
    let s = make_sample(&dir, &title, count).expect("make sample work");
    println!("workspaceId {}", s.workspace_id);
    for e in s.episodes {
        println!("{} {}", e.number, e.manuscript_path);
    }
}
