// Debug tab (debug builds only). Developer workbench: build info, live state, tools, and the
// per-session list of implemented features with manual test checklists. Content is Korean only.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useEpisodes } from "../episodes/EpisodesProvider";
import { asWsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import { defaultDebugBackend, type BuildInfo, type DebugBackend, type SampleResult } from "./api";
import { SESSIONS, type TestStep } from "./features";
import { SESSION_TOOLS } from "./sessionTools";

const DebugCtx = createContext<DebugBackend | null>(null);

export function DebugBackendProvider({ backend, children }: { backend: DebugBackend; children: ReactNode }) {
  return <DebugCtx.Provider value={backend}>{children}</DebugCtx.Provider>;
}

export function useDebugBackend(): DebugBackend {
  return useContext(DebugCtx) ?? defaultDebugBackend();
}

/** Build info, or null while loading. The debug tab is shown only when `debug` is true. */
export function useBuildInfo(): BuildInfo | null {
  const backend = useDebugBackend();
  const [info, setInfo] = useState<BuildInfo | null>(null);
  useEffect(() => {
    let alive = true;
    backend
      .buildInfo()
      .then((i) => alive && setInfo(i))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [backend]);
  return info;
}

// ---------------------------------------------------------------- checklist state (per viewer)

const CHECK_KEY = "galpi.debug.checks";

function loadChecks(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(CHECK_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveChecks(c: Record<string, boolean>) {
  try {
    window.localStorage.setItem(CHECK_KEY, JSON.stringify(c));
  } catch {
    /* checklist is a convenience */
  }
}

function Json({ value }: { value: unknown }) {
  return <pre className="debug-json">{JSON.stringify(value, null, 2)}</pre>;
}

function StepCard({ step, done, onToggle }: { step: TestStep; done: boolean; onToggle: () => void }) {
  return (
    <li className={`debug-step${done ? " done" : ""}`}>
      <label className="check">
        <input type="checkbox" checked={done} onChange={onToggle} aria-label={`확인함: ${step.title}`} />
        <strong>{step.title}</strong>
        <span className="muted mono">{step.id}</span>
      </label>
      <div className="debug-step-body">
        <p className="debug-sub">하는 법</p>
        <ol>
          {step.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <p className="debug-sub">기대 결과</p>
        <ul>
          {step.expect.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        {step.notes && (
          <>
            <p className="debug-sub">참고</p>
            <ul>
              {step.notes.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </li>
  );
}

function SampleTool() {
  const backend = useDebugBackend();
  const ws = useWorkspace();
  const [path, setPath] = useState("");
  const [title, setTitle] = useState("잿빛 항구 테스트");
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SampleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await backend.makeSample(path.trim(), title, count));
    } catch (e) {
      const err = asWsError(e);
      setError(`${err.code}${typeof err.detail === "string" ? `: ${err.detail}` : ""}${typeof err.path === "string" ? ` (${err.path})` : ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="debug-tool">
      <h3>합성 작품 만들기</h3>
      <p className="muted">
        새 폴더(또는 빈 폴더)에 실제 앱 코드로 작품과 빈 회차 N개를 만든다. 부모 폴더는 있어야 한다. 실제 원고 폴더를 넣지 말 것.
      </p>
      <p className="field">
        <label htmlFor="dbg-path">만들 폴더 (전체 경로)</label>
        <input
          id="dbg-path"
          value={path}
          placeholder="예: C:\Users\…\AppData\Local\Temp\galpi-test\잿빛 항구 (테스트)"
          onChange={(e) => setPath(e.target.value)}
        />
      </p>
      <p className="debug-row">
        <label>
          제목 <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          회차 수 <input type="number" min={0} max={1000} value={count} onChange={(e) => setCount(Number(e.target.value) || 0)} />
        </label>
        <button type="button" className="primary" disabled={busy || !path.trim()} onClick={make}>
          {busy ? "만드는 중…" : "만들기"}
        </button>
      </p>
      {error && (
        <p role="alert" className="notice notice-error mono">
          {error}
        </p>
      )}
      {result && (
        <div className="notice">
          <p>
            만들었음: <span className="mono">{result.path}</span> · 회차 {result.episodes.length}개 · workspaceId{" "}
            <span className="mono">{result.workspaceId}</span>
          </p>
          <p className="actions">
            <button type="button" onClick={() => ws.openPath(result.path)}>
              이 작품 열기
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

export function DebugPanel() {
  const backend = useDebugBackend();
  const info = useBuildInfo();
  const ws = useWorkspace();
  const eps = useEpisodes();
  const [settings, setSettings] = useState<unknown>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>(loadChecks);

  const refreshSettings = useCallback(() => {
    backend.settings().then(setSettings, (e) => setSettings({ error: asWsError(e) }));
  }, [backend]);
  useEffect(refreshSettings, [refreshSettings]);

  const toggle = (id: string) => {
    const next = { ...checks, [id]: !checks[id] };
    setChecks(next);
    saveChecks(next);
  };
  const resetChecks = () => {
    setChecks({});
    saveChecks({});
  };

  const total = SESSIONS.reduce((n, s) => n + s.manual.length, 0);
  const done = SESSIONS.reduce((n, s) => n + s.manual.filter((m) => checks[m.id]).length, 0);
  const latest = SESSIONS.at(-1)?.session;

  return (
    <div className="debug">
      <section className="root-panel">
        <h1>디버그</h1>
        <p className="root-desc">
          개발용 화면. 디버그 빌드(<span className="mono">npm run tauri dev</span>,{" "}
          <span className="mono">tauri build --debug</span>)에서만 보인다. 회차마다 구현 목록·테스트 방법을 갱신하고, 개발 도구를 여기에 모은다.
        </p>
      </section>

      <section className="open-card">
        <h2>빌드 정보</h2>
        {info ? (
          <dl className="debug-dl">
            <dt>스냅샷</dt>
            <dd className="mono" data-testid="snapshot">
              snapshots/{__SNAPSHOT__} ({__SNAPSHOT__}회 결과물)
            </dd>
            <dt>빌드</dt>
            <dd>{info.debug ? "디버그" : "릴리스"}</dd>
            <dt>실행 환경</dt>
            <dd>{info.runtime === "desktop" ? "데스크톱 앱" : "브라우저 미리보기"}</dd>
            <dt>버전</dt>
            <dd className="mono">{info.version}</dd>
            <dt>OS / 아키텍처</dt>
            <dd className="mono">
              {info.os} / {info.arch}
            </dd>
            <dt>기기 설정 파일</dt>
            <dd className="mono">{info.settingsPath}</dd>
          </dl>
        ) : (
          <p className="muted">불러오는 중…</p>
        )}
      </section>

      <section className="open-card">
        <h2>현재 상태</h2>
        <p className="debug-sub">열린 작품</p>
        <Json value={ws.current ?? "(없음)"} />
        {ws.current && (
          <>
            <p className="debug-sub">
              회차 {eps.list.episodes.length}개 · 문제 폴더 {eps.list.problems.length}개 · 선택 {eps.selectedId ?? "-"}
            </p>
            <p className="debug-sub">마지막 편집기 요청</p>
            <Json value={eps.launch ?? "(없음)"} />
          </>
        )}
        <p className="debug-sub">
          기기 설정{" "}
          <button type="button" className="link" onClick={refreshSettings}>
            새로고침
          </button>
        </p>
        <Json value={settings} />
      </section>

      <section className="open-card">
        <h2>도구</h2>
        {info?.runtime === "desktop" ? <SampleTool /> : <p className="muted">데스크톱 앱에서만 쓸 수 있다.</p>}
        {SESSION_TOOLS.map(({ session, title, Component }) => (
          <div key={session} className="debug-tool">
            <h3>
              {session}회 도구 · {title}
            </h3>
            <Component />
          </div>
        ))}
      </section>

      <section className="open-card">
        <h2>구현 내용과 테스트 방법</h2>
        <p className="muted">
          자동 검사는 현재 스냅샷 폴더에서 <span className="mono">npm run check</span>. 아래 체크는 이 PC의 이 앱에만 저장된다. 확인함{" "}
          {done}/{total}{" "}
          <button type="button" className="link" onClick={resetChecks}>
            체크 초기화
          </button>
        </p>
        {SESSIONS.map((s) => (
          <details key={s.session} className="debug-session" open={s.session === latest}>
            <summary>
              <strong>
                {s.session}회 · {s.title}
              </strong>{" "}
              <span className="muted mono">{s.snapshot}</span>{" "}
              <span className="muted">
                ({s.manual.filter((m) => checks[m.id]).length}/{s.manual.length})
              </span>
            </summary>
            <p className="muted">완료 기준: {s.criteria}</p>
            <p className="debug-sub">구현된 것</p>
            <ul>
              {s.implemented.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p className="debug-sub">자동 테스트</p>
            <ul className="mono">
              {s.automated.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <p className="debug-sub">직접 확인 (수동 테스트)</p>
            <ol className="debug-steps">
              {s.manual.map((m) => (
                <StepCard key={m.id} step={m} done={!!checks[m.id]} onToggle={() => toggle(m.id)} />
              ))}
            </ol>
          </details>
        ))}
      </section>
    </div>
  );
}
