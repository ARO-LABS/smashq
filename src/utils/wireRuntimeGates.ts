import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, type AppPreferencesSettings } from "../store/settingsStore";
import { wireLoggingGate, wirePersistenceGate, flushFrontendLogs, logError } from "./errorLogger";
import { setPerfEnabled } from "./perfLogger";
import { listenForPreferencesChanges, type BroadcastPartial } from "./preferencesBroadcast";
import { useTasksStore, sanitizeTasks, type TaskItem } from "../store/tasksStore";
import { setSuppressTasksPersist } from "../store/tasksStorage";
import { broadcastTasksChange, listenForTasksChanges } from "./tasksBroadcast";

/**
 * Apply a cross-window preferences delta locally. Bypasses the `setPreferences`
 * setter to avoid retriggering the broadcast (echo loop) and to avoid invoking
 * Rust-side commands that the source window already invoked.
 */
function applyRemotePartial(partial: BroadcastPartial): void {
  // favoritesUpdate signals trigger a favorites reload in the receiver window;
  // the tauriStorage layer handles re-hydration separately — nothing to do here.
  if ("favoritesUpdate" in partial) return;
  // Theme delta from another window (e.g. toggling light/dark in the main
  // window while a detached Bibliothek is open). Apply via raw setState — NOT
  // setTheme — so this application does not re-broadcast and loop.
  if ("theme" in partial) {
    const cur = useSettingsStore.getState().theme;
    const next = { ...cur, ...partial.theme };
    const changed = (Object.keys(partial.theme) as (keyof typeof cur)[]).some(
      (k) => cur[k] !== next[k],
    );
    if (!changed) return;
    useSettingsStore.setState({ theme: next });
    return;
  }
  const state = useSettingsStore.getState();
  const next = { ...state.preferences, ...partial };
  // Skip when nothing actually changes — saves a needless re-render.
  const changed = Object.keys(partial).some(
    (k) => state.preferences[k as keyof AppPreferencesSettings] !== next[k as keyof AppPreferencesSettings],
  );
  if (!changed) return;
  useSettingsStore.setState({ preferences: next });
}

/**
 * Apply a cross-window task list locally. Sets a guard flag so the broadcaster
 * subscription (wired in wireRuntimeGates) does NOT re-emit this change and loop
 * forever. Re-sanitizes the incoming list — cross-window data is a trust
 * boundary, and sanitizeTasks is idempotent on already-clean data.
 */
let applyingRemoteTasks = false;
function applyRemoteTasks(tasks: TaskItem[]): void {
  applyingRemoteTasks = true;
  // Suppress the persist write triggered by this setState: zustand persist
  // calls tasksStorage.setItem synchronously inside setState, so wrapping the
  // call covers it. The source window already wrote tasks.json — re-persisting
  // here is a redundant concurrent write + double backup churn (Bug #4).
  setSuppressTasksPersist(true);
  try {
    useTasksStore.setState({ tasks: sanitizeTasks(tasks) });
  } finally {
    setSuppressTasksPersist(false);
    applyingRemoteTasks = false;
  }
}

export interface WireRuntimeGatesOptions {
  /**
   * Extra async work to await before this window is allowed to close (e.g.
   * the main window's settings/notes/tasks flush). Runs alongside the
   * internal frontend-log flush in the SAME `onCloseRequested` listener —
   * see the race this closes below.
   */
  additionalCloseFlush?: () => Promise<void>;
}

/**
 * Wires runtime preference gates for the current React root. Must be called
 * from EVERY entry point (main App, log window, detached views) — each window
 * mounts its own root and the module-local gate state is per-window.
 *
 * Returns an unsubscribe function that tears down the perf-store subscription
 * AND the cross-window preferences listener. Pass it to a useEffect cleanup.
 */
export function wireRuntimeGates(options?: WireRuntimeGatesOptions): () => void {
  // Frontend gate is a function reference re-read on every log call —
  // no subscription needed, just inject the closure once.
  wireLoggingGate(() => useSettingsStore.getState().preferences.frontendLogging);

  // Persistence gate follows the master disk toggle (backendFileLogging) — both
  // log sources persist to the one NDJSON file.
  wirePersistenceGate(() => useSettingsStore.getState().preferences.backendFileLogging);

  // Settings toggle is the single source of truth. No DEV/localStorage OR —
  // disabling must actually skip work. Manual override: window.__perf.enable().
  const computePerfEnabled = () =>
    useSettingsStore.getState().preferences.performanceProfiler;
  setPerfEnabled(computePerfEnabled());

  const unsubscribePerf = useSettingsStore.subscribe((state, prev) => {
    if (state.preferences.performanceProfiler !== prev.preferences.performanceProfiler) {
      setPerfEnabled(computePerfEnabled());
    }
  });

  // Listen for cross-window preferences changes. Promise resolves once Tauri
  // returns the unlisten handle; we hold the promise so cleanup awaits it.
  let unlistenCrossWindow: (() => void) | null = null;
  void listenForPreferencesChanges(applyRemotePartial)
    .then((unlisten) => {
      unlistenCrossWindow = unlisten;
    })
    .catch((err) => logError("wireRuntimeGates.crossWindowListen", err));

  // Cross-window task sync. Each webview holds its own tasksStore instance, so
  // a mutation in the detached "Aufgaben" window would otherwise leave the
  // main-window session badge stale. Broadcast local task changes to all
  // windows; apply remote ones via applyRemoteTasks (which guards the echo).
  const unsubscribeTasks = useTasksStore.subscribe((state, prev) => {
    if (state.tasks === prev.tasks || applyingRemoteTasks) return;
    void broadcastTasksChange(state.tasks);
  });
  let unlistenTasks: (() => void) | null = null;
  void listenForTasksChanges(applyRemoteTasks)
    .then((unlisten) => {
      unlistenTasks = unlisten;
    })
    .catch((err) => logError("wireRuntimeGates.tasksListen", err));

  // Flush buffered frontend logs (and any caller-supplied additional work,
  // e.g. App.tsx's settings/notes/tasks flush) when THIS window closes. Use
  // Tauri's close-requested event (async-aware) — NOT `beforeunload`, which
  // Tauri webviews fire unreliably and cannot await, so the last batch could
  // be lost.
  //
  // This must be the ONLY `onCloseRequested` listener registered per window.
  // Tauri fans the close-requested event out to every listener independently
  // and destroys the window once a given listener's own async callback
  // resolves (unless that listener called `event.preventDefault()`). Two
  // separate listeners on the same window therefore race to destroy() it —
  // previously App.tsx registered its own listener for flushPendingSaves()/
  // flushPendingTaskSaves() alongside this one. Since frontend logging is off
  // by default, flushFrontendLogs() resolved near-instantly and won that
  // race, destroying the window (and its IPC channel) before the slower
  // notes/settings flush had completed — silently dropping recent edits.
  // Bundling every flush into one Promise.all here means the window is only
  // destroyed once ALL of them have actually finished.
  let unlistenClose: (() => void) | undefined;
  void import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) =>
      getCurrentWindow()
        .onCloseRequested(async () => {
          await Promise.all([
            flushFrontendLogs(),
            options?.additionalCloseFlush?.() ?? Promise.resolve(),
          ]);
        })
        .then((fn) => {
          unlistenClose = fn;
        }),
    )
    .catch((err) => logError("wireRuntimeGates.closeFlush", err));

  return () => {
    unsubscribePerf();
    unsubscribeTasks();
    unlistenCrossWindow?.();
    unlistenTasks?.();
    unlistenClose?.();
    // Final flush on React unmount (covers HMR + detached-view teardown).
    void flushFrontendLogs();
  };
}

/**
 * Pushes the persisted backendFileLogging value to the Rust side. Only the
 * main window calls this — the Rust flag is process-global, racing it from
 * multiple webview roots would cause stutter.
 */
export function syncBackendFileLoggingFromPreferences(): void {
  const enabled = useSettingsStore.getState().preferences.backendFileLogging;
  invoke("set_file_logging_enabled", { enabled }).catch((err) =>
    logError("wireRuntimeGates.backendSync", err),
  );
}
