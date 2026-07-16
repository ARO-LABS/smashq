import { invoke } from "@tauri-apps/api/core";
import {
  useSettingsStore,
  sanitizePermissionMode,
  type AppPreferencesSettings,
  type SettingsState,
} from "../store/settingsStore";
import {
  wireLoggingGate,
  wirePersistenceGate,
  flushFrontendLogs,
  listenForLogSnapshotRequests,
  listenForLogCleared,
  logError,
} from "./errorLogger";
import { useLogViewerStore } from "../store/logViewerStore";
import { setPerfEnabled } from "./perfLogger";
import {
  listenForPreferencesChanges,
  type BroadcastPartial,
  type SettingsSyncPartial,
} from "./preferencesBroadcast";
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
  // Top-level settings fields from a secondary window (settings window).
  // Applying them here in the main window is what actually persists them —
  // the sender window's own disk writes are dropped by the isMainWindow guard.
  if ("settingsSync" in partial) {
    applySettingsSync(partial.settingsSync);
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

const SHELL_PREFS: readonly SettingsState["defaultShell"][] = [
  "auto",
  "powershell",
  "bash",
  "cmd",
  "zsh",
];

/**
 * Apply a top-level settings partial from another window. Raw setState (no
 * setter) — a setter would re-broadcast and loop the windows. Cross-window
 * payloads are a trust boundary: enum-like fields are re-sanitized before
 * they enter the persisted state (same stance as applyRemoteTasks).
 * Exported for tests.
 */
export function applySettingsSync(sync: SettingsSyncPartial): void {
  const state = useSettingsStore.getState();
  const patch: Partial<SettingsState> = {};
  if (sync.defaultPermissionMode !== undefined) {
    const mode = sanitizePermissionMode(sync.defaultPermissionMode);
    if (mode !== state.defaultPermissionMode) patch.defaultPermissionMode = mode;
  }
  if (
    sync.defaultShell !== undefined &&
    SHELL_PREFS.includes(sync.defaultShell) &&
    sync.defaultShell !== state.defaultShell
  ) {
    patch.defaultShell = sync.defaultShell;
  }
  if (typeof sync.defaultProjectPath === "string" && sync.defaultProjectPath !== state.defaultProjectPath) {
    patch.defaultProjectPath = sync.defaultProjectPath;
  }
  if (sync.notifications) {
    const next = { ...state.notifications, ...sync.notifications };
    const changed = (Object.keys(sync.notifications) as (keyof typeof next)[]).some(
      (k) => state.notifications[k] !== next[k],
    );
    if (changed) patch.notifications = next;
  }
  if (sync.sound) {
    const next = { ...state.sound, ...sync.sound };
    const changed = (Object.keys(sync.sound) as (keyof typeof next)[]).some(
      (k) => state.sound[k] !== next[k],
    );
    if (changed) patch.sound = next;
  }
  if (Object.keys(patch).length > 0) {
    useSettingsStore.setState(patch);
  }
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

/**
 * Elements where the native WebView context menu (copy/paste/select-all) is
 * still useful — text-entry surfaces. Everywhere else the native menu only
 * offers navigation junk (Zurück/Aktualisieren/Drucken), which is meaningless
 * in a desktop app, so we suppress it.
 */
const EDITABLE_MENU_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * True when the right-click target sits inside an editable field and should
 * keep the native context menu. `closest()` walks ancestors, so a child node
 * inside a contenteditable region counts as editable too.
 */
export function shouldKeepNativeMenu(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(EDITABLE_MENU_SELECTOR) !== null;
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
  // Suppress the native WebView context menu app-wide (every window calls this),
  // except inside editable fields where copy/paste is still wanted. Keyboard
  // shortcuts (Ctrl+C/V) are unaffected. The terminal keeps its own handler.
  const suppressNativeMenu = (e: MouseEvent) => {
    if (shouldKeepNativeMenu(e.target)) return;
    e.preventDefault();
  };
  document.addEventListener("contextmenu", suppressNativeMenu);

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

  // Guard for all async listener registrations below: when the cleanup runs
  // BEFORE a listen() promise resolves (StrictMode double-mount, HMR), the
  // late-arriving listener would otherwise register after teardown and never
  // be removable — breaking the documented single-onCloseRequested invariant.
  let disposed = false;

  // Listen for cross-window preferences changes. Promise resolves once Tauri
  // returns the unlisten handle; we hold the promise so cleanup awaits it.
  let unlistenCrossWindow: (() => void) | null = null;
  void listenForPreferencesChanges(applyRemotePartial)
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
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
      if (disposed) {
        unlisten();
        return;
      }
      unlistenTasks = unlisten;
    })
    .catch((err) => logError("wireRuntimeGates.tasksListen", err));

  // Answer log-snapshot requests from a freshly mounted Protokolle window
  // with this window's in-memory log entries (each webview has its own
  // logViewerStore instance — the file alone misses the default config).
  let unlistenSnapshot: (() => void) | null = null;
  void listenForLogSnapshotRequests()
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenSnapshot = unlisten;
    })
    .catch((err) => logError("wireRuntimeGates.logSnapshot", err));

  // A clear in any window wipes that window's store + the on-disk file, but
  // other windows keep their in-memory entries — which would flow back via the
  // snapshot sync on the next LogViewer mount. Clear this window's store too
  // when any other window broadcasts log-cleared.
  let unlistenLogCleared: (() => void) | null = null;
  void listenForLogCleared(() => useLogViewerStore.getState().clearEntries())
    .then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenLogCleared = unlisten;
    })
    .catch((err) => logError("wireRuntimeGates.logCleared", err));

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
          if (disposed) {
            fn();
            return;
          }
          unlistenClose = fn;
        }),
    )
    .catch((err) => logError("wireRuntimeGates.closeFlush", err));

  return () => {
    disposed = true;
    document.removeEventListener("contextmenu", suppressNativeMenu);
    unsubscribePerf();
    unsubscribeTasks();
    unlistenCrossWindow?.();
    unlistenTasks?.();
    unlistenSnapshot?.();
    unlistenLogCleared?.();
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
