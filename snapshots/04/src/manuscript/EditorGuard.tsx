import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { browserManuscriptBackend, type ManuscriptBackend } from "./api";

/** What the open built-in editor exposes to the rest of the app. */
export interface EditorHandle {
  /** Saves pending text (waiting for IME composition to end). Resolves false if it could not save. */
  flush(): Promise<boolean>;
  focus(): void;
  isDirty(): boolean;
}

interface GuardValue {
  register(h: EditorHandle | null): void;
  /** true when there is nothing unsaved (or it was saved). */
  flush(): Promise<boolean>;
  focus(): void;
  isDirty(): boolean;
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
};

export function useEditorGuard(): GuardValue {
  return useContext(GuardCtx) ?? NO_GUARD;
}
