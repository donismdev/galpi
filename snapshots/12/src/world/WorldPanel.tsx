// "세계관" root (08): world cards made from light templates, the writer's own folders, aliases
// and user tags. Card IDs and tag IDs never change (rename / move keep them). Hiding a tag is a
// view preference only; removing a tag from a card and the global tag cleanup are separate,
// explicit actions (the cleanup shows how many cards it changes before it runs).
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CardFinder } from "./CardFinder";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { asWsError, newRequestId } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import {
  DEFAULT_FOLDER,
  TEMPLATE_IDS,
  localHiddenTagStore,
  OPEN_CARD_EVENT,
  takePendingCard,
  useWorldBackend,
  type CardDoc,
  type CardInfo,
  type CardList,
  type HiddenTagStore,
  type TagInfo,
  type TemplateId,
} from "./api";

const EMPTY: CardList = { cards: [], folders: [], problems: [] };

function useFolderLabel() {
  const { t } = useI18n();
  return (path: string) => {
    const [top, ...rest] = path.split("/");
    const head = t(`world.folders.${top}` as MessageKey);
    return rest.length ? `${head}/${rest.join("/")}` : head;
  };
}

type Msg = { kind: "ok" | "error"; text: string } | null;

function CardDetail({ sessionId, cardId, readOnly, list, tags, onChanged, onBack }: {
  sessionId: string;
  cardId: string;
  readOnly: boolean;
  list: CardList;
  tags: TagInfo[];
  onChanged: () => void;
  onBack: () => void;
}) {
  const { t, tf } = useI18n();
  const backend = useWorldBackend();
  const folderLabel = useFolderLabel();
  const nameId = useId();
  const aliasId = useId();
  const folderId = useId();
  const bodyId = useId();
  const [doc, setDoc] = useState<CardDoc | null>(null);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [folder, setFolder] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const apply = (d: CardDoc, keepBody = false) => {
    setDoc(d);
    setName(d.card.name);
    setAliases(d.card.aliases.join(", "));
    setFolder(d.card.folder);
    if (!keepBody) setBody(d.body);
  };

  const load = useCallback(async () => {
    try {
      apply(await backend.read(sessionId, cardId));
    } catch (e) {
      setMsg({ kind: "error", text: t(`errors.${asWsError(e).code}` as MessageKey) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, cardId, sessionId]);

  useEffect(() => {
    setMsg(null);
    void load();
  }, [load]);

  const bodyDirty = doc !== null && body !== doc.body;
  useEffect(() => {
    const onFocus = () => {
      if (!bodyDirty) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [bodyDirty, load]);

  const fail = (e: unknown) => {
    const err = asWsError(e);
    setMsg({
      kind: "error",
      text: err.code === "writeConflict" ? t("world.changedOutside") : `${t("world.saveFailed")} ${t(`errors.${err.code}` as MessageKey)}`,
    });
  };

  const run = async (f: () => Promise<CardDoc>, ok: string, keepBody = true) => {
    setBusy(true);
    setMsg(null);
    try {
      apply(await f(), keepBody);
      onChanged();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!doc) return <p className="muted">{msg?.text ?? t("manuscript.loading")}</p>;
  const c = doc.card;
  const parsedAliases = aliases.split(/[,，]/).map((a) => a.trim()).filter(Boolean);
  const aliasesDirty = parsedAliases.join("\u0000") !== c.aliases.join("\u0000");
  const tagLabel = (id: string) => tags.find((x) => x.tagId === id)?.label ?? id;

  return (
    <section className="open-card card-detail" aria-label={tf("world.detailLabel", { name: c.name })}>
      <p>
        <button type="button" className="link" onClick={onBack}>
          {t("world.back")}
        </button>
      </p>
      <h2>
        {c.name} <span className="muted">· {t(`world.templates.${c.templateId}.label` as MessageKey)}</span>
      </h2>
      <p className="muted">
        <span data-testid="card-path">{folderLabel(c.folder)}</span> · ID <span className="mono" data-testid="card-id">{c.cardId}</span>
      </p>
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}{" "}
          {msg.kind === "error" && (
            <button type="button" className="link" onClick={() => void load()}>
              {t("world.reload")}
            </button>
          )}
        </p>
      )}

      <div className="card-meta">
        <p className="field">
          <label htmlFor={nameId}>{t("world.name")}</label>
          <input id={nameId} value={name} readOnly={readOnly} onChange={(e) => setName(e.target.value)} />
          {!readOnly && (
            <button
              type="button"
              disabled={busy || !name.trim() || name.trim() === c.name}
              onClick={() => void run(() => backend.updateMeta(sessionId, newRequestId(), cardId, { name: name.trim() }, doc.metaHash), t("world.renamed"))}
            >
              {t("world.rename")}
            </button>
          )}
        </p>
        <p className="field">
          <label htmlFor={aliasId}>{t("world.aliases")}</label>
          <input id={aliasId} value={aliases} readOnly={readOnly} placeholder={t("world.aliasesPlaceholder")} onChange={(e) => setAliases(e.target.value)} />
          {!readOnly && (
            <button
              type="button"
              disabled={busy || !aliasesDirty}
              onClick={() => void run(() => backend.updateMeta(sessionId, newRequestId(), cardId, { aliases: parsedAliases }, doc.metaHash), t("world.aliasesSaved"))}
            >
              {t("world.saveAliases")}
            </button>
          )}
        </p>
        <p className="field">
          <label htmlFor={folderId}>{t("world.folder")}</label>
          <select id={folderId} value={folder} disabled={readOnly} onChange={(e) => setFolder(e.target.value)}>
            {list.folders.map((f) => (
              <option key={f.path} value={f.path}>
                {folderLabel(f.path)}
              </option>
            ))}
          </select>
          {!readOnly && (
            <button
              type="button"
              disabled={busy || folder === c.folder}
              onClick={() => void run(() => backend.move(sessionId, newRequestId(), cardId, folder), tf("world.moved", { folder: folderLabel(folder) }))}
            >
              {t("world.move")}
            </button>
          )}
        </p>
        <fieldset className="card-tags">
          <legend>{t("world.cardTags")}</legend>
          {tags.length === 0 && <span className="muted">{t("world.noTags")}</span>}
          {tags.map((tag) => {
            const on = c.tagIds.includes(tag.tagId);
            return (
              <label key={tag.tagId} className="tag-check">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy || readOnly}
                  onChange={() =>
                    void run(
                      () =>
                        backend.updateMeta(
                          sessionId,
                          newRequestId(),
                          cardId,
                          { tagIds: on ? c.tagIds.filter((x) => x !== tag.tagId) : [...c.tagIds, tag.tagId] },
                          doc.metaHash,
                        ),
                      on ? tf("world.tagRemovedFromCard", { tag: tag.label }) : tf("world.tagAdded", { tag: tag.label }),
                    )
                  }
                />
                {tag.label}
              </label>
            );
          })}
          {c.tagIds.filter((id) => !tags.some((x) => x.tagId === id)).map((id) => (
            <span key={id} className="muted">
              {tagLabel(id)}
            </span>
          ))}
        </fieldset>
      </div>

      <CardFinder sessionId={sessionId} cardId={cardId} />

      <p className="field">
        <label htmlFor={bodyId}>{t("world.body")}</label>
        <textarea id={bodyId} className="summary-text card-body" value={body} readOnly={readOnly} onChange={(e) => setBody(e.target.value)} />
      </p>
      {!readOnly && (
        <p className="actions">
          <button
            type="button"
            disabled={busy || !bodyDirty}
            onClick={() => void run(() => backend.saveBody(sessionId, newRequestId(), cardId, body, doc.bodyHash), t("world.bodySaved"), false)}
          >
            {t("world.saveBody")}
          </button>
          {bodyDirty && <span className="muted">{t("world.unsaved")}</span>}
        </p>
      )}
    </section>
  );
}

function TagManager({ sessionId, readOnly, tags, hidden, onToggleHidden, onChanged }: {
  sessionId: string;
  readOnly: boolean;
  tags: TagInfo[];
  hidden: string[];
  onToggleHidden: (tagId: string) => void;
  onChanged: () => void;
}) {
  const { t, tf } = useI18n();
  const backend = useWorldBackend();
  const newId = useId();
  const [label, setLabel] = useState("");
  const [editing, setEditing] = useState<{ tagId: string; label: string } | null>(null);
  const [cleanup, setCleanup] = useState<TagInfo | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const act = async (f: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await f();
      onChanged();
      setMsg({ kind: "ok", text: ok });
    } catch (e) {
      setMsg({ kind: "error", text: t(`errors.${asWsError(e).code}` as MessageKey) });
    }
  };

  return (
    <section className="tag-manager" aria-label={t("world.tags")}>
      <h2>{t("world.tags")}</h2>
      <p className="muted">{t("world.tagsHelp")}</p>
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}
        </p>
      )}
      <ul className="tag-list">
        {tags.map((tag) => {
          const isHidden = hidden.includes(tag.tagId);
          return (
            <li key={tag.tagId} className="tag-row" data-tag={tag.label}>
              {editing?.tagId === tag.tagId ? (
                <>
                  <input aria-label={t("world.tagLabel")} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
                  <button
                    type="button"
                    disabled={!editing.label.trim()}
                    onClick={() =>
                      void act(() => backend.renameTag(sessionId, newRequestId(), tag.tagId, editing.label.trim()), tf("world.tagRenamed", { tag: editing.label.trim() })).then(() =>
                        setEditing(null),
                      )
                    }
                  >
                    {t("world.saveTagName")}
                  </button>
                  <button type="button" onClick={() => setEditing(null)}>
                    {t("world.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <strong className={isHidden ? "tag-hidden" : undefined}>{tag.label}</strong>
                  <span className="muted">{tf("world.tagCount", { n: tag.cardCount })}</span>
                  <button type="button" aria-pressed={isHidden} onClick={() => onToggleHidden(tag.tagId)}>
                    {isHidden ? t("world.unhideTag") : t("world.hideTag")}
                  </button>
                  {!readOnly && (
                    <>
                      <button type="button" onClick={() => setEditing({ tagId: tag.tagId, label: tag.label })}>
                        {t("world.renameTag")}
                      </button>
                      <button type="button" onClick={() => setCleanup(tag)}>
                        {t("world.cleanupTag")}
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      {cleanup && (
        <div role="alertdialog" aria-label={t("world.cleanupTag")} className="review-box">
          <p>{tf("world.cleanupImpact", { tag: cleanup.label, n: cleanup.cardCount })}</p>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const target = cleanup;
              setCleanup(null);
              void act(() => backend.deleteTagEverywhere(sessionId, newRequestId(), target.tagId), tf("world.cleanupDone", { tag: target.label, n: target.cardCount }));
            }}
          >
            {tf("world.cleanupConfirm", { n: cleanup.cardCount })}
          </button>
          <button type="button" onClick={() => setCleanup(null)}>
            {t("world.cancel")}
          </button>
        </div>
      )}
      {!readOnly && (
        <p className="field">
          <label htmlFor={newId}>{t("world.newTag")}</label>
          <input id={newId} value={label} onChange={(e) => setLabel(e.target.value)} />
          <button
            type="button"
            disabled={!label.trim()}
            onClick={() => {
              const l = label.trim();
              setLabel("");
              void act(() => backend.createTag(sessionId, newRequestId(), l), tf("world.tagCreated", { tag: l }));
            }}
          >
            {t("world.addTag")}
          </button>
        </p>
      )}
    </section>
  );
}

export function WorldPanel({ hiddenStore = localHiddenTagStore }: { hiddenStore?: HiddenTagStore }) {
  const { t, tf } = useI18n();
  const backend = useWorldBackend();
  const ws = useWorkspace();
  const folderLabel = useFolderLabel();
  const sessionId = ws.current?.sessionId ?? null;
  const workspaceId = ws.current?.workspaceId ?? "";
  const readOnly = ws.current?.mode === "readOnly";
  const nameId = useId();
  const tplId = useId();
  const createFolderId = useId();
  const searchId = useId();
  const filterId = useId();
  const subId = useId();

  const [list, setList] = useState<CardList>(EMPTY);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [template, setTemplate] = useState<TemplateId>("character");
  const [createFolder, setCreateFolder] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [subName, setSubName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null); // one create intent (retries reuse it)
  const [msg, setMsg] = useState<Msg>(null);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    try {
      const [l, tg] = await Promise.all([backend.list(sessionId), backend.listTags(sessionId)]);
      setList(l);
      setTags(tg);
    } catch {
      /* listing is best effort */
    }
  }, [backend, sessionId]);

  useEffect(() => {
    setOpen(takePendingCard()); // an explicit ‘open full card’ request from another root, if any
    setMsg(null);
    setHidden(workspaceId ? hiddenStore.load(workspaceId) : []);
    void reload();
  }, [reload, workspaceId, hiddenStore]);

  // Already on this root (12, quick open / search): open the requested card like a list click.
  useEffect(() => {
    const on = () => {
      const id = takePendingCard();
      if (id) setOpen(id);
    };
    window.addEventListener(OPEN_CARD_EVENT, on);
    return () => window.removeEventListener(OPEN_CARD_EVENT, on);
  }, []);

  const toggleHidden = (tagId: string) => {
    const next = hidden.includes(tagId) ? hidden.filter((x) => x !== tagId) : [...hidden, tagId];
    setHidden(next);
    if (workspaceId) hiddenStore.save(workspaceId, next);
  };

  const create = async () => {
    if (!sessionId || !newName.trim() || creating) return;
    const requestId = pending ?? newRequestId();
    setPending(requestId);
    setCreating(true);
    setMsg(null);
    try {
      const name = newName.trim();
      // Template text is copied from the UI language now and stays as the writer's text.
      const body = tf(`world.templates.${template}.body` as MessageKey, { name });
      const made = await backend.create({ sessionId, requestId, templateId: template, name, folder: createFolder || null, body });
      setPending(null);
      setNewName("");
      await reload();
      setOpen(made.cardId);
    } catch (e) {
      setMsg({ kind: "error", text: `${t("world.createFailed")} ${t(`errors.${asWsError(e).code}` as MessageKey)}` });
    } finally {
      setCreating(false);
    }
  };

  const addFolder = async () => {
    if (!sessionId || !subName.trim()) return;
    const parent = filter || DEFAULT_FOLDER[template];
    try {
      const made = await backend.createFolder(sessionId, `${parent}/${subName.trim()}`);
      setSubName("");
      await reload();
      setFilter(made);
      setMsg({ kind: "ok", text: tf("world.folderCreated", { folder: folderLabel(made) }) });
    } catch (e) {
      setMsg({ kind: "error", text: t(`errors.${asWsError(e).code}` as MessageKey) });
    }
  };

  const q = query.trim().toLowerCase();
  const { shown, hiddenCount } = useMemo(() => {
    const inFolder = list.cards.filter((c) => !filter || c.folder === filter || c.folder.startsWith(`${filter}/`));
    const matched = inFolder.filter((c) => !q || c.name.toLowerCase().includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q)));
    const visible = matched.filter((c) => !c.tagIds.some((id) => hidden.includes(id)));
    return { shown: visible, hiddenCount: matched.length - visible.length };
  }, [filter, hidden, list.cards, q]);

  if (!sessionId) return null;
  if (open) {
    return (
      <CardDetail
        sessionId={sessionId}
        cardId={open}
        readOnly={readOnly}
        list={list}
        tags={tags}
        onChanged={() => void reload()}
        onBack={() => {
          setOpen(null);
          void reload();
        }}
      />
    );
  }

  const tagLabel = (id: string) => tags.find((x) => x.tagId === id)?.label;
  const sameName = (c: CardInfo) => list.cards.filter((o) => o.name === c.name).length > 1;
  const hiddenLabels = tags.filter((x) => hidden.includes(x.tagId)).map((x) => x.label);

  return (
    <section className="world">
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}
        </p>
      )}
      {!readOnly && (
        <div className="open-card world-create">
          <h2>{t("world.createTitle")}</h2>
          <p className="field">
            <label htmlFor={tplId}>{t("world.template")}</label>
            <select id={tplId} value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
              {TEMPLATE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(`world.templates.${id}.label` as MessageKey)} — {t(`world.templates.${id}.hint` as MessageKey)}
                </option>
              ))}
            </select>
          </p>
          <p className="field">
            <label htmlFor={nameId}>{t("world.name")}</label>
            <input
              id={nameId}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setPending(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
          </p>
          <p className="field">
            <label htmlFor={createFolderId}>{t("world.createIn")}</label>
            <select id={createFolderId} value={createFolder} onChange={(e) => setCreateFolder(e.target.value)}>
              <option value="">{tf("world.defaultFolder", { folder: folderLabel(DEFAULT_FOLDER[template]) })}</option>
              {list.folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {folderLabel(f.path)}
                </option>
              ))}
            </select>
          </p>
          <p className="actions">
            <button type="button" className="primary" disabled={creating || !newName.trim()} onClick={() => void create()}>
              {tf("world.create", { template: t(`world.templates.${template}.label` as MessageKey) })}
            </button>
          </p>
        </div>
      )}

      <div className="world-filters">
        <p className="field">
          <label htmlFor={searchId}>{t("world.search")}</label>
          <input id={searchId} type="search" value={query} placeholder={t("world.searchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
        </p>
        <p className="field">
          <label htmlFor={filterId}>{t("world.folderFilter")}</label>
          <select id={filterId} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">{tf("world.allFolders", { n: list.cards.length })}</option>
            {list.folders.map((f) => (
              <option key={f.path} value={f.path}>
                {folderLabel(f.path)} ({f.count})
              </option>
            ))}
          </select>
        </p>
        {!readOnly && (
          <p className="field">
            <label htmlFor={subId}>{tf("world.newSubfolder", { parent: folderLabel(filter || DEFAULT_FOLDER[template]) })}</label>
            <input id={subId} value={subName} onChange={(e) => setSubName(e.target.value)} />
            <button type="button" disabled={!subName.trim()} onClick={() => void addFolder()}>
              {t("world.addFolder")}
            </button>
          </p>
        )}
      </div>

      {hiddenCount > 0 && (
        <p className="muted" data-testid="hidden-note">
          {tf("world.hiddenNote", { tags: hiddenLabels.join(", "), n: hiddenCount })}
        </p>
      )}
      {list.problems.length > 0 && (
        <p role="status" className="banner banner-warn">
          {tf("world.problems", { n: list.problems.length, dirs: list.problems.map((p) => p.dir).join(", ") })}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty">{list.cards.length === 0 ? t("world.none") : t("world.noMatch")}</p>
      ) : (
        <ul className="card-list">
          {shown.map((c) => (
            <li key={c.cardId}>
              <button type="button" className="card-row" onClick={() => setOpen(c.cardId)}>
                <strong>{c.name}</strong>
                {c.aliases.length > 0 && <span className="muted">({c.aliases.join(", ")})</span>}
                <span className={sameName(c) ? "card-folder same-name" : "card-folder"}>{folderLabel(c.folder)}</span>
                <span className="muted">{tf("world.cardKind", { template: t(`world.templates.${c.templateId}.label` as MessageKey) })}</span>
                {c.tagIds.map((id) => tagLabel(id)).filter(Boolean).map((l) => (
                  <span key={l} className="tag-chip">
                    {l}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      )}

      <TagManager sessionId={sessionId} readOnly={readOnly} tags={tags} hidden={hidden} onToggleHidden={toggleHidden} onChanged={() => void reload()} />
    </section>
  );
}
