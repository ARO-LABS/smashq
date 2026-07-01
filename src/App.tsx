import { useEffect, useRef } from "react";
import { AppShell } from "./components/layout/AppShell";
import { installGlobalErrorHandlers } from "./utils/globalErrorHandler";
import { wireRuntimeGates, syncBackendFileLoggingFromPreferences } from "./utils/wireRuntimeGates";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSessionRestore } from "./hooks/useSessionRestore";
import { initSessionRestoreSync } from "./store/sessionRestoreSync";
import { flushPendingSaves } from "./store/tauriStorage";
import { flushPendingTaskSaves } from "./store/tasksStorage";
import { useUIStore } from "./store/uiStore";

function App() {
  useThemeEffect();
  useSessionRestore();

  // Guard against double-registration in React Strict Mode: the ref persists
  // across the mount → unmount → remount cycle that Strict Mode triggers in dev.
  const listenerActive = useRef(false);

  useEffect(() => {
    if (listenerActive.current) return;
    listenerActive.current = true;

    // Install global error handlers once
    installGlobalErrorHandlers();

    // Wire runtime logging + perf gates against the persisted preferences.
    // The Settings toggle is the sole authority for perf capture (no DEV/
    // localStorage OR); manual dev override remains via window.__perf.enable().
    // The main window's settings/notes/tasks flush rides along on
    // wireRuntimeGates' own close-requested listener (additionalCloseFlush)
    // rather than registering a second, independent one — two listeners on
    // the same window each race to destroy() it once their own async work
    // resolves, and the (usually near-instant, logging-off-by-default)
    // frontend-log flush used to win that race before this flush finished.
    const unsubscribePerf = wireRuntimeGates({
      additionalCloseFlush: () =>
        Promise.all([flushPendingSaves(), flushPendingTaskSaves()]).then(() => {}),
    });

    // Push the persisted backend-file-logging value to Rust. Only the main
    // window owns this; detached windows share the same Rust process flag.
    syncBackendFileLoggingFromPreferences();

    // Surface settings-save failures as toast. tauriStorage and settingsStore
    // dispatch this CustomEvent on persistence failures (after the in-store
    // retry); previously no listener existed → silent loss of user changes.
    const handleSaveError = (event: Event) => {
      const detail = (event as CustomEvent<{ error: string }>).detail;
      useUIStore.getState().addToast({
        type: "error",
        title: "Einstellungen konnten nicht gespeichert werden",
        message: detail?.error ?? "Unbekannter Fehler — bitte App-Neustart versuchen.",
        duration: 10000,
      });
    };
    window.addEventListener("storage-save-error", handleSaveError);

    // Fallback for non-Tauri environments (dev browser): beforeunload cannot
    // be awaited, but flushPendingSaves()/flushPendingTaskSaves() already
    // no-op outside Tauri anyway, so this is a harmless best-effort net for
    // `npm run dev` in a plain browser tab.
    const handleBeforeUnload = () => {
      void flushPendingSaves();
      void flushPendingTaskSaves();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Sync open sessions to settingsStore for restore on next startup
    const unsubscribeRestore = initSessionRestoreSync();

    return () => {
      unsubscribeRestore();
      unsubscribePerf();
      window.removeEventListener("storage-save-error", handleSaveError);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      listenerActive.current = false;
    };
  }, []);

  return <AppShell />;
}

export default App;
