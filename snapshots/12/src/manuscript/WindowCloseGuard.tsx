import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { useEditorGuard } from "./EditorGuard";

/**
 * Before the desktop window closes: save the open manuscript (after IME composition ends).
 * If that fails, the text has already been kept as a draft; the close is held once and the
 * writer is told, and a second close goes through.
 */
export function WindowCloseGuard() {
  const { t } = useI18n();
  const guard = useEditorGuard();
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const un = await getCurrentWindow().onCloseRequested(async (event) => {
        if (heldRef.current) return; // second close: let it go
        const ok = await guard.flush();
        if (!ok) {
          event.preventDefault();
          heldRef.current = true;
          setHeld(true);
        }
      });
      if (disposed) un();
      else unlisten = un;
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [guard]);

  if (!held) return null;
  return (
    <div role="alertdialog" className="close-held notice notice-error">
      <p>{t("manuscript.closeHeld")}</p>
      <p className="actions">
        <button
          type="button"
          onClick={() => {
            heldRef.current = false;
            setHeld(false);
          }}
        >
          {t("manuscript.closeStay")}
        </button>
      </p>
    </div>
  );
}
