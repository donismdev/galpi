import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { asWsError, newRequestId, type WsError } from "../workspace/api";
import { useWorkspace } from "../workspace/WorkspaceProvider";
import {
  browserEpisodeBackend,
  type DetectedEditors,
  type EditorKind,
  type EditorSettings,
  type EpisodeBackend,
  type EpisodeList,
  type LaunchResult,
} from "./api";

/** Outcome of the last "open in editor" request. `sent` never means saved or confirmed. */
export type LaunchState =
  | { kind: "sent"; episodeId: string; result: LaunchResult }
  | { kind: "failed"; episodeId: string; editor: EditorKind; error: WsError };

interface EpisodesValue {
  supported: boolean;
  list: EpisodeList;
  loading: boolean;
  selectedId: string | null;
  creating: boolean;
  createError: WsError | null;
  launch: LaunchState | null;
  editor: EditorSettings;
  detected: DetectedEditors | null;
  select: (episodeId: string | null) => void;
  writeNext: () => Promise<void>;
  openIn: (episodeId: string, editor: EditorKind) => Promise<void>;
  rename: (episodeId: string, title: string) => Promise<void>;
  setEditor: (s: EditorSettings) => Promise<void>;
  refresh: () => Promise<void>;
}

const EMPTY: EpisodeList = { episodes: [], problems: [] };
const BackendCtx = createContext<EpisodeBackend>(browserEpisodeBackend);
const Ctx = createContext<EpisodesValue | null>(null);

export function EpisodeBackendProvider({ backend, children }: { backend: EpisodeBackend; children: ReactNode }) {
  return <BackendCtx.Provider value={backend}>{children}</BackendCtx.Provider>;
}

export function EpisodesProvider({ children }: { children: ReactNode }) {
  const backend = useContext(BackendCtx);
  const { current } = useWorkspace();
  const sessionId = current?.sessionId ?? null;

  const [list, setList] = useState<EpisodeList>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<WsError | null>(null);
  const [launch, setLaunch] = useState<LaunchState | null>(null);
  const [editor, setEditorState] = useState<EditorSettings>({ kind: "vscode" });
  const [detected, setDetected] = useState<DetectedEditors | null>(null);

  // Results carry the session they were asked for; anything for an older session is dropped.
  const liveSession = useRef<string | null>(sessionId);
  liveSession.current = sessionId;
  /** One "write next episode" intent: reused for double clicks and retries until it succeeds. */
  const pendingCreate = useRef<{ sessionId: string; requestId: string } | null>(null);

  const refreshFor = useCallback(
    async (sid: string) => {
      setLoading(true);
      try {
        const l = await backend.list(sid);
        if (liveSession.current === sid) setList(l);
      } finally {
        if (liveSession.current === sid) setLoading(false);
      }
    },
    [backend],
  );

  useEffect(() => {
    setList(EMPTY);
    setSelectedId(null);
    setLaunch(null);
    setCreateError(null);
    pendingCreate.current = null;
    if (sessionId) void refreshFor(sessionId).catch(() => {});
  }, [sessionId, refreshFor]);

  useEffect(() => {
    if (!backend.supported) return;
    backend.editorSettings().then(setEditorState).catch(() => {});
    backend.detectEditors().then(setDetected).catch(() => {});
  }, [backend]);

  const openIn = useCallback(
    async (episodeId: string, kind: EditorKind) => {
      const sid = liveSession.current;
      if (!sid) return;
      try {
        const result = await backend.openExternal(sid, episodeId, kind);
        if (liveSession.current === sid) setLaunch({ kind: "sent", episodeId, result });
      } catch (err) {
        if (liveSession.current === sid) setLaunch({ kind: "failed", episodeId, editor: kind, error: asWsError(err) });
      }
    },
    [backend],
  );

  const writeNext = useCallback(async () => {
    const sid = liveSession.current;
    if (!sid || creating) return;
    if (!pendingCreate.current || pendingCreate.current.sessionId !== sid) {
      pendingCreate.current = { sessionId: sid, requestId: newRequestId() };
    }
    const { requestId } = pendingCreate.current;
    setCreating(true);
    setCreateError(null);
    setLaunch(null);
    try {
      const made = await backend.create(sid, requestId);
      if (liveSession.current !== sid) return;
      pendingCreate.current = null; // done: the next click is a new episode
      setSelectedId(made.episode.episodeId);
      await refreshFor(sid);
      await openIn(made.episode.episodeId, editor.kind);
    } catch (err) {
      // Keep pendingCreate: retrying is the same intent and cannot make a second episode.
      if (liveSession.current === sid) setCreateError(asWsError(err));
    } finally {
      if (liveSession.current === sid) setCreating(false);
    }
  }, [backend, creating, editor.kind, openIn, refreshFor]);

  const rename = useCallback(
    async (episodeId: string, title: string) => {
      const sid = liveSession.current;
      if (!sid) return;
      try {
        await backend.rename(sid, newRequestId(), episodeId, title);
      } finally {
        if (liveSession.current === sid) await refreshFor(sid);
      }
    },
    [backend, refreshFor],
  );

  const setEditor = useCallback(
    async (s: EditorSettings) => {
      setEditorState(s);
      try {
        setEditorState(await backend.setEditorSettings(s));
        setDetected(await backend.detectEditors());
      } catch {
        /* keep the in-memory choice for this run */
      }
    },
    [backend],
  );

  const refresh = useCallback(async () => {
    if (liveSession.current) await refreshFor(liveSession.current);
  }, [refreshFor]);

  const value = useMemo<EpisodesValue>(
    () => ({
      supported: backend.supported,
      list,
      loading,
      selectedId,
      creating,
      createError,
      launch,
      editor,
      detected,
      select: setSelectedId,
      writeNext,
      openIn,
      rename,
      setEditor,
      refresh,
    }),
    [backend.supported, list, loading, selectedId, creating, createError, launch, editor, detected, writeNext, openIn, rename, setEditor, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEpisodes(): EpisodesValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEpisodes must be used inside EpisodesProvider");
  return v;
}
