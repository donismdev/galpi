// CH3 (11): two separate lookups for a card. ‘이름·별칭 본문 검색’ finds the card's names in
// manuscripts letter by letter and says which name matched. ‘연결된 회차’ counts episodes of
// events tied to the card ID. Neither creates links; both can be narrowed to an episode range.
import { useId, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { asWsError } from "../workspace/api";
import { useSearchBackend, type EpisodeHits, type LinkEvidence, type NameHit } from "../search/api";

export function CardFinder({ sessionId, cardId }: { sessionId: string; cardId: string }) {
  const { t, tf } = useI18n();
  const backend = useSearchBackend();
  const ids = { from: useId(), to: useId() };
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [names, setNames] = useState<EpisodeHits<NameHit>[] | null>(null);
  const [linked, setLinked] = useState<EpisodeHits<LinkEvidence>[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const run = async (which: "names" | "linked") => {
    setError(null);
    try {
      if (which === "names") setNames(await backend.nameSearch(sessionId, cardId, num(from), num(to)));
      else setLinked(await backend.linked(sessionId, cardId, num(from), num(to)));
    } catch (e) {
      setError(t(`errors.${asWsError(e).code}` as MessageKey));
    }
  };
  return (
    <fieldset className="card-tags card-finder">
      <legend>{t("world.find.title")}</legend>
      <p className="muted">{t("world.find.help")}</p>
      <p className="field">
        <label htmlFor={ids.from}>{t("world.find.from")}</label>
        <input id={ids.from} type="number" value={from} onChange={(e) => setFrom(e.target.value)} />
      </p>
      <p className="field">
        <label htmlFor={ids.to}>{t("world.find.to")}</label>
        <input id={ids.to} type="number" value={to} onChange={(e) => setTo(e.target.value)} />
      </p>
      <p className="actions">
        <button type="button" onClick={() => void run("names")}>
          {t("world.find.names")}
        </button>
        <button type="button" onClick={() => void run("linked")}>
          {t("world.find.linked")}
        </button>
      </p>
      {error && (
        <p role="alert" className="notice notice-error">
          {error}
        </p>
      )}
      {names && (
        <div data-testid="name-results">
          <h3>{t("world.find.namesTitle")}</h3>
          {names.length === 0 ? (
            <p className="empty">{t("world.find.none")}</p>
          ) : (
            <ul className="tl-rows">
              {names.map((e) => (
                <li key={e.episodeId} className="tl-row" data-episode={e.number}>
                  <strong className="tl-row-head">{tf("episodes.label", { n: e.number })}</strong>
                  <span className="tl-row-events">
                    {e.hits.map((h, i) => (
                      <span key={i} className="snippet">
                        <span className="tag-chip">{h.name}</span> {h.before}
                        <mark>{h.name}</mark>
                        {h.after}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {linked && (
        <div data-testid="linked-results">
          <h3>{t("world.find.linkedTitle")}</h3>
          {linked.length === 0 ? (
            <p className="empty">{t("world.find.none")}</p>
          ) : (
            <ul className="tl-rows">
              {linked.map((e) => (
                <li key={e.episodeId} className="tl-row" data-episode={e.number}>
                  <strong className="tl-row-head">{tf("episodes.label", { n: e.number })}</strong>
                  <span className="tl-row-events">
                    {e.hits.map((h) => (
                      <span key={h.id} className="event-chip">
                        {tf("world.find.byEvent", { title: h.title })}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </fieldset>
  );
}
