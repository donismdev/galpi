// Episode commits, history, comparison and restore (06).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useEditorGuard } from "../manuscript/EditorGuard";
import { asWsError, newRequestId } from "../workspace/api";
import { browserHistoryBackend, type CommitResult, type History, type HistoryBackend, type RevisionInfo } from "./api";
import { textDiff, type DiffLine, type DiffStats } from "./diff";

const Ctx = createContext<HistoryBackend>(browserHistoryBackend);
export function HistoryBackendProvider({ backend, children }: { backend: HistoryBackend; children: ReactNode }) {
  return <Ctx.Provider value={backend}>{children}</Ctx.Provider>;
}
export const useHistoryBackend = () => useContext(Ctx);

const WORK = "work";
type Side = string; // revisionId or WORK

function timeOf(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function StatsLine({ s }: { s: DiffStats }) {
  const { tf } = useI18n();
  return (
    <span className="diff-stats">
      {tf("history.stats", { lines: s.changedLines, add: s.addedChars, del: s.removedChars })}
    </span>
  );
}

/** Unchanged runs longer than this are folded, keeping CONTEXT lines around changes. */
const FOLD = 6;
const CONTEXT = 2;

export function DiffView({ lines }: { lines: DiffLine[] }) {
  const { tf } = useI18n();
  const rows: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind === "same") {
      let j = i;
      while (j < lines.length && lines[j].kind === "same") j++;
      const run = j - i;
      const keepStart = i === 0 ? 0 : CONTEXT;
      const keepEnd = j === lines.length ? 0 : CONTEXT;
      if (run > FOLD && run > keepStart + keepEnd) {
        for (let k = i; k < i + keepStart; k++) rows.push(<Row key={k} l={lines[k]} />);
        rows.push(
          <div key={`fold-${i}`} className="diff-fold">
            {tf("history.folded", { n: run - keepStart - keepEnd })}
          </div>,
        );
        for (let k = j - keepEnd; k < j; k++) rows.push(<Row key={k} l={lines[k]} />);
      } else {
        for (let k = i; k < j; k++) rows.push(<Row key={k} l={lines[k]} />);
      }
      i = j;
    } else {
      rows.push(<Row key={i} l={lines[i]} />);
      i++;
    }
  }
  return (
    <div className="diff" data-testid="diff">
      {rows}
    </div>
  );
}

function Row({ l }: { l: DiffLine }) {
  if (l.kind === "same")
    return (
      <div className="diff-row same">
        <span className="ln">{l.a}</span>
        <span className="tx">{l.text || " "}</span>
      </div>
    );
  if (l.kind === "add")
    return (
      <div className="diff-row add">
        <span className="ln">+{l.b}</span>
        <span className="tx">{l.text || " "}</span>
      </div>
    );
  if (l.kind === "del")
    return (
      <div className="diff-row del">
        <span className="ln">−{l.a}</span>
        <span className="tx">{l.text || " "}</span>
      </div>
    );
  return (
    <div className="diff-row mod">
      <span className="ln">~{l.b}</span>
      <span className="tx">
        {l.segs.map((s, k) =>
          s.kind === "same" ? (
            <span key={k}>{s.text}</span>
          ) : s.kind === "add" ? (
            <ins key={k}>{s.text}</ins>
          ) : (
            <del key={k}>{s.text}</del>
          ),
        )}
      </span>
    </div>
  );
}

export function HistoryPanel({ sessionId, episodeId, readOnly }: { sessionId: string; episodeId: string; readOnly: boolean }) {
  const { t, tf } = useI18n();
  const backend = useHistoryBackend();
  const guard = useEditorGuard();
  const [history, setHistory] = useState<History>({ revisions: [], problems: [] });
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "info" | "error"; text: string } | null>(null);
  const [compare, setCompare] = useState<{ left: Side; right: Side } | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const pending = useRef<string | null>(null); // one commit intent = one request id
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const h = await backend.list(sessionId, episodeId);
      if (!alive.current) return;
      setHistory(h);
      const entries = await Promise.all(
        h.revisions.map(async (r) => [r.revisionId, (await backend.read(sessionId, episodeId, r.revisionId)).text] as const),
      );
      if (alive.current) setTexts(Object.fromEntries(entries));
    } catch {
      /* listing is best effort; errors show on actions */
    }
  }, [backend, episodeId, sessionId]);

  useEffect(() => {
    alive.current = true;
    setCompare(null);
    setNote(null);
    pending.current = null;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const revs = history.revisions;
  const latest = revs.at(-1) ?? null;
  const textOf = (side: Side) => (side === WORK ? (guard.currentText() ?? "") : (texts[side] ?? ""));
  const labelOf = (side: Side) =>
    side === WORK ? t("history.work") : `r${revs.find((r) => r.revisionId === side)?.ordinal ?? "?"}`;

  const statsVsParent = useMemo(() => {
    const out: Record<string, DiffStats> = {};
    revs.forEach((r, i) => {
      const prev = i > 0 ? texts[revs[i - 1].revisionId] : "";
      const cur = texts[r.revisionId];
      if (cur !== undefined && prev !== undefined) out[r.revisionId] = textDiff(prev, cur).stats;
    });
    return out;
  }, [revs, texts]);

  const reasonText = (r: "conflict" | "failed" | "notReady") =>
    r === "conflict" ? t("history.needResolve") : r === "failed" ? t("history.saveFirstFailed") : t("history.notReady");

  const doCommit = async () => {
    if (busy || readOnly) return;
    setBusy(true);
    setNote(null);
    pending.current ??= newRequestId();
    const requestId = pending.current;
    try {
      let ready = await guard.prepareCommit();
      if (!ready.ok) {
        setNote({ kind: "error", text: reasonText(ready.reason) });
        return;
      }
      let res: CommitResult;
      try {
        res = await backend.commit({ sessionId, requestId, episodeId, message, expectedHash: ready.hash });
      } catch (e) {
        if (asWsError(e).code !== "writeConflict") throw e;
        // The file changed between our check and the commit: re-read once and retry the same request.
        ready = await guard.prepareCommit();
        if (!ready.ok) {
          setNote({ kind: "error", text: reasonText(ready.reason) });
          return;
        }
        res = await backend.commit({ sessionId, requestId, episodeId, message, expectedHash: ready.hash });
      }
      pending.current = null;
      if (res.outcome === "noChange") {
        setNote({ kind: "info", text: tf("history.noChange", { n: res.revision.ordinal }) });
      } else {
        setMessage("");
        setNote({
          kind: "ok",
          text: tf(res.outcome === "created" ? "history.created" : "history.sameRequest", { n: res.revision.ordinal }),
        });
        await load();
      }
    } catch (e) {
      const err = asWsError(e);
      setNote({ kind: "error", text: `${t("history.commitFailed")} ${t(`errors.${err.code}` as MessageKey)}` });
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (rev: RevisionInfo) => {
    setConfirmRestore(null);
    setNote(null);
    setBusy(true);
    try {
      const ready = await guard.prepareCommit(); // saved and up to date first
      if (!ready.ok) {
        setNote({ kind: "error", text: reasonText(ready.reason) });
        return;
      }
      const target = texts[rev.revisionId] ?? (await backend.read(sessionId, episodeId, rev.revisionId)).text;
      let backupPath: string | null = null;
      const latestText = latest ? texts[latest.revisionId] : undefined;
      if (ready.text !== latestText) backupPath = await backend.backup(sessionId, episodeId); // uncommitted work
      if (!guard.replaceText(target) || !(await guard.flush())) {
        setNote({ kind: "error", text: t("history.restoreFailed") });
        return;
      }
      setNote({
        kind: "ok",
        text:
          tf("history.restored", { n: rev.ordinal, next: (latest?.ordinal ?? 0) + 1 }) +
          (backupPath ? ` ${tf("history.backupAt", { path: backupPath })}` : ""),
      });
    } catch (e) {
      const err = asWsError(e);
      setNote({ kind: "error", text: `${t("history.restoreFailed")} ${t(`errors.${err.code}` as MessageKey)}` });
    } finally {
      setBusy(false);
    }
  };

  const diff = compare ? textDiff(textOf(compare.left), textOf(compare.right)) : null;
  const sides: Side[] = [...revs.map((r) => r.revisionId), WORK];

  return (
    <section className="history" aria-label={t("history.title")}>
      <h3>{t("history.title")}</h3>
      {!readOnly && (
        <div className="commit-box">
          <input
            aria-label={t("history.messageLabel")}
            placeholder={t("history.messagePlaceholder")}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => void doCommit()}>
            {busy ? t("history.committing") : t("history.commit")}
          </button>
        </div>
      )}
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "notice notice-error" : "banner"}>
          {note.text}
        </p>
      )}
      <details className="muted history-help">
        <summary>{t("history.helpTitle")}</summary>
        <p>{t("history.help")}</p>
      </details>
      {revs.length === 0 ? (
        <p className="muted">{t("history.none")}</p>
      ) : (
        <ol className="rev-list" reversed>
          {[...revs].reverse().map((r, idx) => {
            const st = statsVsParent[r.revisionId];
            const prev = revs[revs.length - 2 - idx];
            return (
              <li key={r.revisionId} className="rev-row" data-testid={`rev-${r.ordinal}`}>
                <strong>r{r.ordinal}</strong>
                <span className="muted">{timeOf(r.createdAt)}</span>
                <span>{r.message || t("history.noMessage")}</span>
                {st && <StatsLine s={st} />}
                <span className="spacer" />
                {prev && (
                  <button type="button" onClick={() => setCompare({ left: prev.revisionId, right: r.revisionId })}>
                    {tf("history.comparePrev", { n: r.ordinal })}
                  </button>
                )}
                {!readOnly &&
                  (confirmRestore === r.revisionId ? (
                    <>
                      <button type="button" className="primary" disabled={busy} onClick={() => void doRestore(r)}>
                        {tf("history.restoreConfirm", { n: r.ordinal })}
                      </button>
                      <button type="button" className="link" onClick={() => setConfirmRestore(null)}>
                        {t("history.cancel")}
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmRestore(r.revisionId)}>
                      {tf("history.restore", { n: r.ordinal })}
                    </button>
                  ))}
              </li>
            );
          })}
        </ol>
      )}
      {history.problems.length > 0 && (
        <div className="notice notice-error">
          <p>{t("history.problems")}</p>
          <ul>
            {history.problems.map((p) => (
              <li key={p.folder} className="mono">
                {p.folder} — {p.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {revs.length > 0 && (
        <div className="compare">
          <p className="actions">
            <label>
              {t("history.left")}{" "}
              <select
                aria-label={t("history.left")}
                value={compare?.left ?? ""}
                onChange={(e) => setCompare({ left: e.target.value, right: compare?.right ?? WORK })}
              >
                <option value="" disabled>
                  —
                </option>
                {sides.map((s) => (
                  <option key={s} value={s}>
                    {labelOf(s)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("history.right")}{" "}
              <select
                aria-label={t("history.right")}
                value={compare?.right ?? ""}
                onChange={(e) => setCompare({ left: compare?.left ?? revs[0].revisionId, right: e.target.value })}
              >
                <option value="" disabled>
                  —
                </option>
                {sides.map((s) => (
                  <option key={s} value={s}>
                    {labelOf(s)}
                  </option>
                ))}
              </select>
            </label>
            {compare && (
              <button type="button" className="link" onClick={() => setCompare(null)}>
                {t("history.closeCompare")}
              </button>
            )}
          </p>
          {compare && diff && (
            <div>
              <p>
                <strong>
                  {labelOf(compare.left)} → {labelOf(compare.right)}
                </strong>{" "}
                {diff.identical ? <span className="muted">{t("history.identical")}</span> : <StatsLine s={diff.stats} />}
              </p>
              {!diff.identical && <DiffView lines={diff.lines} />}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
