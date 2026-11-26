// Quick open palette (12, Ctrl+P): episodes by number, cards by name or alias, saved links and
// timelines by name — ranked by `rankQuick`. Keyboard only: type, ↑/↓, Enter opens (not while
// an IME is composing), Esc cancels and gives focus back. The last row hands the same text to
// the body search (Ctrl+Shift+F).
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import type { MessageKey } from "../i18n/messages";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { useSearchBackend, type QuickItem } from "./api";
import { rankQuick, type QuickMatch } from "./quickRank";
import { composingKey } from "./SearchPanel";
import { useSearchUi } from "./SearchUi";

export function QuickOpen() {
  const { t, tf } = useI18n();
  const backend = useSearchBackend();
  const ui = useSearchUi();
  const ws = useWorkspace();
  const sessionId = ws.current?.sessionId ?? null;
  const inputId = useId();
  const listId = useId();
  const [items, setItems] = useState<QuickItem[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    returnFocus.current = document.activeElement;
    input.current?.focus();
    if (!sessionId || !backend.quickItems) {
      setItems([]);
      return;
    }
    backend.quickItems(sessionId).then(setItems, () => {
      setItems([]);
      setError(true);
    });
  }, [backend, sessionId]);

  const matches = useMemo(() => rankQuick(items ?? [], q), [items, q]);
  const rows = matches.length + (q.trim() ? 1 : 0); // + ‘본문에서 찾기’
  useEffect(() => setSel(0), [q]);

  const close = () => {
    ui.setPalette(false);
    const el = returnFocus.current as HTMLElement | null;
    window.setTimeout(() => el?.focus?.(), 0);
  };
  const choose = (i: number) => {
    if (i < matches.length) ui.openQuick(matches[i]);
    else if (q.trim()) ui.openPanel(q.trim());
  };

  const label = (m: QuickMatch) => {
    const it = m.item;
    if (it.kind === "episode") return it.title ? tf("episodes.labelWithTitle", { n: it.number ?? 0, title: it.title }) : tf("episodes.label", { n: it.number ?? 0 });
    return it.title;
  };
  const detail = (m: QuickMatch) => {
    const it = m.item;
    const parts = [t(`search.quick.kinds.${it.kind}` as MessageKey)];
    if (it.kind === "card" && it.detail) parts.push(t(`world.templates.${it.detail}.label` as MessageKey));
    if (it.kind === "view" && it.detail) parts.push(tf("search.quick.inTimeline", { name: it.detail }));
    if (m.by === "alias") parts.push(tf("search.by.alias", { value: m.value }));
    return parts.join(" · ");
  };

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t("search.quick.title")}>
        <label htmlFor={inputId} className="visually-hidden">
          {t("search.quick.title")}
        </label>
        <input
          ref={input}
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows ? `${listId}-${sel}` : undefined}
          autoComplete="off"
          placeholder={t("search.quick.placeholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (composingKey(e)) return; // Enter commits the syllable, nothing opens
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => (rows ? (s + 1) % rows : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => (rows ? (s - 1 + rows) % rows : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (rows) choose(sel);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <ul id={listId} role="listbox" className="palette-list" data-testid="quick-list">
          {items === null && (
            <li className="muted" data-testid="quick-loading">
              {t("search.quick.loading")}
            </li>
          )}
          {matches.map((m, i) => (
            <li
              key={`${m.item.kind}-${m.item.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={sel === i}
              className="palette-row"
              data-kind={m.item.kind}
              data-tier={m.tier}
              onMouseMove={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <strong>{label(m)}</strong>
              <span className="muted">{detail(m)}</span>
              <span className="muted mono palette-path">{m.item.path}</span>
            </li>
          ))}
          {q.trim() && (
            <li
              id={`${listId}-${matches.length}`}
              role="option"
              aria-selected={sel === matches.length}
              className="palette-row palette-body"
              data-testid="quick-body"
              onMouseMove={() => setSel(matches.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(matches.length);
              }}
            >
              {tf("search.quick.body", { q: q.trim() })}
            </li>
          )}
          {items !== null && q.trim() && matches.length === 0 && <li className="muted">{t("search.quick.none")}</li>}
          {error && <li className="muted">{t("search.quick.failed")}</li>}
        </ul>
        <p className="muted palette-hint">{t("search.quick.hint")}</p>
      </div>
    </div>
  );
}
