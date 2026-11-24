import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  asWsError,
  newRequestId,
  type Inspection,
  type OpenedWorkspace,
  type RecentWorkspace,
  type WorkspaceBackend,
  type WsError,
} from "./api";
import { useEditorGuard } from "../manuscript/EditorGuard";

export type Notice =
  | { kind: "cancelled" }
  | { kind: "error"; error: WsError; path?: string }
  | { kind: "closed" };

export type Flow =
  | { step: "idle" }
  | { step: "busy" }
  /** A folder was inspected and needs the writer's decision. requestId is reused for retries. */
  | { step: "decide"; inspection: Inspection; requestId: string };

export interface CreateInput {
  path: string;
  title: string;
  trackLabel: string;
  confirmNonEmpty: boolean;
  createFolder: boolean;
}

interface WorkspaceValue {
  supported: boolean;
  current: OpenedWorkspace | null;
  recent: RecentWorkspace[];
  flow: Flow;
  notice: Notice | null;
  chooseFolder: (suggestName: string) => Promise<void>;
  openPath: (path: string) => Promise<void>;
  createWork: (input: CreateInput) => Promise<void>;
  closeWork: () => Promise<void>;
  forgetRecent: (path: string) => Promise<void>;
  backToStart: () => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);

export function WorkspaceProvider({ backend, children }: { backend: WorkspaceBackend; children: ReactNode }) {
  const [current, setCurrent] = useState<OpenedWorkspace | null>(null);
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const guard = useEditorGuard();

  // Every user action bumps the epoch. A slow result from an older action is dropped, so a
  // late answer about work A can never replace work B that the writer opened afterwards.
  const epoch = useRef(0);
  const begin = () => ++epoch.current;
  const live = (e: number) => e === epoch.current;

  const refreshRecent = useCallback(async () => {
    try {
      setRecent(await backend.recent());
    } catch {
      /* recent list is a convenience */
    }
  }, [backend]);

  useEffect(() => {
    const e = begin();
    backend
      .current()
      .then((w) => live(e) && setCurrent(w))
      .catch(() => {});
    void refreshRecent();
  }, [backend, refreshRecent]);

  const fail = (e: number, err: unknown, path?: string) => {
    if (!live(e)) return;
    setNotice({ kind: "error", error: asWsError(err), path });
    setFlow({ step: "idle" });
  };

  const openPathAt = useCallback(
    async (e: number, path: string) => {
      setFlow({ step: "busy" });
      try {
        const opened = await backend.open(path);
        if (!live(e)) return;
        setCurrent(opened);
        setNotice(null);
        setFlow({ step: "idle" });
        void refreshRecent();
      } catch (err) {
        fail(e, err, path);
      }
    },
    [backend, refreshRecent],
  );

  const inspectAt = useCallback(
    async (e: number, path: string, suggestName: string) => {
      const inspection = await backend.inspect(path, suggestName);
      if (!live(e)) return;
      if (inspection.kind === "workspace" || inspection.kind === "newerWorkspace") {
        await openPathAt(e, inspection.path);
        return;
      }
      setFlow({ step: "decide", inspection, requestId: newRequestId() });
    },
    [backend, openPathAt],
  );

  const chooseFolder = useCallback(
    async (suggestName: string) => {
      const e = begin();
      setNotice(null);
      setFlow({ step: "busy" });
      try {
        const path = await backend.pickFolder();
        if (!live(e)) return;
        if (path === null) {
          setNotice({ kind: "cancelled" });
          setFlow({ step: "idle" });
          return;
        }
        await inspectAt(e, path, suggestName);
      } catch (err) {
        fail(e, err);
      }
    },
    [backend, inspectAt],
  );

  const openPath = useCallback(
    async (path: string) => {
      await guard.flush();
      const e = begin();
      setNotice(null);
      await openPathAt(e, path);
    },
    [openPathAt, guard],
  );

  const createWork = useCallback(
    async (input: CreateInput) => {
      // Same decision screen → same request id, so a double click or retry is one request.
      const requestId = flow.step === "decide" ? flow.requestId : newRequestId();
      const e = begin();
      setNotice(null);
      setFlow({ step: "busy" });
      try {
        const opened = await backend.create({ ...input, requestId });
        if (!live(e)) return;
        setCurrent(opened);
        setFlow({ step: "idle" });
        void refreshRecent();
      } catch (err) {
        const ws = asWsError(err);
        if (!live(e)) return;
        if (ws.code === "alreadyWorkspace") {
          await openPathAt(e, input.path);
          return;
        }
        if (ws.code === "nameConflicts" || ws.code === "needsConfirmation") {
          try {
            await inspectAt(e, input.path, input.title);
            if (live(e)) setNotice({ kind: "error", error: ws, path: input.path });
          } catch (again) {
            fail(e, again, input.path);
          }
          return;
        }
        fail(e, ws, input.path);
      }
    },
    [backend, flow, inspectAt, openPathAt, refreshRecent],
  );

  const closeWork = useCallback(async () => {
    const e = begin();
    const sessionId = current?.sessionId;
    if (!sessionId) return;
    await guard.flush(); // unsaved text becomes a draft if it cannot be saved
    try {
      await backend.close(sessionId);
    } catch {
      // staleSession / noWorkspaceOpen: the core already moved on; resync below.
    }
    if (!live(e)) return;
    setCurrent(await backend.current().catch(() => null));
    setNotice({ kind: "closed" });
    setFlow({ step: "idle" });
  }, [backend, current, guard]);

  const forgetRecent = useCallback(
    async (path: string) => {
      try {
        setRecent(await backend.forgetRecent(path));
      } catch {
        /* ignore */
      }
    },
    [backend],
  );

  const backToStart = useCallback(() => {
    begin();
    setFlow({ step: "idle" });
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      supported: backend.supported,
      current,
      recent,
      flow,
      notice,
      chooseFolder,
      openPath,
      createWork,
      closeWork,
      forgetRecent,
      backToStart,
    }),
    [backend.supported, current, recent, flow, notice, chooseFolder, openPath, createWork, closeWork, forgetRecent, backToStart],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}
