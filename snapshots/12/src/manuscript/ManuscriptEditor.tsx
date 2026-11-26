// Built-in manuscript editor (CodeMirror 6).
//
// IME rules (Korean, 04): typing never round-trips through React state, so composition is never
// re-injected or remounted; saves wait until composition ends.
//
// Disk changes (05): the Rust watcher (and window focus / "read again") report the file's content
// hash. Same hash as what we last read or wrote → nothing happened (e.g. an editor was only opened
// and closed). Different hash and our text is clean → the new text is applied as a minimal change,
// so the cursor stays where it was. Different hash while we have unsaved text → conflict: the base
// version we started from, our text and the disk text are kept (our text + base also as a recovery
// draft on disk, so they survive a crash) and the writer chooses: keep mine / take disk / merge.
// The disk file is never overwritten without that choice, and every save still carries the hash it
// expects, so if the file changes again in between, a new conflict is shown instead.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { asWsError, newRequestId, type WsError } from "../workspace/api";
import type { Draft, LineEnding, ManuscriptRead } from "./api";
import { useEditorGuard, useManuscriptBackend } from "./EditorGuard";
import { hasConflictMarkers, hunks, merge3 } from "./merge3";
import { REVEAL_EVENT, resolveReveal, takeReveal, type RevealHow, type RevealTarget } from "../search/reveal";

export const AUTOSAVE_IDLE_MS = 1200;
const DRAFT_IDLE_MS = 600;

/** Marks document changes that came from disk, not from the writer. */
const FromDisk = Annotation.define<boolean>();

export type DocStatus =
  | { kind: "loading" }
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; error: WsError }
  | { kind: "conflict" }
  | { kind: "missing" }
  | { kind: "undecodable"; read: Extract<ManuscriptRead, { state: "undecodable" }> }
  | { kind: "locked"; read: Extract<ManuscriptRead, { state: "locked" }> }
  | { kind: "error"; error: WsError };

export type DiskSide =
  | { kind: "text"; text: string; hash: string; bom: boolean; lineEnding: LineEnding }
  | { kind: "missing" }
  | { kind: "undecodable"; hash: string }
  | { kind: "locked" };

export interface Conflict {
  /** Text of the version we started from (what `baseHash` stands for). */
  base: string;
  disk: DiskSide;
  /** The file changed again while resolving. */
  again: boolean;
  /** Restored from the recovery copy after a restart. */
  restored: boolean;
}

interface Meta {
  /** Hash of the disk bytes our text is based on; null while the file is missing. */
  hash: string | null;
  bom: boolean;
  lineEnding: LineEnding;
  mixed: boolean;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

function sideOf(r: ManuscriptRead): DiskSide {
  switch (r.state) {
    case "ok":
      return { kind: "text", text: r.text, hash: r.hash, bom: r.bom, lineEnding: r.lineEnding };
    case "missing":
      return { kind: "missing" };
    case "undecodable":
      return { kind: "undecodable", hash: r.hash };
    case "locked":
      return { kind: "locked" };
  }
}

/**
 * Line-level edits turning `from` into `to`, in `from` coordinates. Unchanged lines are not
 * touched, so CodeMirror maps the cursor/selection through them (a line added at the top and one
 * at the bottom must not move the cursor in the middle). Falls back to one prefix/suffix
 * replacement if the computed edits do not reproduce `to` exactly.
 */
export function diskChanges(from: string, to: string): { from: number; to: number; insert: string }[] {
  const a = from.split("\n");
  const starts = [0];
  for (const line of a) starts.push(starts[starts.length - 1] + line.length + 1);
  const out: { from: number; to: number; insert: string }[] = [];
  for (const h of hunks(a, to.split("\n"))) {
    const { baseStart: s, baseEnd: e, lines } = h;
    if (e < a.length) {
      out.push({ from: starts[s], to: starts[e], insert: lines.map((l) => l + "\n").join("") });
    } else if (s < e) {
      if (lines.length) out.push({ from: starts[s], to: from.length, insert: lines.join("\n") });
      else out.push({ from: s > 0 ? starts[s] - 1 : 0, to: from.length, insert: "" });
    } else if (lines.length) {
      out.push({ from: from.length, to: from.length, insert: "\n" + lines.join("\n") });
    }
  }
  let check = "";
  let pos = 0;
  for (const c of out) {
    check += from.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  check += from.slice(pos);
  return check === to ? out : [minimalChange(from, to)];
}

/** One prefix/suffix replacement (fallback). */
function minimalChange(from: string, to: string) {
  let pre = 0;
  const max = Math.min(from.length, to.length);
  while (pre < max && from.charCodeAt(pre) === to.charCodeAt(pre)) pre++;
  let suf = 0;
  while (suf < max - pre && from.charCodeAt(from.length - 1 - suf) === to.charCodeAt(to.length - 1 - suf)) suf++;
  return { from: pre, to: from.length - suf, insert: to.slice(pre, to.length - suf) };
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
  const baseText = useRef(""); // the text `meta.hash` stands for
  const gen = useRef(0); // bumped on every writer edit
  const savedGen = useRef(0); // generation known to be on disk
  const inflight = useRef<Promise<boolean> | null>(null);
  const idle = useRef<number | null>(null);
  const draftIdle = useRef<number | null>(null);
  const saveAfterCompose = useRef(false);
  const imeActive = useRef(false);
  const composeWaiters = useRef<(() => void)[]>([]);
  const stopped = useRef(false); // no autosave: conflict / missing / undecodable / locked
  const alive = useRef(true);
  const pendingSignal = useRef<{ exists: boolean; hash: string | null } | null>(null);
  const conflictRef = useRef<Conflict | null>(null);
  const composing = () => imeActive.current || (view.current?.composing ?? false);

  const [status, setStatusState] = useState<DocStatus>({ kind: "loading" });
  const statusRef = useRef<DocStatus>(status);
  const setStatus = (s: DocStatus) => {
    statusRef.current = s;
    if (alive.current) setStatusState(s);
  };
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  const setConflict = (c: Conflict | null) => {
    conflictRef.current = c;
    if (alive.current) setConflictState(c);
  };
  const [merge, setMerge] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState<Meta | null>(null);
  const [externalAt, setExternalAt] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // 12: where a search hit landed (moved / missing are said out loud).
  const [revealed, setRevealed] = useState<{ how: RevealHow; matched: string } | null>(null);
  const applyReveal = (target: RevealTarget) => {
    const v = view.current;
    if (!v) return;
    const r = resolveReveal(v.state.doc.toString(), target);
    if (r.how !== "missing") {
      v.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { y: "center" }) });
      v.focus();
    }
    setRevealed({ how: r.how, matched: target.matched });
  };

  const dirty = () => gen.current !== savedGen.current;
  const docText = () => view.current?.state.doc.toString() ?? "";

  const keepDraft = useCallback(
    async (text: string) => {
      if (readOnly) return;
      try {
        const d = await backend.saveDraft(sessionId, episodeId, meta.current?.hash ?? null, baseText.current, text);
        if (alive.current && !conflictRef.current) setDraft(d);
      } catch {
        /* best effort: the text is still in the editor */
      }
    },
    [backend, episodeId, readOnly, sessionId],
  );

  /** Replace the editor text with disk text without counting it as the writer's edit. */
  const applyFromDisk = (text: string) => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== text) v.dispatch({ changes: diskChanges(cur, text), annotations: FromDisk.of(true) });
  };

  const readDisk = useCallback(async (): Promise<ManuscriptRead | null> => {
    try {
      return await backend.read(sessionId, episodeId);
    } catch (e) {
      setStatus({ kind: "error", error: asWsError(e) });
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, episodeId, sessionId]);

  /** Our text and the disk both changed: keep all three versions and let the writer choose. */
  const enterConflict = useCallback(
    async (again: boolean) => {
      if (idle.current !== null) window.clearTimeout(idle.current);
      idle.current = null;
      stopped.current = true;
      const r = await readDisk();
      if (!r || !alive.current) return;
      setConflict({ base: conflictRef.current?.base ?? baseText.current, disk: sideOf(r), again, restored: false });
      setMerge(null);
      setStatus({ kind: "conflict" });
      await keepDraft(docText());
    },
    [keepDraft, readDisk],
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
    if (!dirty() || stopped.current) return !dirty();
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
        baseText.current = text;
        savedGen.current = Math.max(savedGen.current, myGen);
        if (alive.current) setDraft(null);
        setStatus(dirty() ? { kind: "dirty" } : { kind: "saved", at: r.savedAt });
        return true;
      } catch (e) {
        const err = asWsError(e);
        if (err.code === "writeConflict") {
          await enterConflict(false);
        } else {
          setStatus({ kind: "failed", error: err });
          await keepDraft(text);
        }
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    const ok = await run;
    const sig = pendingSignal.current;
    pendingSignal.current = null;
    if (sig) await onDiskSignal(sig.exists, sig.hash);
    else if (ok && dirty()) schedule();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, enterConflict, episodeId, keepDraft, readOnly, sessionId]);

  const schedule = useCallback(() => {
    if (idle.current !== null) window.clearTimeout(idle.current);
    idle.current = window.setTimeout(() => {
      idle.current = null;
      void saveNow();
    }, AUTOSAVE_IDLE_MS);
  }, [saveNow]);

  /** A hint that the file may have changed (watcher, window focus, "read again"). */
  const onDiskSignal = useCallback(
    async (exists: boolean, hash: string | null) => {
      if (!alive.current || !view.current) return;
      if (inflight.current) {
        pendingSignal.current = { exists, hash }; // decide after our own save settles
        return;
      }
      const c = conflictRef.current;
      if (c) {
        // Keep the conflict's disk side current.
        const r = await readDisk();
        if (r && alive.current) setConflict({ ...c, disk: sideOf(r) });
        return;
      }
      const m = meta.current;
      if (m && exists && hash !== null && hash === m.hash) return; // same content: nothing happened
      if (m && !exists && m.hash === null) return; // still missing
      if (dirty() || composing()) {
        await enterConflict(false);
        return;
      }
      const r = await readDisk();
      if (!r || !alive.current) return;
      if (r.state === "ok") {
        applyFromDisk(r.text);
        meta.current = { hash: r.hash, bom: r.bom, lineEnding: r.lineEnding, mixed: r.mixedLineEndings };
        baseText.current = r.text;
        setForm({ ...meta.current });
        stopped.current = false;
        setExternalAt(new Date().toISOString());
        setStatus({ kind: "clean" });
      } else if (r.state === "missing") {
        if (meta.current) meta.current.hash = null;
        stopped.current = true;
        setStatus({ kind: "missing" });
      } else if (r.state === "undecodable") {
        stopped.current = true;
        setStatus({ kind: "undecodable", read: r });
      } else {
        stopped.current = true;
        setStatus({ kind: "locked", read: r });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enterConflict, readDisk],
  );

  // Load (or reload) the episode into a fresh editor.
  useEffect(() => {
    alive.current = true;
    stopped.current = false;
    gen.current = 0;
    savedGen.current = 0;
    imeActive.current = false;
    meta.current = null;
    baseText.current = "";
    pendingSignal.current = null;
    conflictRef.current = null;
    setConflictState(null);
    setMerge(null);
    setForm(null);
    setDraft(null);
    setExternalAt(null);
    setStatus({ kind: "loading" });
    let cancelled = false;

    const makeView = (doc: string) => {
      const state = EditorState.create({
        doc,
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
            if (u.transactions.every((tr) => tr.annotation(FromDisk))) return;
            gen.current += 1;
            if (conflictRef.current) {
              // Keep the recovery copy of "mine" current while the writer decides.
              if (draftIdle.current !== null) window.clearTimeout(draftIdle.current);
              draftIdle.current = window.setTimeout(() => void keepDraft(docText()), DRAFT_IDLE_MS);
              return;
            }
            if (statusRef.current.kind !== "missing") setStatus({ kind: "dirty" });
            if (!stopped.current) schedule();
          }),
          EditorView.domEventHandlers({
            compositionstart: () => {
              imeActive.current = true;
              return false;
            },
            compositionend: () => {
              imeActive.current = false;
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
    };

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

      if (r.state === "undecodable" || r.state === "locked") {
        stopped.current = true; // not ours to rewrite; keep any draft as it is
        setDraft(d);
        setStatus(r.state === "undecodable" ? { kind: "undecodable", read: r } : { kind: "locked", read: r });
        return;
      }
      if (r.state === "missing") {
        meta.current = { hash: null, bom: false, lineEnding: "lf", mixed: false };
        setForm({ ...meta.current });
        makeView(d ? d.text : "");
        stopped.current = true;
        if (d) {
          gen.current = 1; // restored text is unsaved
          setConflict({ base: d.baseText ?? "", disk: { kind: "missing" }, again: false, restored: true });
          setStatus({ kind: "conflict" });
        } else {
          setStatus({ kind: "missing" });
        }
        return;
      }

      meta.current = { hash: r.hash, bom: r.bom, lineEnding: r.lineEnding, mixed: r.mixedLineEndings };
      baseText.current = r.text;
      setForm({ ...meta.current });
      // S05.B: a recovery copy based on an older disk version → the conflict is back as it was.
      if (d && d.baseHash && d.baseHash !== r.hash && d.text !== r.text) {
        makeView(d.text);
        gen.current = 1;
        stopped.current = true;
        baseText.current = d.baseText ?? "";
        setConflict({ base: d.baseText ?? "", disk: sideOf(r), again: false, restored: true });
        setStatus({ kind: "conflict" });
        return;
      }
      makeView(r.text);
      setDraft(d && d.text !== r.text ? d : null);
      setStatus({ kind: "clean" });
      const pendingReveal = takeReveal(episodeId);
      if (pendingReveal) applyReveal(pendingReveal);
    })();

    return () => {
      cancelled = true;
      alive.current = false;
      if (idle.current !== null) window.clearTimeout(idle.current);
      if (draftIdle.current !== null) window.clearTimeout(draftIdle.current);
      idle.current = null;
      draftIdle.current = null;
      const v = view.current;
      // Leaving with unsaved text (switch/close without flush): keep a recovery copy.
      if (v && meta.current && dirty() && !readOnly) {
        void backend
          .saveDraft(sessionId, episodeId, meta.current.hash, baseText.current, v.state.doc.toString())
          .catch(() => {});
      }
      v?.destroy();
      view.current = null;
      composeWaiters.current.splice(0).forEach((w) => w());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, sessionId, episodeId, readOnly, reloadTick]);

  // A search hit for this episode while it is already open (12).
  useEffect(() => {
    const on = (e: Event) => {
      const tgt = (e as CustomEvent<RevealTarget>).detail;
      if (tgt.episodeId !== episodeId || tgt.revId || !view.current || statusRef.current.kind === "loading") return;
      const mine = takeReveal(episodeId);
      if (mine) applyReveal(mine);
    };
    window.addEventListener(REVEAL_EVENT, on);
    return () => window.removeEventListener(REVEAL_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  // Disk-change hints for this episode of this session only (late events of another work or
  // episode are ignored — S05.C), plus a re-check whenever the window comes back to the front.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void backend
      .onDiskChange((c) => {
        if (c.sessionId !== sessionId || c.episodeId !== episodeId) return;
        void onDiskSignal(c.exists, c.hash);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    const onFocus = () => {
      void backend
        .probe(sessionId, episodeId)
        .then((p) => onDiskSignal(p.exists, p.hash))
        .catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
    };
  }, [backend, episodeId, onDiskSignal, sessionId]);

  // Expose flush/focus to the app (episode switch, close work, window close).
  useEffect(() => {
    guard.register({
      flush: async () => {
        if (idle.current !== null) {
          window.clearTimeout(idle.current);
          idle.current = null;
        }
        if (!dirty()) return true;
        if (conflictRef.current || stopped.current) {
          await keepDraft(docText()); // unresolved: make sure the recovery copy is current
          return false;
        }
        return saveNow();
      },
      focus: () => view.current?.focus(),
      isDirty: dirty,
      prepareCommit: async () => {
        if (!view.current || !meta.current) return { ok: false, reason: "notReady" };
        if (conflictRef.current) return { ok: false, reason: "conflict" };
        if (idle.current !== null) {
          window.clearTimeout(idle.current);
          idle.current = null;
        }
        if (dirty()) {
          if (stopped.current) return { ok: false, reason: "notReady" }; // missing / undecodable
          if (!(await saveNow())) return { ok: false, reason: conflictRef.current ? "conflict" : "failed" };
        }
        // The disk may have changed outside since we last read or saved it.
        let p: { exists: boolean; hash: string | null };
        try {
          p = await backend.probe(sessionId, episodeId);
        } catch {
          return { ok: false, reason: "failed" };
        }
        if (!p.exists || p.hash === null) return { ok: false, reason: "notReady" };
        if (p.hash !== meta.current?.hash) {
          await onDiskSignal(p.exists, p.hash); // clean → re-read; dirty → conflict
          if (conflictRef.current) return { ok: false, reason: "conflict" };
          if (meta.current?.hash !== p.hash) return { ok: false, reason: "notReady" };
        }
        return { ok: true, hash: meta.current!.hash!, text: docText() };
      },
      replaceText: (text: string) => {
        const v = view.current;
        if (!v || readOnly || conflictRef.current) return false;
        const cur = v.state.doc.toString();
        if (cur !== text) v.dispatch({ changes: diskChanges(cur, text) }); // a writer edit: dirty → saved
        return true;
      },
      currentText: () => (view.current ? docText() : null),
    });
    return () => guard.register(null);
  }, [backend, episodeId, guard, keepDraft, onDiskSignal, readOnly, saveNow, sessionId]);

  // ------------------------------------------------------------ conflict resolution

  /** Save `text` over whatever is on disk now — only the version shown in the conflict. */
  const resolveWith = async (text: string) => {
    const c = conflictRef.current;
    const m = meta.current;
    if (!c || !m) return;
    const disk = c.disk;
    if (disk.kind === "locked") return;
    const expect = disk.kind === "text" || disk.kind === "undecodable" ? disk.hash : null;
    const bom = disk.kind === "text" ? disk.bom : m.bom;
    const lineEnding = disk.kind === "text" ? disk.lineEnding : m.lineEnding;
    setStatus({ kind: "saving" });
    try {
      const r = await backend.save({ sessionId, requestId: newRequestId(), episodeId, text, baseHash: expect, bom, lineEnding });
      if (docText() !== text) {
        const v = view.current!;
        v.dispatch({ changes: diskChanges(v.state.doc.toString(), text), annotations: FromDisk.of(true) });
      }
      meta.current = { hash: r.hash, bom, lineEnding, mixed: false };
      setForm({ ...meta.current });
      baseText.current = text;
      savedGen.current = gen.current;
      stopped.current = false;
      setMerge(null);
      setConflict(null);
      setDraft(null);
      setStatus({ kind: "saved", at: r.savedAt });
    } catch (e) {
      const err = asWsError(e);
      if (err.code === "writeConflict") await enterConflict(true);
      else setStatus({ kind: "failed", error: err });
    }
  };

  const takeDisk = async () => {
    const c = conflictRef.current;
    if (!c) return;
    await backend.discardDraft(sessionId, episodeId).catch(() => {});
    setMerge(null);
    setConflict(null);
    setDraft(null);
    if (c.disk.kind === "text") {
      applyFromDisk(c.disk.text);
      meta.current = { hash: c.disk.hash, bom: c.disk.bom, lineEnding: c.disk.lineEnding, mixed: false };
      setForm({ ...meta.current });
      baseText.current = c.disk.text;
      savedGen.current = gen.current;
      stopped.current = false;
      setStatus({ kind: "clean" });
    } else {
      savedGen.current = gen.current;
      setReloadTick((n) => n + 1); // undecodable/locked: show that state from a fresh read
    }
  };

  const startMerge = () => {
    const c = conflictRef.current;
    if (!c) return;
    setMerge(c.disk.kind === "text" ? merge3(c.base, docText(), c.disk.text).text : docText());
  };

  const recheck = async () => {
    try {
      const p = await backend.probe(sessionId, episodeId);
      await onDiskSignal(p.exists, p.hash);
    } catch {
      /* ignore */
    }
  };

  const reload = () => {
    if (dirty()) {
      void recheck(); // unsaved text: compare with disk instead of throwing it away
      return;
    }
    setReloadTick((n) => n + 1);
  };

  const recreate = async () => {
    const m = meta.current;
    if (!m) return;
    stopped.current = false;
    setStatus({ kind: "saving" });
    try {
      const r = await backend.save({
        sessionId,
        requestId: newRequestId(),
        episodeId,
        text: docText(),
        baseHash: null,
        bom: m.bom,
        lineEnding: m.lineEnding,
      });
      m.hash = r.hash;
      baseText.current = docText();
      savedGen.current = gen.current;
      setStatus({ kind: "saved", at: r.savedAt });
    } catch (e) {
      const err = asWsError(e);
      if (err.code === "writeConflict") await enterConflict(true);
      else setStatus({ kind: "failed", error: err });
    }
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
                  : s.kind === "missing"
                    ? t("manuscript.missingShort")
                    : "";

  const diskBlock = (d: DiskSide) =>
    d.kind === "text" ? (
      <pre className="conflict-text" data-testid="conflict-disk">
        {d.text}
      </pre>
    ) : (
      <p className="muted" data-testid="conflict-disk">
        {d.kind === "missing"
          ? t("conflict.diskMissing")
          : d.kind === "undecodable"
            ? t("conflict.diskUndecodable")
            : t("conflict.diskLocked")}
      </p>
    );

  return (
    <section className="manuscript" aria-label={t("manuscript.label")}>
      {revealed && (
        <p role="status" className={revealed.how === "missing" ? "notice notice-error" : "banner"} data-testid="reveal-note" data-how={revealed.how}>
          {tf(`search.reveal.${revealed.how}` as MessageKey, { text: revealed.matched })}{" "}
          <button type="button" className="link" onClick={() => setRevealed(null)}>
            {t("search.reveal.dismiss")}
          </button>
        </p>
      )}
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
      {s.kind === "missing" && !conflict && (
        <div role="alert" className="notice notice-error">
          <p>{t("manuscript.missing")}</p>
          <p className="actions">
            {!readOnly && (
              <button type="button" onClick={() => void recreate()}>
                {t("manuscript.recreate")}
              </button>
            )}
            <button type="button" onClick={() => setReloadTick((n) => n + 1)}>
              {t("manuscript.reload")}
            </button>
          </p>
        </div>
      )}
      {externalAt && !conflict && s.kind === "clean" && (
        <p role="status" className="banner" data-testid="external-loaded">
          {tf("manuscript.externalLoaded", { time: timeOf(externalAt) })}
        </p>
      )}
      {draft && !conflict && (
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
      {conflict && (
        <div role="alertdialog" aria-label={t("conflict.title")} className="conflict">
          <h3>
            {conflict.again ? t("conflict.again") : conflict.restored ? t("conflict.restored") : t("conflict.title")}
          </h3>
          <p>{t("conflict.kept")}</p>
          <div className="conflict-cols">
            <section>
              <h4>{t("conflict.base")}</h4>
              <pre className="conflict-text" data-testid="conflict-base">
                {conflict.base}
              </pre>
            </section>
            <section>
              <h4>{t("conflict.disk")}</h4>
              {diskBlock(conflict.disk)}
            </section>
          </div>
          <p className="muted">{t("conflict.mineBelow")}</p>
          {merge === null ? (
            <p className="actions">
              <button
                type="button"
                className="primary"
                disabled={conflict.disk.kind === "locked"}
                onClick={() => void resolveWith(docText())}
              >
                {conflict.disk.kind === "undecodable" ? t("conflict.keepMineOverwrite") : t("conflict.keepMine")}
              </button>
              <button type="button" disabled={conflict.disk.kind === "missing"} onClick={() => void takeDisk()}>
                {t("conflict.takeDisk")}
              </button>
              <button type="button" disabled={conflict.disk.kind !== "text"} onClick={startMerge}>
                {t("conflict.merge")}
              </button>
              <button type="button" className="link" onClick={() => void recheck()}>
                {t("conflict.recheck")}
              </button>
            </p>
          ) : (
            <div className="merge">
              <h4>{t("conflict.mergeTitle")}</h4>
              <p className="muted">{t("conflict.mergeHow")}</p>
              <textarea
                className="merge-text"
                aria-label={t("conflict.mergeTitle")}
                value={merge}
                onChange={(e) => setMerge(e.target.value)}
                spellCheck={false}
              />
              {hasConflictMarkers(merge) && <p className="notice notice-error">{t("conflict.markersLeft")}</p>}
              <p className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={hasConflictMarkers(merge)}
                  onClick={() => void resolveWith(merge)}
                >
                  {t("conflict.saveMerged")}
                </button>
                <button type="button" onClick={() => setMerge(null)}>
                  {t("conflict.cancelMerge")}
                </button>
              </p>
            </div>
          )}
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
        <button type="button" onClick={() => void saveNow()} disabled={readOnly || !form || !!conflict}>
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
