import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { browserManuscriptBackend, type ManuscriptBackend } from "./api";

/** Result of getting the manuscript ready for a commit (06). */
export type CommitReady =
  | { ok: true; hash: string; text: string }
  | { ok: false; reason: "conflict" | "failed" | "notReady" };

/** What the open built-in editor exposes to the rest of the app. */
export interface EditorHandle {
  /** Saves pending text (waiting for IME composition to end). Resolves false if it could not save. */
  flush(): Promise<boolean>;
  focus(): void;
  isDirty(): boolean;
  /** Save, then compare with the disk; re-read an outside change (clean) or open a conflict (dirty). */
  prepareCommit(): Promise<CommitReady>;
  /** Replace the text as a writer edit (restore an old revision into the working copy). */
  replaceText(text: string): boolean;
  currentText(): string | null;
}

interface GuardValue {
  register(h: EditorHandle | null): void;
  /** true when there is nothing unsaved (or it was saved). */
  flush(): Promise<boolean>;
  focus(): void;
  isDirty(): boolean;
  prepareCommit(): Promise<CommitReady>;
  replaceText(text: string): boolean;
  currentText(): string | null;
}

const GuardCtx = createContext<GuardValue | null>(null);
const BackendCtx = createContext<ManuscriptBackend>(browserManuscriptBackend);

export function ManuscriptBackendProvider({ backend, children }: { backend: ManuscriptBackend; children: ReactNode }) {
  return <BackendCtx.Provider value={backend}>{children}</BackendCtx.Provider>;
}

export function useManuscriptBackend(): ManuscriptBackend {
  return useContext(BackendCtx);
}

export function EditorGuardProvider({ children }: { children: ReactNode }) {
  const current = useRef<EditorHandle | null>(null);
  const value = useMemo<GuardValue>(
    () => ({
      register: (h) => {
        current.current = h;
      },
      flush: async () => (current.current ? current.current.flush() : true),
      focus: () => current.current?.focus(),
      isDirty: () => current.current?.isDirty() ?? false,
      prepareCommit: async () => (current.current ? current.current.prepareCommit() : { ok: false, reason: "notReady" }),
      replaceText: (t) => current.current?.replaceText(t) ?? false,
      currentText: () => current.current?.currentText() ?? null,
    }),
    [],
  );
  return <GuardCtx.Provider value={value}>{children}</GuardCtx.Provider>;
}

const NO_GUARD: GuardValue = {
  register: () => {},
  flush: async () => true,
  focus: () => {},
  isDirty: () => false,
  prepareCommit: async () => ({ ok: false, reason: "notReady" }),
  replaceText: () => false,
  currentText: () => null,
};

export function useEditorGuard(): GuardValue {
  return useContext(GuardCtx) ?? NO_GUARD;
}
