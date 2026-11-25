// The note the writer left in the previous episode ("다음 화 메모"), shown next to this episode
// (07). Shown open right after "write next" made this episode, folded otherwise. Read-only here:
// it is never copied into this episode's manuscript or summary.
import { useEffect, useState } from "react";
import type { EpisodeInfo } from "../episodes/api";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { useI18n } from "../i18n/I18nProvider";
import { useSummaryBackend } from "./api";

export function PrevNote({ sessionId, episode }: { sessionId: string; episode: EpisodeInfo }) {
  const { tf } = useI18n();
  const backend = useSummaryBackend();
  const eps = useEpisodes();
  const prev = eps.list.episodes
    .filter((e) => e.number < episode.number)
    .reduce<EpisodeInfo | null>((best, e) => (!best || e.number > best.number ? e : best), null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setNote(null);
    if (!prev) return;
    backend
      .read(sessionId, prev.episodeId)
      .then((d) => alive && setNote(d.note.text))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [backend, prev?.episodeId, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!prev || !note || !note.trim()) return null;
  const fresh = eps.lastCreatedId === episode.episodeId;
  return (
    <details className={`prev-note${fresh ? " fresh" : ""}`} open={fresh} data-testid="prev-note">
      <summary>{tf(fresh ? "summary.prevNoteFresh" : "summary.prevNote", { n: prev.number })}</summary>
      <pre className="prev-note-text">{note}</pre>
    </details>
  );
}
