import type { TaskItem } from "../store/tasksStore";

/**
 * Cross-window task-list propagation.
 *
 * Tasks surfaces live in separate webviews: the main window (session-grid
 * task badge + floating TasksWindow) and the detached "Aufgaben" window
 * (view=tasks). Each webview holds its OWN tasksStore instance, so a mutation
 * in one is invisible to the others until reload. This mirrors the proven
 * preferencesBroadcast bridge: on every local task change we emit the full
 * task list; receivers apply it to their store and re-render reactively.
 *
 * Tauri emits to ALL webviews including the sender — so each payload carries
 * `sourceWindow` and the listener early-returns on echo. The receiver applies
 * via raw `setState` (see wireRuntimeGates.applyRemoteTasks) so applying a
 * remote change never re-broadcasts and loops.
 */

const EVENT_NAME = "tasks-changed";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface TasksChangedPayload {
  tasks: TaskItem[];
  sourceWindow: string;
}

let cachedWindowLabel: string | null = null;

async function getWindowLabel(): Promise<string> {
  if (cachedWindowLabel !== null) return cachedWindowLabel;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  cachedWindowLabel = getCurrentWindow().label;
  return cachedWindowLabel;
}

/**
 * Emit the current task list to all windows (including self — receivers filter
 * themselves out via `sourceWindow`). No-op outside Tauri. Errors are swallowed:
 * a failed broadcast must not break the local state update that just succeeded.
 */
export async function broadcastTasksChange(tasks: TaskItem[]): Promise<void> {
  if (!isTauri) return;
  try {
    const [{ emit }, sourceWindow] = await Promise.all([
      import("@tauri-apps/api/event"),
      getWindowLabel(),
    ]);
    await emit(EVENT_NAME, { tasks, sourceWindow } satisfies TasksChangedPayload);
  } catch {
    // Swallowed — local state already updated.
  }
}

/**
 * Subscribe to cross-window task changes. The handler receives the foreign
 * window's task list (own-window echoes are filtered out). Returns an async
 * unsubscribe. No-op outside Tauri.
 */
export async function listenForTasksChanges(
  apply: (tasks: TaskItem[]) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const myLabel = await getWindowLabel();
  return listen<TasksChangedPayload>(EVENT_NAME, (event) => {
    if (!event.payload || event.payload.sourceWindow === myLabel) return;
    apply(event.payload.tasks);
  });
}
