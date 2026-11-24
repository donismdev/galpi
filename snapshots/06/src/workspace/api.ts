import { invoke, isTauri } from "@tauri-apps/api/core";

// Mirrors src-tauri/src/workspace (serde camelCase).

export type FolderKind =
  | "empty"
  | "nonEmpty"
  | "incompleteInit"
  | "workspace"
  | "newerWorkspace"
  | "invalidWorkspace";

export interface Inspection {
  path: string;
  kind: FolderKind;
  title: string | null;
  workspaceId: string | null;
  schemaVersion: number | null;
  entryCount: number;
  conflicts: string[];
  suggestion: string | null;
  detail: string | null;
}

export type ReadOnlyReason = "newerSchema" | "lockedByOther" | "noWritePermission";

export interface OpenedWorkspace {
  sessionId: string;
  root: string;
  workspaceId: string;
  title: string;
  schemaVersion: number;
  mode: "readWrite" | "readOnly";
  readOnlyReason: ReadOnlyReason | null;
  recovery: { tmpFilesRemoved: number; initMarkerCleared: boolean };
}

export interface RecentWorkspace {
  path: string;
  title: string;
  workspaceId: string;
  lastOpenedAt: string;
}

export type WsErrorCode =
  | "notFound"
  | "notADirectory"
  | "nameConflicts"
  | "needsConfirmation"
  | "alreadyWorkspace"
  | "notAWorkspace"
  | "invalidManifest"
  | "newerSchema"
  | "invalidRelativePath"
  | "pathOutsideWorkspace"
  | "staleSession"
  | "noWorkspaceOpen"
  | "readOnly"
  | "writeConflict"
  | "io"
  | "unsupported";

export interface WsError {
  code: WsErrorCode;
  [field: string]: unknown;
}

export function asWsError(e: unknown): WsError {
  if (e && typeof e === "object" && "code" in e && typeof (e as WsError).code === "string") {
    return e as WsError;
  }
  return { code: "io", detail: String(e) };
}

export interface CreateRequest {
  path: string;
  title: string;
  requestId: string;
  trackLabel: string;
  confirmNonEmpty: boolean;
  createFolder: boolean;
}

/** Everything the UI needs from the Rust core. Injected so tests can control timing. */
export interface WorkspaceBackend {
  readonly supported: boolean;
  pickFolder(): Promise<string | null>;
  inspect(path: string, suggestName: string): Promise<Inspection>;
  create(req: CreateRequest): Promise<OpenedWorkspace>;
  open(path: string): Promise<OpenedWorkspace>;
  close(sessionId: string): Promise<void>;
  current(): Promise<OpenedWorkspace | null>;
  recent(): Promise<RecentWorkspace[]>;
  forgetRecent(path: string): Promise<RecentWorkspace[]>;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

const desktopBackend: WorkspaceBackend = {
  supported: true,
  async pickFolder() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  },
  inspect: (path, suggestName) => invoke<Inspection>("inspect_folder", { path, suggestName }),
  create: (request) => invoke<OpenedWorkspace>("create_workspace", { request }),
  open: (path) => invoke<OpenedWorkspace>("open_workspace", { path }),
  close: (sessionId) => invoke<void>("close_workspace", { sessionId }),
  current: () => invoke<OpenedWorkspace | null>("current_workspace"),
  async recent() {
    const s = await invoke<{ recentWorkspaces?: RecentWorkspace[] }>("get_app_settings");
    return s.recentWorkspaces ?? [];
  },
  async forgetRecent(path) {
    const s = await invoke<{ recentWorkspaces?: RecentWorkspace[] }>("forget_recent_workspace", { path });
    return s.recentWorkspaces ?? [];
  },
};

const unsupported = async (): Promise<never> => {
  throw { code: "unsupported" } satisfies WsError;
};

/** Browser dev preview: no file system access. The UI says so instead of faking it. */
export const browserBackend: WorkspaceBackend = {
  supported: false,
  pickFolder: unsupported,
  inspect: unsupported,
  create: unsupported,
  open: unsupported,
  close: unsupported,
  current: async () => null,
  recent: async () => [],
  forgetRecent: async () => [],
};

export function defaultWorkspaceBackend(): WorkspaceBackend {
  return isTauri() ? desktopBackend : browserBackend;
}
