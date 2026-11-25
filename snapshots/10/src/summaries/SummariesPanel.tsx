// "회차 요약" root (07): every episode with its summary's first line and review state; a detail
// view to edit the summary and the next-episode note and to confirm the summary against the
// newest commit ("이대로 확인" / "수정 후 확인"), with a diff from the confirmed to the current
// revision when a recheck is needed.
import { useCallback, useEffect, useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useHistoryBackend, DiffView } from "../history/HistoryPanel";
import { textDiff, type TextDiff } from "../history/diff";
import { asWsError, newRequestId } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useSummaryBackend, type ReviewState, type SummaryDoc, type SummaryStatus, type TextKind } from "./api";

export function StateBadge({ s }: { s: Pick<SummaryStatus, "state" | "reviewedOrdinal" | "latestOrdinal"> }) {
  const { t, tf } = useI18n();
  const text =
    s.state === "reviewed"
      ? tf("summary.state.reviewed", { n: s.latestOrdinal ?? "?" })
      : s.state === "recheck"
        ? tf("summary.state.recheck", { from: s.reviewedOrdinal ?? "?", to: s.latestOrdinal ?? "?" })
        : t(`summary.state.${s.state}` as MessageKey);
  return (
    <span className={`state-badge state-${s.state}`} data-testid="summary-state">
      {text}
    </span>
  );
}

function SummaryDetail({ sessionId, episodeId, readOnly, onChanged, onBack }: {
  sessionId: string;
  episodeId: string;
  readOnly: boolean;
  onChanged: () => void;
  onBack: () => void;
}) {
  const { t, tf } = useI18n();
  const backend = useSummaryBackend();
  const historyBackend = useHistoryBackend();
  const sumId = useId();
  const noteId = useId();
  const [doc, setDoc] = useState<SummaryDoc | null>(null);
  const [summary, setSummary] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [diff, setDiff] = useState<TextDiff | null>(null);

  const apply = (d: SummaryDoc) => {
    setDoc(d);
    setSummary(d.summary.text);
    setNote(d.note.text);
  };

  const load = useCallback(async () => {
    try {
      apply(await backend.read(sessionId, episodeId));
      setDiff(null);
    } catch (e) {
      setMsg({ kind: "error", text: t(`errors.${asWsError(e).code}` as MessageKey) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, episodeId, sessionId]);

  useEffect(() => {
    setMsg(null);
    void load();
  }, [load]);

  const summaryDirty = doc !== null && summary !== doc.summary.text;
  const noteDirty = doc !== null && note !== doc.note.text;

  // Changes made outside the app: re-read when the window comes back, unless the writer has
  // unsaved text here (then saving will report the conflict instead of overwriting).
  useEffect(() => {
    const onFocus = () => {
      if (!summaryDirty && !noteDirty) void load();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, noteDirty, summaryDirty]);

  const save = async (kind: TextKind): Promise<SummaryDoc | null> => {
    if (!doc) return null;
    const file = kind === "summary" ? doc.summary : doc.note;
    const text = kind === "summary" ? summary : note;
    try {
      const d = await backend.save({ sessionId, requestId: newRequestId(), episodeId, kind, text, expectedHash: file.hash });
      setDoc(d); // keep the editor text as typed (it is what was saved)
      onChanged();
      return d;
    } catch (e) {
      const err = asWsError(e);
      setMsg({
        kind: "error",
        text: err.code === "writeConflict" ? t("summary.changedOutside") : `${t("summary.saveFailed")} ${t(`errors.${err.code}` as MessageKey)}`,
      });
      return null;
    }
  };

  const onSave = async (kind: TextKind) => {
    setBusy(true);
    setMsg(null);
    const d = await save(kind);
    if (d) setMsg({ kind: "ok", text: kind === "summary" ? t("summary.saved") : t("summary.noteSaved") });
    setBusy(false);
  };

  const confirm = async (afterEdit: boolean) => {
    if (!doc?.status.latestRevisionId) return;
    setBusy(true);
    setMsg(null);
    try {
      let current = doc;
      if (afterEdit && summaryDirty) {
        const d = await save("summary");
        if (!d) return;
        current = d;
      }
      const d = await backend.confirm(sessionId, newRequestId(), episodeId, current.status.latestRevisionId!);
      apply(d);
      setDiff(null);
      onChanged();
      setMsg({ kind: "ok", text: tf("summary.confirmed", { n: d.status.latestOrdinal ?? "?" }) });
    } catch (e) {
      const err = asWsError(e);
      if (err.code === "writeConflict") {
        await load(); // a newer commit arrived: show it first
        setMsg({ kind: "error", text: t("summary.newerCommit") });
      } else setMsg({ kind: "error", text: t(`errors.${err.code}` as MessageKey) });
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async () => {
    const st = doc?.status;
    if (!st?.reviewedRevisionId || !st.latestRevisionId) return;
    try {
      const [a, b] = await Promise.all([
        historyBackend.read(sessionId, episodeId, st.reviewedRevisionId),
        historyBackend.read(sessionId, episodeId, st.latestRevisionId),
      ]);
      setDiff(textDiff(a.text, b.text));
    } catch (e) {
      setMsg({ kind: "error", text: t(`errors.${asWsError(e).code}` as MessageKey) });
    }
  };

  if (!doc) return <p className="muted">{t("manuscript.loading")}</p>;
  const st = doc.status;
  const canConfirm = !readOnly && !!st.latestRevisionId && summary.trim() !== "";

  return (
    <section className="open-card summary-detail" aria-label={tf("summary.detailLabel", { n: st.number })}>
      <p>
        <button type="button" className="link" onClick={onBack}>
          {t("summary.back")}
        </button>
      </p>
      <h2>
        {st.title ? tf("episodes.labelWithTitle", { n: st.number, title: st.title }) : tf("episodes.label", { n: st.number })}{" "}
        <StateBadge s={st} />
      </h2>
      <p className="muted">{t(`summary.explain.${st.state}` as MessageKey)}</p>
      {st.uncommittedEdits && <p className="muted">{t("summary.uncommitted")}</p>}
      {st.summaryEditedSinceReview && <p className="muted">{t("summary.editedSinceReview")}</p>}
      {msg && (
        <p role={msg.kind === "error" ? "alert" : "status"} className={msg.kind === "error" ? "notice notice-error" : "banner"}>
          {msg.text}{" "}
          {msg.kind === "error" && (
            <button type="button" className="link" onClick={() => void load()}>
              {t("summary.reload")}
            </button>
          )}
        </p>
      )}

      {(st.state === "recheck" || st.state === "unreviewed" || st.state === "reviewed") && !readOnly && (
        <div className="review-box">
          {st.state === "recheck" && (
            <button type="button" onClick={() => void showDiff()}>
              {tf("summary.compare", { from: st.reviewedOrdinal ?? "?", to: st.latestOrdinal ?? "?" })}
            </button>
          )}
          <button type="button" className="primary" disabled={busy || !canConfirm || summaryDirty} onClick={() => void confirm(false)}>
            {tf("summary.confirmAsIs", { n: st.latestOrdinal ?? "?" })}
          </button>
          <button type="button" disabled={busy || !canConfirm || !summaryDirty} onClick={() => void confirm(true)}>
            {tf("summary.confirmAfterEdit", { n: st.latestOrdinal ?? "?" })}
          </button>
          {summaryDirty && <span className="muted">{t("summary.dirtyHint")}</span>}
        </div>
      )}
      {diff && (
        <div>
          <p className="muted">
            {tf("summary.diffTitle", { from: st.reviewedOrdinal ?? "?", to: st.latestOrdinal ?? "?" })}
            {diff.identical ? ` — ${t("history.identical")}` : ""}
          </p>
          {!diff.identical && <DiffView lines={diff.lines} />}
        </div>
      )}

      <p className="field">
        <label htmlFor={sumId}>{t("summary.summaryLabel")}</label>
        <textarea
          id={sumId}
          className="summary-text"
          value={summary}
          readOnly={readOnly}
          placeholder={t("summary.summaryPlaceholder")}
          onChange={(e) => setSummary(e.target.value)}
        />
      </p>
      {!readOnly && (
        <p className="actions">
          <button type="button" disabled={busy || !summaryDirty} onClick={() => void onSave("summary")}>
            {t("summary.save")}
          </button>
        </p>
      )}
      <p className="field">
        <label htmlFor={noteId}>{tf("summary.noteLabel", { n: st.number + 1 })}</label>
        <textarea
          id={noteId}
          className="summary-text note-text"
          value={note}
          readOnly={readOnly}
          placeholder={t("summary.notePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
        />
      </p>
      {!readOnly && (
        <p className="actions">
          <button type="button" disabled={busy || !noteDirty} onClick={() => void onSave("note")}>
            {t("summary.saveNote")}
          </button>
        </p>
      )}
    </section>
  );
}

export function SummariesPanel() {
  const { t, tf } = useI18n();
  const backend = useSummaryBackend();
  const ws = useWorkspace();
  const sessionId = ws.current?.sessionId ?? null;
  const readOnly = ws.current?.mode === "readOnly";
  const [rows, setRows] = useState<SummaryStatus[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!sessionId) return;
    try {
      setRows(await backend.list(sessionId));
    } catch {
      /* listing is best effort */
    }
  }, [backend, sessionId]);
  useEffect(() => {
    setOpen(null);
    void reload();
  }, [reload]);

  if (!sessionId) return null;
  if (open) {
    return (
      <SummaryDetail
        sessionId={sessionId}
        episodeId={open}
        readOnly={readOnly}
        onChanged={() => void reload()}
        onBack={() => {
          setOpen(null);
          void reload();
        }}
      />
    );
  }
  const counts = rows.reduce<Record<ReviewState, number>>(
    (m, r) => ({ ...m, [r.state]: m[r.state] + 1 }),
    { unwritten: 0, noRevision: 0, unreviewed: 0, reviewed: 0, recheck: 0 },
  );
  return (
    <section className="summaries">
      {rows.length === 0 ? (
        <p className="empty">{t("episodes.none")}</p>
      ) : (
        <>
          <p className="muted">
            {tf("summary.counts", { recheck: counts.recheck, unreviewed: counts.unreviewed, unwritten: counts.unwritten })}
          </p>
          <ul className="summary-list">
            {rows.map((r) => (
              <li key={r.episodeId}>
                <button type="button" className="summary-row" onClick={() => setOpen(r.episodeId)}>
                  <strong>{tf("episodes.label", { n: r.number })}</strong>
                  <span className="summary-first">{r.firstLine || t("summary.noSummary")}</span>
                  {r.hasNote && <span className="muted">{t("summary.hasNote")}</span>}
                  <StateBadge s={r} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
