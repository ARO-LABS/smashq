/**
 * ConfigTasksViewer — kompakt-interaktive Aufgaben-Liste im Config-Panel.
 *
 * Anatomy:
 *   header    — "N OFFENE AUFGABEN" (uppercase-tracking) + Icon-Button
 *               "In großer Ansicht öffnen" (nur wenn offene Aufgaben existieren)
 *   quick-add — Enter legt an (Fokus bleibt für Serien-Eingabe), Escape leert
 *   rows      — Checkbox (→ completeTask), Titel, Deadline-Chip (compact),
 *               Subtask-Tally "x/y" nur bei vorhandenen Subtasks,
 *               Hover-Pfeil öffnet die große Aufgaben-View
 *   done      — einklappbare "Erledigt (N)"-Sektion (default zu), Zeilen
 *               durchgestrichen, Checkbox-Klick → reopenTask
 *   empty     — Quick-Add bleibt sichtbar + Button "Aufgaben-View öffnen"
 *
 * Warum Ableitung via useMemo statt der curried Store-Selektoren?
 * Die Selektoren erzeugen pro Aufruf neue Arrays — als Zustand-Subscription
 * würde jede Store-Änderung re-rendern. Eine primitive Subscription auf
 * `s.tasks` + Memo über die Referenz hält die Ableitung stabil und typisiert.
 */

import { useMemo, useState, type FC, type JSX } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ICONS } from "../../utils/icons";
import { logError } from "../../utils/errorLogger";
import { useTasksStore, type TaskItem } from "../../store/tasksStore";
import { normalizeProjectKey } from "../../store/settingsStore";
import { TaskDeadlineChip } from "../shared/tasks/TaskDeadlineChip";

// ── Shared helpers ─────────────────────────────────────────────────────

/** Öffnet die große Aufgaben-View in einem eigenen Fenster. */
function openTasksWindow(): void {
  invoke("open_detached_window", { view: "tasks", title: "Aufgaben" }).catch(
    (err: unknown) => logError("ConfigTasksViewer.openTasksWindow", err),
  );
}

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

// ── Quick-add row ──────────────────────────────────────────────────────

function QuickAddRow({ onAdd }: { onAdd: (title: string) => void }): JSX.Element {
  const [value, setValue] = useState("");
  const PlusIcon = ICONS.action.newSession;

  return (
    <div className="mx-3 mb-1.5 flex items-center gap-2 px-2.5 py-1.5 bg-surface-raised border border-dashed border-neutral-700 rounded-md focus-within:border-solid">
      <PlusIcon className="w-3 h-3 text-accent shrink-0" aria-hidden="true" />
      <input
        type="text"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const trimmed = value.trim();
            if (!trimmed) return;
            onAdd(trimmed);
            setValue(""); // Fokus bleibt im Input — Serien-Anlage ohne Re-Klick
          } else if (e.key === "Escape") {
            setValue("");
          }
        }}
        placeholder="Aufgabe hinzufügen …"
        aria-label="Aufgabe hinzufügen"
        className="flex-1 min-w-0 bg-transparent text-[11px] text-neutral-300 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset rounded-sm"
      />
    </div>
  );
}

// ── Task row ───────────────────────────────────────────────────────────

function TaskRowCompact({ task }: { task: TaskItem }): JSX.Element {
  const completeTask = useTasksStore((s) => s.completeTask);
  const reopenTask = useTasksStore((s) => s.reopenTask);
  const done = task.status === "done";
  const CheckIcon = ICONS.tasks.check;
  const ArrowIcon = ICONS.tasks.next;

  const subtaskTally =
    task.subtasks.length > 0
      ? `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`
      : null;

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 rounded-sm hover:bg-hover-overlay transition-colors">
      {/* Checkbox */}
      <button
        type="button"
        onClick={() => (done ? reopenTask(task.id) : completeTask(task.id))}
        aria-label={done ? `Aufgabe wieder öffnen: ${task.title}` : `Aufgabe erledigen: ${task.title}`}
        title={done ? "Wieder öffnen" : "Erledigen"}
        className={[
          "shrink-0 mt-0.5 w-[15px] h-[15px] rounded-[5px] border inline-flex items-center justify-center transition-colors",
          FOCUS_RING,
          done
            ? "bg-accent border-accent text-surface-base"
            : "border-neutral-600 hover:border-accent",
        ].join(" ")}
      >
        {done && <CheckIcon className="w-2.5 h-2.5" aria-hidden="true" />}
      </button>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <div
          className={[
            "text-[11.5px] truncate",
            done ? "line-through text-neutral-500" : "text-neutral-200",
          ].join(" ")}
        >
          {task.title}
        </div>
        {!done && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <TaskDeadlineChip task={task} compact />
            {subtaskTally !== null && (
              <span className="font-mono text-[10px] text-neutral-500">{subtaskTally}</span>
            )}
          </div>
        )}
      </div>

      {/* Hover-Pfeil → große Ansicht */}
      <button
        type="button"
        onClick={openTasksWindow}
        aria-label={`In Aufgaben-View öffnen: ${task.title}`}
        title="In Aufgaben-View öffnen"
        className={[
          "shrink-0 mt-0.5 p-0.5 rounded-sm text-neutral-500 hover:text-accent",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
          FOCUS_RING,
        ].join(" ")}
      >
        <ArrowIcon className="w-3 h-3" aria-hidden="true" />
      </button>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

interface ConfigTasksViewerProps {
  folder: string;
}

const ConfigTasksViewer: FC<ConfigTasksViewerProps> = ({ folder }) => {
  const projectKey = normalizeProjectKey(folder);
  const tasks = useTasksStore((s) => s.tasks);
  const addTask = useTasksStore((s) => s.addTask);
  const [doneOpen, setDoneOpen] = useState(false);

  const { open, done } = useMemo(() => {
    const forProject = tasks.filter((t) => t.projectKey === projectKey);
    return {
      open: forProject
        .filter((t) => t.status !== "done")
        .sort((a, b) => a.sortIndex - b.sortIndex),
      done: forProject
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    };
  }, [tasks, projectKey]);

  const OpenLargeIcon = ICONS.tasks.next;
  const ChevronIcon = ICONS.action.chevronRight;
  const PanelIcon = ICONS.tasks.panel;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-2" data-testid="config-tasks-viewer">
      {/* Header — nur bei offenen Aufgaben */}
      {open.length > 0 && (
        <div className="flex items-center justify-between px-3 pb-1.5">
          <span className="text-[11px] font-semibold tracking-widest uppercase text-neutral-500">
            {open.length} offene {open.length === 1 ? "Aufgabe" : "Aufgaben"}
          </span>
          <button
            type="button"
            onClick={openTasksWindow}
            title="In großer Ansicht öffnen"
            aria-label="In großer Ansicht öffnen"
            className={[
              "p-1 rounded-md text-neutral-400 hover:text-accent hover:bg-accent-a05 transition-colors",
              FOCUS_RING,
            ].join(" ")}
          >
            <OpenLargeIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Quick-add — bleibt auch im Leerzustand sichtbar */}
      <QuickAddRow onAdd={(title) => addTask({ title, projectKey })} />

      {/* Offene Aufgaben oder Leerzustand */}
      {open.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <PanelIcon className="w-6 h-6 text-neutral-600" aria-hidden="true" />
          <p className="text-[11.5px] text-neutral-500 leading-relaxed">
            Keine offenen Aufgaben für dieses Projekt.
            <br />
            Neue Aufgabe oben anlegen oder die Aufgaben-View öffnen.
          </p>
          <button
            type="button"
            onClick={openTasksWindow}
            className={[
              "px-3 py-1.5 rounded-md bg-accent text-surface-base text-[11px] font-medium",
              "shadow-hairline hover:opacity-90 transition-opacity",
              FOCUS_RING,
            ].join(" ")}
          >
            Aufgaben-View öffnen
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-px px-0.5">
          {open.map((task) => (
            <TaskRowCompact key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Erledigt-Sektion — nur wenn erledigte Aufgaben existieren */}
      {done.length > 0 && (
        <div className="mt-2 border-t border-neutral-800 pt-1.5">
          <button
            type="button"
            onClick={() => setDoneOpen((v) => !v)}
            aria-expanded={doneOpen}
            className={[
              "flex items-center gap-1 px-3 py-1 text-[10.5px] text-neutral-500 hover:text-neutral-300 transition-colors",
              FOCUS_RING,
            ].join(" ")}
          >
            <ChevronIcon
              className={["w-3 h-3 transition-transform", doneOpen ? "rotate-90" : ""].join(" ")}
              aria-hidden="true"
            />
            Erledigt ({done.length})
          </button>
          {doneOpen && (
            <div className="flex flex-col gap-px px-0.5">
              {done.map((task) => (
                <TaskRowCompact key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ConfigTasksViewer;
