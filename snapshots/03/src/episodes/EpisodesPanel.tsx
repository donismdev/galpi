import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { EDITOR_KINDS, type EditorKind, type EpisodeInfo } from "./api";
import { useEpisodes } from "./EpisodesProvider";

export function useEpisodeLabel() {
  const { tf } = useI18n();
  return (e: Pick<EpisodeInfo, "number" | "title">) =>
    e.title ? tf("episodes.labelWithTitle", { n: e.number, title: e.title }) : tf("episodes.label", { n: e.number });
}

/** Episode rows under the "Episodes" root in the sidebar. */
export function EpisodeNav({ onPick }: { onPick: () => void }) {
  const eps = useEpisodes();
  const label = useEpisodeLabel();
  const { t } = useI18n();
  if (eps.list.episodes.length === 0) return null;
  return (
    <ul className="episode-nav" aria-label={t("episodes.listLabel")}>
      {eps.list.episodes.map((e) => (
        <li key={e.episodeId}>
          <button
            type="button"
            className="episode-row"
            aria-current={eps.selectedId === e.episodeId ? "true" : undefined}
            onClick={() => {
              eps.select(e.episodeId);
              onPick();
            }}
          >
            {label(e)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function editorName(t: (k: MessageKey) => string, k: EditorKind) {
  return t(`editor.${k}` as MessageKey);
}

function LaunchLine({ episodeId }: { episodeId: string }) {
  const { t, tf } = useI18n();
  const eps = useEpisodes();
  const l = eps.launch;
  if (!l || l.episodeId !== episodeId) return null;
  if (l.kind === "sent") {
    return (
      <p role="status" className="banner">
        {tf("editor.sent", { editor: editorName(t, l.result.editor) })}
      </p>
    );
  }
  const tried = Array.isArray(l.error.tried) ? (l.error.tried as string[]) : [];
  const detail = typeof l.error.detail === "string" ? l.error.detail : null;
  const others = EDITOR_KINDS.filter((k) => k !== l.editor && k !== "builtin");
  return (
    <div role="alert" className="notice notice-error">
      <p>
        {tf("editor.failed", { editor: editorName(t, l.editor) })} {t(`errors.${l.error.code}` as MessageKey)}
      </p>
      {tried.length > 0 && (
        <p className="mono">
          {t("editor.tried")}: {tried.join(" · ")}
        </p>
      )}
      {detail && <p className="mono">{detail}</p>}
      <p className="actions">
        {others.map((k) => (
          <button key={k} type="button" onClick={() => eps.openIn(episodeId, k)}>
            {tf("editor.openWithOther", { editor: editorName(t, k) })}
          </button>
        ))}
      </p>
    </div>
  );
}

function EpisodeDetail({ episode, readOnly }: { episode: EpisodeInfo; readOnly: boolean }) {
  const { t, tf } = useI18n();
  const eps = useEpisodes();
  const titleId = useId();
  const [title, setTitle] = useState(episode.title);
  useEffect(() => setTitle(episode.title), [episode.episodeId, episode.title]);
  const commitTitle = () => {
    if (title.trim() !== episode.title) void eps.rename(episode.episodeId, title);
  };
  const label = useEpisodeLabel();

  return (
    <section className="open-card episode-detail" aria-label={label(episode)}>
      <h2>{label(episode)}</h2>
      <p className="field">
        <label htmlFor={titleId}>{t("episodes.titleLabel")}</label>
        <input
          id={titleId}
          value={title}
          disabled={readOnly}
          placeholder={t("episodes.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && commitTitle()}
        />
      </p>
      <p className="muted">{t("episodes.pathLabel")}</p>
      <p className="mono path-box" data-testid="manuscript-path">
        {episode.manuscriptPath}
      </p>
      <p className="actions">
        <button type="button" className="primary" onClick={() => eps.openIn(episode.episodeId, eps.editor.kind)}>
          {tf("editor.reopen", { editor: editorName(t, eps.editor.kind) })}
        </button>
        {EDITOR_KINDS.filter((k) => k !== eps.editor.kind && k !== "builtin").map((k) => (
          <button key={k} type="button" onClick={() => eps.openIn(episode.episodeId, k)}>
            {tf("editor.openWithOther", { editor: editorName(t, k) })}
          </button>
        ))}
      </p>
      <LaunchLine episodeId={episode.episodeId} />
    </section>
  );
}

function EditorSettingsBox() {
  const { t } = useI18n();
  const eps = useEpisodes();
  const selectId = useId();
  const pathId = useId();
  const [path, setPath] = useState(eps.editor.vscodePath ?? "");
  useEffect(() => setPath(eps.editor.vscodePath ?? ""), [eps.editor.vscodePath]);
  const d = eps.detected;
  return (
    <details className="editor-settings">
      <summary>{t("editor.settings")}</summary>
      <p className="field">
        <label htmlFor={selectId}>{t("editor.defaultLabel")}</label>
        <select
          id={selectId}
          value={eps.editor.kind}
          onChange={(e) => eps.setEditor({ ...eps.editor, kind: e.target.value as EditorKind })}
        >
          {EDITOR_KINDS.map((k) => (
            <option key={k} value={k}>
              {editorName(t, k)}
              {k === "builtin" ? ` (${t("editor.builtinLater")})` : ""}
            </option>
          ))}
        </select>
      </p>
      <p className="field">
        <label htmlFor={pathId}>{t("editor.vscodePath")}</label>
        <input
          id={pathId}
          value={path}
          placeholder={t("editor.vscodePathPlaceholder")}
          onChange={(e) => setPath(e.target.value)}
          onBlur={() => path !== (eps.editor.vscodePath ?? "") && eps.setEditor({ ...eps.editor, vscodePath: path })}
        />
      </p>
      {d && (
        <p className="mono muted">
          VS Code: {d.vscode ?? `${t("editor.notFound")} (${d.vscodeTried.join(" · ")})`}
          <br />
          {t("editor.notepad")}: {d.notepad ?? t("editor.notFound")}
        </p>
      )}
    </details>
  );
}

/** Main area for the "Episodes" root while a work is open. */
export function EpisodesPanel() {
  const { t, tf } = useI18n();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const readOnly = ws.current?.mode === "readOnly";
  const selected = eps.list.episodes.find((e) => e.episodeId === eps.selectedId) ?? null;
  const last = eps.list.episodes.at(-1);

  return (
    <>
      <section className="episodes-head">
        <button
          type="button"
          className="primary big"
          disabled={readOnly || eps.creating || !eps.supported}
          onClick={() => void eps.writeNext()}
        >
          {eps.creating ? t("episodes.creating") : tf("episodes.writeNext", { n: (last?.number ?? 0) + 1 })}
        </button>
        <span className="muted">
          {tf("episodes.opensWith", { editor: editorName(t, eps.editor.kind) })}
        </span>
      </section>
      {readOnly && <p className="muted">{t("episodes.readOnlyNoCreate")}</p>}
      {eps.createError && (
        <div role="alert" className="notice notice-error">
          <p>
            {t("episodes.createFailed")} {t(`errors.${eps.createError.code}` as MessageKey)}
          </p>
          <p>{t("episodes.retrySame")}</p>
        </div>
      )}
      {eps.list.episodes.length === 0 && !eps.loading && <p className="empty">{t("episodes.none")}</p>}
      {selected && <EpisodeDetail episode={selected} readOnly={readOnly} />}
      {eps.list.problems.length > 0 && (
        <section className="notice notice-error">
          <p>{t("episodes.problems")}</p>
          <ul>
            {eps.list.problems.map((p) => (
              <li key={p.folder} className="mono">
                {p.folder} — {p.detail}
              </li>
            ))}
          </ul>
        </section>
      )}
      <EditorSettingsBox />
    </>
  );
}
