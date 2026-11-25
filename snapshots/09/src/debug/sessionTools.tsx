// Per-session debug tools. Each session that has manual tests needing special files or states adds
// a component here (SNAPSHOTS.md rule 4). Tools that change files only work on synthetic works.
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { ExternalAction, FileInfo, Fixture, HistoryAction, LoreAction, SummaryAction, TimelineAction } from "./api";
import { useDebugBackend } from "./DebugPanel";

const FIXTURES: { id: Fixture; label: string; test: string }[] = [
  { id: "bomCrlfEmoji", label: "UTF-8 BOM + CRLF + 이모지", test: "04.form" },
  { id: "cp949", label: "CP949(ANSI) 한글", test: "04.cp949" },
  { id: "empty", label: "빈 문서", test: "04.form" },
  { id: "long", label: "장문 (약 12만 자)", test: "04.form" },
  { id: "mixed", label: "줄바꿈 섞임 (CRLF·LF·CR)", test: "04.form" },
];

function Session04Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const ep = eps.list.episodes.find((e) => e.episodeId === eps.selectedId) ?? null;
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId || !ep) return setInfo(null);
    try {
      setInfo(await backend.fileInfo(sessionId, ep.episodeId));
    } catch (e) {
      setMsg(`오류: ${JSON.stringify(asWsError(e))}`);
    }
  }, [backend, ep, sessionId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!sessionId || !ep) {
    return <p className="muted">작품을 열고 ‘회차’ 탭에서 회차를 하나 고른 뒤 이 탭으로 오면 그 회차의 원고에 쓸 수 있다.</p>;
  }

  const act = async (label: string, f: () => Promise<void>) => {
    setMsg(null);
    try {
      await f();
      setMsg(`${label} 완료. ‘회차’ 탭으로 돌아가면 편집기가 원고를 새로 읽는다.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
    await refresh();
  };
  const sample = info?.isSample ?? false;

  return (
    <div>
      <p className="muted">
        대상: <strong>{ep.number}화</strong> <span className="mono">{ep.manuscriptPath}</span>
      </p>
      {!sample && (
        <p role="alert" className="notice notice-error">
          이 작품은 합성 작품이 아니어서 아래 도구가 원고를 바꾸지 않는다(Rust에서 거절). 위 ‘합성 작품 만들기’로 만든 작품을 열어 쓴다.
        </p>
      )}
      <p className="debug-sub">원고를 시험 형식으로 덮어쓰기 (외부 프로그램이 쓴 것처럼)</p>
      <p className="actions">
        {FIXTURES.map((f) => (
          <button key={f.id} type="button" disabled={!sample} onClick={() => act(f.label, () => backend.writeFixture(sessionId, ep.episodeId, f.id))}>
            {f.label} <span className="muted mono">{f.test}</span>
          </button>
        ))}
      </p>
      <p className="debug-sub">파일 상태 (04.lock · 04.permission)</p>
      <p className="actions">
        <button type="button" disabled={!sample} onClick={() => act(info?.lockedByDebug ? "잠금 풀기" : "잠그기", () => backend.setLock(sessionId, ep.episodeId, !info?.lockedByDebug))}>
          {info?.lockedByDebug ? "잠금 풀기" : "다른 프로그램처럼 잠그기"}
        </button>
        <button type="button" disabled={!sample} onClick={() => act(info?.readonly ? "읽기 전용 끄기" : "읽기 전용 켜기", () => backend.setReadonly(sessionId, ep.episodeId, !info?.readonly))}>
          {info?.readonly ? "읽기 전용 끄기" : "읽기 전용 속성 켜기"}
        </button>
        <button type="button" className="link" onClick={() => void refresh()}>
          파일 정보 새로고침
        </button>
      </p>
      {msg && <p className="notice mono">{msg}</p>}
      {info && (
        <pre className="debug-json" data-testid="file-info">
          {JSON.stringify(
            {
              size: info.size,
              hash: info.hash,
              bom: info.bom,
              crlf: info.crlf,
              loneLf: info.loneLf,
              loneCr: info.loneCr,
              utf8: info.utf8,
              readonly: info.readonly,
              lockedByDebug: info.lockedByDebug,
              headHex: info.headHex,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

const EXTERNAL: { id: ExternalAction; label: string; test: string }[] = [
  { id: "appendLine", label: "줄 덧붙여 저장 (메모장처럼)", test: "05.outside · 05.both" },
  { id: "replaceViaTemp", label: "임시 파일 교체 저장 (VS Code처럼)", test: "05.outside" },
  { id: "touchOnly", label: "수정 시각만 바꾸기 (내용 그대로)", test: "05.touch" },
  { id: "saveAsCp949", label: "CP949로 저장", test: "05.cp949" },
  { id: "delete", label: "삭제", test: "05.delete" },
];

function Session05Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const ep = eps.list.episodes.find((e) => e.episodeId === eps.selectedId) ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  if (!sessionId || !ep) {
    return <p className="muted">작품을 열고 ‘회차’ 탭에서 회차를 고른 뒤 이 탭으로 오면, 그 회차 원고에 외부 편집기가 한 일을 흉내 낼 수 있다.</p>;
  }
  const run = async (a: (typeof EXTERNAL)[number]) => {
    setMsg(null);
    try {
      await backend.externalEdit(sessionId, ep.episodeId, a.id);
      setMsg(`${a.label} 완료 (${new Date().toLocaleTimeString()}). ‘회차’ 탭으로 돌아가 편집기를 확인한다.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${a.label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
  };
  return (
    <div>
      <p className="muted">
        대상: <strong>{ep.number}화</strong>. 충돌을 만들려면 ‘회차’ 탭에서 글자를 입력한 직후(1초 안에) 여기로 와서 누른다. 합성 작품이 아니면 Rust가 거절한다.
      </p>
      <p className="actions">
        {EXTERNAL.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(a)}>
            {a.label} <span className="muted mono">{a.test}</span>
          </button>
        ))}
      </p>
      {msg && <p className="notice mono">{msg}</p>}
    </div>
  );
}

const HISTORY_ACTIONS: { id: HistoryAction; label: string; test: string }[] = [
  { id: "threeRevisions", label: "판 3개 빨리 만들기 (r1 초고 → r2 → r3)", test: "06.three" },
  { id: "leftoverStaging", label: "게시 직전 중단 흔적 남기기", test: "06.crash" },
  { id: "damageLatest", label: "최신 판 손상시키기", test: "06.damaged" },
];

function Session06Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const ep = eps.list.episodes.find((e) => e.episodeId === eps.selectedId) ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  if (!sessionId || !ep) {
    return <p className="muted">작품을 열고 ‘회차’ 탭에서 회차를 고른 뒤 이 탭으로 오면 그 회차의 이력 상황을 만들 수 있다.</p>;
  }
  const run = async (a: (typeof HISTORY_ACTIONS)[number]) => {
    setMsg(null);
    try {
      const r = await backend.historyFixture(sessionId, ep.episodeId, a.id);
      setMsg(`${a.label} 완료: ${r}. ‘회차’ 탭에서 그 회차를 다시 누르면 이력이 갱신된다${a.id === "leftoverStaging" ? " (흔적은 앱을 다시 시작하거나 작품을 다시 열 때 정리된다)" : ""}.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${a.label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
  };
  return (
    <div>
      <p className="muted">
        대상: <strong>{ep.number}화</strong>. 합성 작품이 아니면 Rust가 거절한다.
      </p>
      <p className="actions">
        {HISTORY_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(a)}>
            {a.label} <span className="muted mono">{a.test}</span>
          </button>
        ))}
      </p>
      {msg && <p className="notice mono">{msg}</p>}
    </div>
  );
}

const SUMMARY_ACTIONS: { id: SummaryAction; label: string; test: string }[] = [
  { id: "writeSummaryAndNote", label: "요약·다음 화 메모 쓰기", test: "07.list · 07.note" },
  { id: "externalSummaryEdit", label: "요약 파일 외부 수정", test: "07.summaryOutside" },
];

function Session07Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const sessionId = ws.current?.sessionId ?? null;
  const ep = eps.list.episodes.find((e) => e.episodeId === eps.selectedId) ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  if (!sessionId || !ep) {
    return <p className="muted">작품을 열고 ‘회차’ 탭에서 회차를 고른 뒤 이 탭으로 오면 그 회차의 요약 상황을 만들 수 있다.</p>;
  }
  const run = async (a: (typeof SUMMARY_ACTIONS)[number]) => {
    setMsg(null);
    try {
      const r = await backend.summaryFixture(sessionId, ep.episodeId, a.id);
      setMsg(`${a.label} 완료: ${r}. ‘회차 요약’에서 확인한다.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${a.label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
  };
  return (
    <div>
      <p className="muted">
        대상: <strong>{ep.number}화</strong>. 합성 작품이 아니면 Rust가 거절한다.
      </p>
      <p className="actions">
        {SUMMARY_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(a)}>
            {a.label} <span className="muted mono">{a.test}</span>
          </button>
        ))}
      </p>
      {msg && <p className="notice mono">{msg}</p>}
    </div>
  );
}

const LORE_ACTIONS: { id: LoreAction; label: string; test: string }[] = [
  { id: "sameNameCards", label: "같은 이름 카드 2개 + 태그 A", test: "08.sameName · 08.tags" },
  { id: "externalCardEdit", label: "‘서린’ 카드 파일 외부 수정", test: "08.outside" },
];

function Session08Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const sessionId = ws.current?.sessionId ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  if (!sessionId) {
    return <p className="muted">합성 작품을 열면 세계관 카드 상황을 만들 수 있다.</p>;
  }
  const run = async (a: (typeof LORE_ACTIONS)[number]) => {
    setMsg(null);
    try {
      const r = await backend.loreFixture(sessionId, a.id);
      setMsg(`${a.label} 완료: ${r}. ‘세계관’에서 확인한다.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${a.label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
  };
  return (
    <div>
      <p className="muted">열린 작품의 lore/ 아래에 만든다. 합성 작품이 아니면 Rust가 거절한다.</p>
      <p className="actions">
        {LORE_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(a)}>
            {a.label} <span className="muted mono">{a.test}</span>
          </button>
        ))}
      </p>
      {msg && <p className="notice mono">{msg}</p>}
    </div>
  );
}

const TIMELINE_ACTIONS: { id: TimelineAction; label: string; test: string }[] = [
  { id: "standardSample", label: "표준 표본: 타임라인 2개 + 1화 각성 / 3화 불을 다룸", test: "09.views · 09.shared" },
  { id: "legacyEvents", label: "예전 형식 사건 파일 2개 쓰기", test: "09.certainty" },
];

function Session09Tools() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const sessionId = ws.current?.sessionId ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  if (!sessionId) {
    return <p className="muted">회차가 3개 이상인 합성 작품을 열면 타임라인 상황을 만들 수 있다.</p>;
  }
  const run = async (a: (typeof TIMELINE_ACTIONS)[number]) => {
    setMsg(null);
    try {
      const r = await backend.timelineFixture(sessionId, a.id);
      setMsg(`${a.label} 완료: ${r}. ‘타임라인’에서 확인한다.`);
    } catch (e) {
      const err = asWsError(e);
      setMsg(`${a.label} 실패: ${typeof err.detail === "string" ? err.detail : err.code}`);
    }
  };
  return (
    <div>
      <p className="muted">
        표준 표본의 사건 ID는 고정: 각성 <span className="mono">…000000000901</span>, 불을 다룸 <span className="mono">…000000000903</span>. 합성 작품이 아니면 Rust가 거절한다.
      </p>
      <p className="actions">
        {TIMELINE_ACTIONS.map((a) => (
          <button key={a.id} type="button" onClick={() => void run(a)}>
            {a.label} <span className="muted mono">{a.test}</span>
          </button>
        ))}
      </p>
      {msg && <p className="notice mono">{msg}</p>}
    </div>
  );
}

export const SESSION_TOOLS: { session: string; title: string; Component: ComponentType }[] = [
  { session: "04", title: "원고 형식·잠금·읽기 전용 (합성 작품 전용)", Component: Session04Tools },
  { session: "05", title: "외부 편집기 흉내 (합성 작품 전용)", Component: Session05Tools },
  { session: "06", title: "이력 상황 만들기 (합성 작품 전용)", Component: Session06Tools },
  { session: "07", title: "요약 상황 만들기 (합성 작품 전용)", Component: Session07Tools },
  { session: "08", title: "세계관 카드 상황 만들기 (합성 작품 전용)", Component: Session08Tools },
  { session: "09", title: "타임라인 상황 만들기 (합성 작품 전용)", Component: Session09Tools },
];
