/**
 * exportTaskIcs — calls the Rust `export_task_ics` command to write a
 * temporary .ics file and open it in the system calendar app.
 *
 * Tasks without Termin (startsAt/endsAt === null) are a no-op: there is no
 * VEVENT time window to export. Callers disable the button in that state; the
 * guard here additionally protects programmatic call sites.
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
  // Kein Termin → kein Export (UI disabled den Button; Guard für Programm-Pfade).
  if (task.startsAt === null || task.endsAt === null) return;
  try {
    await invoke("export_task_ics", {
      title: task.title,
      startsAt: task.startsAt,
      endsAt: task.endsAt,
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
