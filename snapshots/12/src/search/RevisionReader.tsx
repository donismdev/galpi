// A committed revision opened from a search hit (12): read-only, the hit highlighted and
// scrolled into view. Nothing here can change the revision or the working manuscript.
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useHistoryBackend } from "../history/HistoryPanel";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { resolveReveal, type Resolved } from "./reveal";
import { useSearchUi } from "./SearchUi";

export function RevisionReader() {
  const { t, tf } = useI18n();
  const ui = useSearchUi();
  const history = useHistoryBackend();
  const sessionId = useWorkspace().current?.sessionId ?? null;
  const rv = ui.revision;
  const [text, setText] = useState<{ text: string; ordinal: number; at: Resolved } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mark = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setText(null);
    setError(null);
    if (!rv || !sessionId || !rv.target.revId) return;
    let live = true;
    history.read(sessionId, rv.target.episodeId, rv.target.revId).then(
      (r) => {
        if (!live) return;
        const doc = r.text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
        setText({ text: doc, ordinal: r.ordinal, at: resolveReveal(doc, rv.target) });
      },
      (e) => live && setError(asWsError(e).code),
    );
    return () => {
      live = false;
    };
  }, [history, rv, sessionId]);

  useEffect(() => {
    mark.current?.scrollIntoView?.({ block: "center" });
  }, [text]);

  if (!rv) return null;
  const at = text?.at;
  return (
    <section className="open-card revision-reader" aria-label={tf("search.revision.title", { title: rv.title })} data-testid="revision-reader">
      <div className="search-head">
        <h2>{tf("search.revision.title", { title: rv.title })}</h2>
        <span className="badge">{t("search.revision.readOnly")}</span>
        <button type="button" onClick={ui.back}>
          {t("search.back")}
        </button>
        <button type="button" className="link" onClick={ui.closeRevision}>
          {t("search.close")}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice notice-error">
          {t(`errors.${error}` as MessageKey)}
        </p>
      )}
      {at?.how === "missing" && <p className="notice notice-error">{tf("search.reveal.missing", { text: rv.target.matched })}</p>}
      {text && at && (
        <pre className="revision-text" tabIndex={0}>
          {text.text.slice(0, at.from)}
          <mark ref={mark} data-testid="revision-mark">
            {text.text.slice(at.from, at.to)}
          </mark>
          {text.text.slice(at.to)}
        </pre>
      )}
    </section>
  );
}
