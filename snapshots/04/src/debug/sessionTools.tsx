// Per-session debug tools. Each session that has manual tests needing special files or states adds
// a component here (SNAPSHOTS.md rule 4). Tools that change files only work on synthetic works.
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import type { FileInfo, Fixture } from "./api";
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

export const SESSION_TOOLS: { session: string; title: string; Component: ComponentType }[] = [
  { session: "04", title: "원고 형식·잠금·읽기 전용 (합성 작품 전용)", Component: Session04Tools },
];
