// Built-in manuscript editor (CodeMirror 6).
//
// IME rules (Korean): the document is only ever set when an episode is loaded (a fresh
// EditorState) or by an explicit writer action (restore draft). Typing never round-trips through
// React state, so composition is never re-injected or remounted. Saves wait until
// composition ends (`view.composing`), then send the text with the hash it was based on.
//
// Save states: clean → dirty → saving → saved | failed | conflict. Typing during a save starts a
// new generation; the save result only marks "saved" if no newer edit arrived.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { asWsError, newRequestId, type WsError } from "../workspace/api";
import type { Draft, LineEnding, ManuscriptRead } from "./api";
import { useEditorGuard, useManuscriptBackend } from "./EditorGuard";

export const AUTOSAVE_IDLE_MS = 1200;

export type DocStatus =
  | { kind: "loading" }
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; error: WsError }
  | { kind: "conflict" }
  | { kind: "undecodable"; read: Extract<ManuscriptRead, { state: "undecodable" }> }
  | { kind: "locked"; read: Extract<ManuscriptRead, { state: "locked" }> }
  | { kind: "error"; error: WsError };

interface Meta {
  hash: string;
  bom: boolean;
  lineEnding: LineEnding;
  mixed: boolean;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

export function ManuscriptEditor({
  sessionId,
  episodeId,
  readOnly,
}: {
  sessionId: string;
  episodeId: string;
  readOnly: boolean;
}) {
  const { t, tf } = useI18n();
  const backend = useManuscriptBackend();
  const guard = useEditorGuard();

  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  const meta = useRef<Meta | null>(null);
  const gen = useRef(0); // bumped on every document change
  const savedGen = useRef(0); // generation known to be on disk
  const inflight = useRef<Promise<boolean> | null>(null);
  const idle = useRef<number | null>(null);
  const saveAfterCompose = useRef(false);
  /** Our own composition flag: set on compositionstart, before CodeMirror counts DOM changes. */
  const imeActive = useRef(false);
  const composing = () => imeActive.current || (view.current?.composing ?? false);
  const composeWaiters = useRef<(() => void)[]>([]);
  const stopped = useRef(false); // conflict/undecodable: no autosave until reloaded
  const alive = useRef(true);

  const [status, setStatusState] = useState<DocStatus>({ kind: "loading" });
  const statusRef = useRef<DocStatus>(status);
  const setStatus = (s: DocStatus) => {
    statusRef.current = s;
    if (alive.current) setStatusState(s);
  };
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<Meta | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const dirty = () => gen.current !== savedGen.current;

  const keepDraft = useCallback(
    async (text: string) => {
      if (readOnly) return;
      try {
        setDraft(await backend.saveDraft(sessionId, episodeId, meta.current?.hash ?? null, text));
      } catch {
        /* best effort: the text is still in the editor */
      }
    },
    [backend, episodeId, readOnly, sessionId],
  );

  /** One save of the current text. Never runs during IME composition. */
  const saveNow = useCallback(async (): Promise<boolean> => {
    const v = view.current;
    const m = meta.current;
    if (!v || !m || readOnly || stopped.current) return !dirty();
    if (composing()) {
      saveAfterCompose.current = true;
      await new Promise<void>((r) => composeWaiters.current.push(r));
      return saveNow();
    }
    if (inflight.current) {
      await inflight.current;
      if (!dirty()) return true;
    }
    if (!dirty()) return true;
    const myGen = gen.current;
    const text = v.state.doc.toString();
    setStatus({ kind: "saving" });
    const run = (async () => {
      try {
        const r = await backend.save({
          sessionId,
          requestId: newRequestId(),
          episodeId,
          text,
          baseHash: m.hash,
          bom: m.bom,
          lineEnding: m.lineEnding,
        });
        m.hash = r.hash;
        savedGen.current = Math.max(savedGen.current, myGen);
        if (alive.current) setDraft(null);
        setStatus(dirty() ? { kind: "dirty" } : { kind: "saved", at: r.savedAt });
        return true;
      } catch (e) {
        const err = asWsError(e);
        if (err.code === "writeConflict") {
          stopped.current = true;
          setStatus({ kind: "conflict" });
        } else {
          setStatus({ kind: "failed", error: err });
        }
        await keepDraft(text);
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    const ok = await run;
    // Edits made while saving: save them too (once the user pauses again).
    if (ok && dirty()) schedule();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, episodeId, keepDraft, readOnly, sessionId]);

  const schedule = useCallback(() => {
    if (idle.current !== null) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      idle.current = null;
      void saveNow();
    }, AUTOSAVE_IDLE_MS);
  }, [saveNow]);

  // Load (or reload) the episode into a fresh editor.
  useEffect(() => {
    alive.current = true;
    stopped.current = false;
    gen.current = 0;
    savedGen.current = 0;
    imeActive.current = false;
    meta.current = null;
    setForm(null);
    setDraft(null);
    setStatus({ kind: "loading" });
    let cancelled = false;

    (async () => {
      let r: ManuscriptRead;
      try {
        r = await backend.read(sessionId, episodeId);
      } catch (e) {
        if (!cancelled) setStatus({ kind: "error", error: asWsError(e) });
        return;
      }
      const d = await backend.loadDraft(sessionId, episodeId).catch(() => null);
      if (cancelled) return;
      if (r.state === "undecodable") {
        stopped.current = true; // no autosave: the file is not ours to rewrite
        setDraft(d);
        setStatus({ kind: "undecodable", read: r });
        return;
      }
      if (r.state === "locked") {
        stopped.current = true;
        setDraft(d);
        setStatus({ kind: "locked", read: r });
        return;
      }
      meta.current = { hash: r.hash, bom: r.bom, lineEnding: r.lineEnding, mixed: r.mixedLineEndings };
      setForm({ ...meta.current });
      setDraft(d && d.text !== r.text ? d : null);
      const state = EditorState.create({
        doc: r.text,
        extensions: [
          history(),
          markdown(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                void saveNow();
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            gen.current += 1;
            if (statusRef.current.kind !== "conflict") setStatus({ kind: "dirty" });
            if (!stopped.current) schedule();
          }),
          EditorView.domEventHandlers({
            compositionstart: () => {
              imeActive.current = true;
              return false;
            },
            compositionend: () => {
              imeActive.current = false;
              // Let CodeMirror apply the composed text first, then release waiting saves.
              window.setTimeout(() => {
                const waiters = composeWaiters.current.splice(0);
                waiters.forEach((w) => w());
                if (saveAfterCompose.current) {
                  saveAfterCompose.current = false;
                  if (waiters.length === 0) void saveNow();
                }
              }, 0);
              return false;
            },
          }),
          EditorView.contentAttributes.of({ "aria-label": t("manuscript.editorLabel"), spellcheck: "false" }),
        ],
      });
      view.current?.destroy();
      if (host.current) view.current = new EditorView({ state, parent: host.current });
      setStatus({ kind: "clean" });
    })();

    return () => {
      cancelled = true;
      alive.current = false;
      if (idle.current !== null) window.clearTimeout(idle.current);
      idle.current = null;
      const v = view.current;
      // Leaving with unsaved text (switch/close without flush): try once, keep a draft regardless.
      if (v && meta.current && dirty() && !readOnly) {
        const text = v.state.doc.toString();
        void backend.saveDraft(sessionId, episodeId, meta.current.hash, text).catch(() => {});
      }
      v?.destroy();
      view.current = null;
      composeWaiters.current.splice(0).forEach((w) => w());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sessionId, episodeId, readOnly, reloadTick]);

  // Expose flush/focus to the app (episode switch, close work, window close).
  useEffect(() => {
    guard.register({
      flush: async () => {
        if (idle.current !== null) {
          window.clearTimeout(idle.current);
          idle.current = null;
        }
        if (!dirty()) return true;
        return saveNow();
      },
      focus: () => view.current?.focus(),
      isDirty: dirty,
    });
    return () => guard.register(null);
  }, [guard, saveNow]);

  const reload = () => {
    if (dirty() && statusRef.current.kind !== "conflict") return;
    setReloadTick((n) => n + 1);
  };

  const restoreDraft = () => {
    const v = view.current;
    if (!v || !draft) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: draft.text } });
    v.focus();
  };

  const discard = async () => {
    await backend.discardDraft(sessionId, episodeId).catch(() => {});
    setDraft(null);
  };

  const reveal = () => void backend.reveal(sessionId, episodeId).catch(() => {});

  const s = status;
  const statusText =
    s.kind === "loading"
      ? t("manuscript.loading")
      : s.kind === "clean"
        ? t("manuscript.clean")
        : s.kind === "dirty"
          ? t("manuscript.dirty")
          : s.kind === "saving"
            ? t("manuscript.saving")
            : s.kind === "saved"
              ? tf("manuscript.saved", { time: timeOf(s.at) })
              : s.kind === "failed"
                ? t("manuscript.failed")
                : s.kind === "conflict"
                  ? t("manuscript.conflict")
                  : "";

  return (
    <section className="manuscript" aria-label={t("manuscript.label")}>
      {s.kind === "undecodable" && (
        <div role="alert" className="notice notice-error">
          <p>{t("manuscript.undecodable")}</p>
          <p>{t("manuscript.undecodableHow")}</p>
          <p className="mono">{s.read.path}</p>
          <p className="actions">
            <button type="button" onClick={reveal}>
              {t("manuscript.reveal")}
            </button>
            <button type="button" onClick={() => setReloadTick((n) => n + 1)}>
              {t("manuscript.reload")}
            </button>
          </p>
        </div>
      )}
      {s.kind === "locked" && (
        <div role="alert" className="notice notice-error">
          <p>{t("manuscript.locked")}</p>
          <p className="mono">{s.read.path}</p>
          <p className="actions">
            <button type="button" onClick={() => setReloadTick((n) => n + 1)}>
              {t("manuscript.reload")}
            </button>
          </p>
        </div>
      )}
      {s.kind === "error" && (
        <div role="alert" className="notice notice-error">
          <p>{t(`errors.${s.error.code}` as MessageKey)}</p>
          <p className="actions">
            <button type="button" onClick={() => setReloadTick((n) => n + 1)}>
              {t("manuscript.reload")}
            </button>
          </p>
        </div>
      )}
      {draft && (
        <div role="status" className="notice">
          <p>{tf("manuscript.draftFound", { time: timeOf(draft.savedAt) })}</p>
          <p className="actions">
            {view.current && (
              <button type="button" onClick={restoreDraft}>
                {t("manuscript.draftRestore")}
              </button>
            )}
            <button type="button" onClick={() => void discard()}>
              {t("manuscript.draftDiscard")}
            </button>
          </p>
        </div>
      )}
      {s.kind === "conflict" && (
        <div role="alert" className="notice notice-error">
          <p>{t("manuscript.conflictHow")}</p>
        </div>
      )}
      {s.kind === "failed" && (
        <div role="alert" className="notice notice-error">
          <p>
            {t("manuscript.failed")} {t(`errors.${s.error.code}` as MessageKey)}
          </p>
          {typeof s.error.detail === "string" && <p className="mono">{s.error.detail}</p>}
          <p>{t("manuscript.failedDraft")}</p>
          <p className="actions">
            <button type="button" onClick={() => void saveNow()}>
              {t("manuscript.retry")}
            </button>
          </p>
        </div>
      )}
      <div className="manuscript-bar">
        <span className={`save-state save-${s.kind}`} data-testid="save-state">
          {statusText}
        </span>
        {form && (
          <span className="muted mono">
            UTF-8{form.bom ? " (BOM)" : ""} · {form.lineEnding.toUpperCase()}
            {form.mixed ? ` · ${t("manuscript.mixed")}` : ""}
          </span>
        )}
        {readOnly && <span className="badge">{t("workspace.readOnly")}</span>}
        <span className="spacer" />
        <button type="button" onClick={() => void saveNow()} disabled={readOnly || !form}>
          {t("manuscript.save")}
        </button>
        <button type="button" onClick={reload} title={t("manuscript.reloadHint")}>
          {t("manuscript.reload")}
        </button>
      </div>
      <div
        ref={host}
        className="manuscript-host"
        hidden={s.kind === "undecodable" || s.kind === "locked" || s.kind === "error"}
      />
    </section>
  );
}
