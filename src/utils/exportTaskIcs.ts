/**
 * exportTaskIcs — calls the Rust `export_task_ics` command to write a
 * temporary .ics file and open it in the system calendar app.
 *
 * Guard: returns early when task.deadline is null (no deadline = nothing to
 * export). The "In Kalender" buttons in TaskDetail and TaskMetaChips are
 * already disabled in that case, so this is a defensive double-check.
 *
 * Error handling: logs via logError (avoids silent swallowing) and surfaces a
 * German toast so the user knows the export failed without a console-only hint.
 * Success is silent — the OS calendar app opens, which is confirmation enough.
 */

import { invoke } from "@tauri-apps/api/core";
import { logError } from "./errorLogger";
import { useUIStore } from "../store/uiStore";
import type { TaskItem } from "../store/tasksStore";

export async function exportTaskIcs(task: TaskItem): Promise<void> {
  // Guard: no deadline → nothing to export (buttons should already be disabled)
  if (task.deadline === null) return;

  try {
    await invoke("export_task_ics", {
      title: task.title,
      deadline: task.deadline,
      deadlineHasTime: task.deadlineHasTime,
      note: task.note ?? null,
    });
  } catch (err) {
    logError("exportTaskIcs", err);
    useUIStore.getState().addToast({
      type: "error",
      title: "Kalender-Export fehlgeschlagen",
    });
  }
}
