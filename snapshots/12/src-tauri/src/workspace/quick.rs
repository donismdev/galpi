//! Quick open (12, Ctrl+P): everything the writer can jump to by name, read once when the
//! palette opens. Ranking happens on the screen per keystroke (`src/search/quickRank.ts`):
//! episode number exact → title/alias exact → prefix → substring; ties by kind, then title,
//! then path. `kind` + `detail` + `path` tell same-named items apart.

use super::error::WsError;
use super::lore::{self, TemplateId};
use super::timelines::{self, COLLECTIONS_DIR, Collection};
use super::views::{SavedView, VIEWS_DIR};
use super::{WorkspaceSession, episodes};
use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickItem {
    /// episode | card | view | timeline
    pub kind: String,
    pub id: String,
    pub title: String,
    pub aliases: Vec<String>,
    /// Episode number (episodes only).
    pub number: Option<u32>,
    /// Card template, or the parent timeline's name for a saved view.
    pub detail: Option<String>,
    /// Work-relative file the item lives in.
    pub path: String,
}

fn template_name(t: TemplateId) -> &'static str {
    match t {
        TemplateId::Character => "character",
        TemplateId::Personality => "personality",
        TemplateId::Place => "place",
        TemplateId::Group => "group",
        TemplateId::Rule => "rule",
        TemplateId::Note => "note",
    }
}

pub fn items(s: &WorkspaceSession) -> Result<Vec<QuickItem>, WsError> {
    let mut out = Vec::new();
    for e in episodes::list(s)?.episodes {
        out.push(QuickItem {
            kind: "episode".into(),
            id: e.episode_id,
            title: e.title,
            aliases: Vec::new(),
            number: Some(e.number),
            detail: None,
            path: e.manuscript_rel,
        });
    }
    for c in lore::list(s)?.cards {
        out.push(QuickItem {
            kind: "card".into(),
            path: format!("{}/card.md", c.dir),
            id: c.card_id,
            title: c.name,
            aliases: c.aliases,
            number: None,
            detail: Some(template_name(c.template_id).into()),
        });
    }
    let mut problems = Vec::new();
    let cols: Vec<(Collection, String)> =
        timelines::read_dir_json(s, COLLECTIONS_DIR, &mut problems)?;
    let name_of = |id: &Option<String>| {
        id.as_ref().and_then(|id| {
            cols.iter()
                .find(|(c, _)| &c.collection_id == id)
                .map(|(c, _)| c.name.clone())
        })
    };
    for (v, _) in timelines::read_dir_json::<SavedView>(s, VIEWS_DIR, &mut problems)? {
        out.push(QuickItem {
            kind: "view".into(),
            path: format!("{VIEWS_DIR}/{}.json", v.view_id),
            detail: name_of(&v.parent_collection_id),
            id: v.view_id,
            title: v.label,
            aliases: Vec::new(),
            number: None,
        });
    }
    for (c, _) in &cols {
        out.push(QuickItem {
            kind: "timeline".into(),
            id: c.collection_id.clone(),
            title: c.name.clone(),
            aliases: Vec::new(),
            number: None,
            detail: None,
            path: format!("{COLLECTIONS_DIR}/{}.json", c.collection_id),
        });
    }
    Ok(out)
}
