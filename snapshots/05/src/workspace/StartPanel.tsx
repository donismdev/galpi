import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import type { Inspection } from "./api";
import { useWorkspace, type Notice } from "./WorkspaceProvider";

export function NoticeLine({ notice }: { notice: Notice | null }) {
  const { t } = useI18n();
  if (!notice) return null;
  if (notice.kind === "cancelled") return <p role="status" className="notice">{t("workspace.cancelled")}</p>;
  if (notice.kind === "closed") return <p role="status" className="notice">{t("workspace.closed")}</p>;
  const detail = typeof notice.error.detail === "string" ? notice.error.detail : null;
  return (
    <div role="alert" className="notice notice-error">
      <p>{t(`errors.${notice.error.code}` as MessageKey)}</p>
      {notice.path && <p className="mono">{notice.path}</p>}
      {detail && <p className="mono">{detail}</p>}
    </div>
  );
}

function Decide({ inspection }: { inspection: Inspection }) {
  const { t, tf } = useI18n();
  const ws = useWorkspace();
  const titleId = useId();
  const [title, setTitle] = useState(inspection.title ?? t("workspace.defaultTitle"));
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => setConfirmed(false), [inspection]);

  const create = (path: string, opts: { confirmNonEmpty?: boolean; createFolder?: boolean } = {}) =>
    ws.createWork({
      path,
      title: title.trim() || t("workspace.defaultTitle"),
      trackLabel: t("workspace.defaultTrack"),
      confirmNonEmpty: opts.confirmNonEmpty ?? false,
      createFolder: opts.createFolder ?? false,
    });

  const titleField = (
    <p className="field">
      <label htmlFor={titleId}>{t("workspace.titleLabel")}</label>
      <input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} />
    </p>
  );

  let body;
  switch (inspection.kind) {
    case "empty":
      body = (
        <>
          <h2>{t("workspace.emptyTitle")}</h2>
          <p>{t("workspace.emptyBody")}</p>
          {titleField}
          <button type="button" className="primary" onClick={() => create(inspection.path)}>
            {t("workspace.create")}
          </button>
        </>
      );
      break;
    case "nonEmpty":
      body =
        inspection.conflicts.length > 0 ? (
          <>
            <h2>{t("workspace.conflictTitle")}</h2>
            <p>{t("workspace.conflictBody")}</p>
            <ul className="conflicts">
              {inspection.conflicts.map((c) => (
                <li key={c} className="mono">
                  {c}
                </li>
              ))}
            </ul>
            {inspection.suggestion && (
              <>
                {titleField}
                <p className="mono">{inspection.suggestion}</p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => create(inspection.suggestion!, { createFolder: true })}
                >
                  {t("workspace.conflictSuggest")}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <h2>{t("workspace.nonEmptyTitle")}</h2>
            <p>{tf("workspace.nonEmptyBody", { count: inspection.entryCount })}</p>
            {titleField}
            <label className="check">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              {t("workspace.nonEmptyConfirm")}
            </label>
            <button
              type="button"
              className="primary"
              disabled={!confirmed}
              onClick={() => create(inspection.path, { confirmNonEmpty: true })}
            >
              {t("workspace.create")}
            </button>
          </>
        );
      break;
    case "incompleteInit":
      body = (
        <>
          <h2>{t("workspace.incompleteTitle")}</h2>
          <p>{tf("workspace.incompleteBody", { title: inspection.title ?? "" })}</p>
          <button type="button" className="primary" onClick={() => create(inspection.path, { confirmNonEmpty: true })}>
            {t("workspace.resume")}
          </button>
        </>
      );
      break;
    case "invalidWorkspace":
      body = (
        <>
          <h2>{t("workspace.invalidTitle")}</h2>
          <p>{t("workspace.invalidBody")}</p>
          {inspection.detail && <p className="mono">{inspection.detail}</p>}
        </>
      );
      break;
    default:
      body = null;
  }

  return (
    <section className="open-card" aria-live="polite">
      <p className="mono path-line">
        {t("workspace.folderLabel")}: {inspection.path}
      </p>
      {body}
      <p>
        <button type="button" className="link" onClick={ws.backToStart}>
          {t("workspace.back")}
        </button>
      </p>
    </section>
  );
}

export function StartPanel() {
  const { t } = useI18n();
  const ws = useWorkspace();

  if (ws.flow.step === "decide") {
    return (
      <>
        <NoticeLine notice={ws.notice} />
        <Decide inspection={ws.flow.inspection} />
      </>
    );
  }

  const busy = ws.flow.step === "busy";
  return (
    <>
      <NoticeLine notice={ws.notice} />
      <section className="open-card">
        <h2>{t("workspace.openTitle")}</h2>
        <p>{t("workspace.openBody")}</p>
        {ws.supported ? (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => ws.chooseFolder(t("workspace.defaultTitle"))}
          >
            {busy ? t("workspace.busy") : t("workspace.openAction")}
          </button>
        ) : (
          <p className="not-yet">{t("workspace.browserOnly")}</p>
        )}
      </section>

      {ws.supported && (
        <section className="recent">
          <h2>{t("workspace.recentTitle")}</h2>
          {ws.recent.length === 0 ? (
            <p className="muted">{t("workspace.recentEmpty")}</p>
          ) : (
            <ul>
              {ws.recent.map((r) => (
                <li key={r.path}>
                  <div className="recent-text">
                    <strong>{r.title}</strong>
                    <span className="mono">{r.path}</span>
                  </div>
                  {/* Not disabled while busy: a slow folder must not trap the writer. Late answers are dropped. */}
                  <button type="button" onClick={() => ws.openPath(r.path)}>
                    {t("workspace.recentOpen")}
                  </button>
                  <button type="button" className="link" onClick={() => ws.forgetRecent(r.path)}>
                    {t("workspace.recentForget")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
