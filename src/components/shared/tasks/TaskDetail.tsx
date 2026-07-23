/**
 * TaskDetail — two-mode detail view for a single TaskItem.
 *
 * Modes:
 * - "pane"      — full sidebar panel (editable title, fields layout meta,
 *                 note textarea, subtasks list, state-dependent action bar)
 * - "accordion" — compact inline expansion (chiprow meta, compact note,
 *                 subtask count + rows, tiny ghost Löschen with inline confirm)
 *
 * Why two modes in one component?
 * Both modes share the same data contract (TaskDetailProps) and render the
 * same sub-structure (meta, note, subtasks). Co-location avoids drift: a
 * subtask toggle fixed here is fixed in both surfaces at once.
 *
 * In-Kalender button:
 * Calls `onExportIcs` (optional prop); disabled while the task has no Termin
 * (startsAt === null) — there is no time window to export then.
 * The spec wires this to `invoke("export_task_ics", …)` at the parent level
 * so TaskDetail stays backend-agnostic.
 *
 * Pane Deadline row with calbtn:
 * TaskMetaChips layout="fields" renders Status / Deadline / Projekt rows.
 * The spec wants the "In Kalender" button appended after the Deadline value
 * cell. We pass `onExportIcs` through TaskMetaChips (which owns the calmini
 * in chiprow mode) and render a standalone calbtn row in the pane below the
 * three meta rows, indented to align with the value column.
 */

import type { JSX } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { ICONS } from "../../../utils/icons";
import type { TaskItem, UpdateTaskFields, Subtask } from "../../../store/tasksStore";
import { TaskMetaChips } from "./TaskMetaChips";
import type { ProjectOption } from "./TaskMetaChips";
import { StatusDot } from "./StatusDot";

// ── Types ──────────────────────────────────────────────────────────────

export interface TaskDetailProps {
  task: TaskItem;
  mode: "pane" | "accordion";
  availableProjects: ProjectOption[];
  onUpdate: (fields: UpdateTaskFields) => void;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
  /** Called when the user clicks "In Kalender". */
  onExportIcs?: () => void;
  /** Pane mode only: focus + select the title input (for a just-created task). */
  autoFocusTitle?: boolean;
  /** Called once after the title was auto-focused, so the parent clears its flag. */
  onTitleAutoFocused?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Format an epoch-ms completedAt timestamp as "HH:MM". */
function formatCompletedTime(epoch: number): string {
  const d = new Date(epoch);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Debounce hook — returns a stable debounced callback. The timer is cleared
 * on unmount so the callback is never invoked after the component is gone.
 */
function useDebounced<T extends unknown[]>(
  fn: (...args: T) => void,
  delayMs: number,
): (...args: T) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback(
    (...args: T): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fnRef.current(...args);
      }, delayMs);
    },
    [delayMs],
  );
}

// ── Subtask row ────────────────────────────────────────────────────────

interface SubtaskRowProps {
  subtask: Subtask;
  onToggle: () => void;
}

function SubtaskRow({ subtask, onToggle }: SubtaskRowProps): JSX.Element {
  const CheckIcon = ICONS.tasks.check;

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        type="button"
        onClick={onToggle}
        aria-label={subtask.done ? "Teilschritt rückgängig" : "Teilschritt erledigen"}
        className="shrink-0 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-full"
      >
        {subtask.done ? (
          <span
            className="flex items-center justify-center rounded-full bg-success"
            style={{ width: 14, height: 14 }}
          >
            <CheckIcon className="w-2 h-2 text-surface-base" aria-hidden="true" />
          </span>
        ) : (
          <span
            className="rounded-full border-[1.5px] border-neutral-500"
            style={{ width: 14, height: 14, display: "inline-block" }}
          />
        )}
      </button>
      <span
        className={[
          "text-xs",
          subtask.done ? "line-through text-neutral-500" : "text-neutral-300",
        ].join(" ")}
      >
        {subtask.title}
      </span>
    </div>
  );
}

// ── Add-subtask row ────────────────────────────────────────────────────

interface AddSubtaskRowProps {
  onAdd: (title: string) => void;
}

function AddSubtaskRow({ onAdd }: AddSubtaskRowProps): JSX.Element {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const PlusIcon = ICONS.action.newSession;

  // keepFocus: re-focus the input after an explicit add (+ click / Enter) so
  // several steps can be typed in a row. On blur we commit but let focus go.
  const commit = (keepFocus: boolean): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
    if (keepFocus) inputRef.current?.focus();
  };

  return (
    <div className="flex items-center gap-1.5 py-1 text-[11.5px] text-neutral-500">
      <button
        type="button"
        // preventDefault on mousedown keeps the input focused, so clicking the
        // + does not fire the input's onBlur (which would double-commit).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => commit(true)}
        aria-label="Teilschritt hinzufügen"
        className="shrink-0 rounded-sm text-neutral-500 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <PlusIcon className="w-3 h-3" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(true);
          }
        }}
        // Commit on blur so a typed-but-not-Entered step is never lost.
        onBlur={() => commit(false)}
        placeholder="Teilschritt"
        className="flex-1 bg-transparent text-[11.5px] text-neutral-300 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset rounded-sm"
        aria-label="Teilschritt eingeben"
      />
    </div>
  );
}

// ── Pane mode ─────────────────────────────────────────────────────────

function PaneDetail({
  task,
  availableProjects,
  onUpdate,
  onComplete,
  onReopen,
  onDelete,
  onExportIcs,
  autoFocusTitle,
  onTitleAutoFocused,
}: Omit<TaskDetailProps, "mode">): JSX.Element {
  // ── Title editing ───────────────────────────────────────────────────
  const [titleValue, setTitleValue] = useState(task.title);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Sync when a different task is passed in (id change)
  useEffect(() => {
    setTitleValue(task.title);
  }, [task.id, task.title]);

  // One-step "Neue Aufgabe": focus + select the default title so the user types
  // straight over it. Guarded so it fires once per freshly-created task; the
  // parent clears its flag via onTitleAutoFocused, flipping autoFocusTitle off.
  useEffect(() => {
    if (!autoFocusTitle) return;
    const el = titleInputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
    onTitleAutoFocused?.();
  }, [autoFocusTitle, task.id, onTitleAutoFocused]);

  const commitTitle = (): void => {
    const trimmed = titleValue.trim();
    if (!trimmed || trimmed === task.title) return;
    onUpdate({ title: trimmed });
  };

  // ── Note (debounced) ────────────────────────────────────────────────
  const [noteValue, setNoteValue] = useState(task.note ?? "");

  useEffect(() => {
    setNoteValue(task.note ?? "");
  }, [task.id, task.note]);

  const debouncedNoteUpdate = useDebounced((note: string) => {
    onUpdate({ note });
  }, 400);

  const handleNoteChange = (value: string): void => {
    setNoteValue(value);
    debouncedNoteUpdate(value);
  };

  // ── Delete confirm state ─────────────────────────────────────────────
  const [confirming, setConfirming] = useState(false);

  // Reset confirm state when the displayed task changes so a primed
  // confirmation does not carry over to a different task.
  useEffect(() => {
    setConfirming(false);
  }, [task.id]);

  // ── Subtask helpers ──────────────────────────────────────────────────
  const handleSubtaskToggle = (subtaskId: string): void => {
    const next = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, done: !s.done } : s,
    );
    onUpdate({ subtasks: next });
  };

  const handleAddSubtask = (title: string): void => {
    const next: Subtask[] = [
      ...task.subtasks,
      {
        id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        done: false,
      },
    ];
    onUpdate({ subtasks: next });
  };

  // ── Icons ────────────────────────────────────────────────────────────
  const CheckIcon = ICONS.tasks.check;
  const ReopenIcon = ICONS.tasks.reopen;
  const TrashIcon = ICONS.action.trash;
  const CalendarAddIcon = ICONS.tasks.calendarAdd;

  const isOpenOrActive = task.status === "open" || task.status === "active";
  const isDone = task.status === "done";
  const doneTally = `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`;

  return (
    <div className="flex flex-col h-full">
      {/* ── Head ───────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 px-4 py-3">
        <StatusDot status={task.status} size={11} />
        <input
          ref={titleInputRef}
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          className="flex-1 text-[17px] leading-snug text-neutral-100 font-medium bg-transparent border-b border-dashed border-neutral-700 focus:border-accent focus-visible:outline-none"
          aria-label="Aufgabentitel"
        />
      </div>

      {/* ── Meta fields ────────────────────────────────────────────── */}
      <div className="px-3.5 pb-3 flex flex-col gap-0.5">
        {/* Status / Deadline / Projekt rows via TaskMetaChips fields layout */}
        <TaskMetaChips
          task={task}
          layout="fields"
          availableProjects={availableProjects}
          onUpdate={onUpdate}
          onComplete={onComplete}
          onReopen={onReopen}
        />

        {/* "In Kalender" row — aligned to the value column (w-[66px] label + button).
            Spec: appended after the Deadline row, ml-1. */}
        <div className="flex items-center gap-2">
          <span className="w-[66px] shrink-0" aria-hidden="true" />
          <button
            type="button"
            disabled={task.startsAt === null}
            title={task.startsAt === null ? "Erst Termin setzen" : undefined}
            onClick={onExportIcs}
            aria-label="In Kalender exportieren"
            className="calbtn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-base shadow-hairline text-[11px] text-neutral-400 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-1 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            <CalendarAddIcon className="w-3 h-3" aria-hidden="true" />
            In Kalender
          </button>
        </div>

        {/* Quelle row — read-only */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 w-[66px] shrink-0">
            Quelle
          </span>
          <span className="px-2.5 py-1.5 text-xs text-neutral-400">
            {task.source === "session" ? "via Session" : "manuell"}
          </span>
        </div>

        {/* Completed-at — shown only when done */}
        {isDone && task.completedAt !== null && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 w-[66px] shrink-0" />
            <span className="px-2.5 py-1.5 text-xs font-mono text-neutral-500">
              erledigt {formatCompletedTime(task.completedAt)}
            </span>
          </div>
        )}
      </div>

      {/* ── Scrollable body ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-4 pb-2 min-h-0">
        {/* Note */}
        <div>
          <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 mb-1.5 block">
            Notiz
          </span>
          <textarea
            value={noteValue}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Notiz hinzufügen"
            rows={3}
            className="bg-surface-base shadow-hairline rounded-md px-3 py-2 text-[12.5px] text-neutral-300 leading-relaxed w-full resize-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 placeholder:text-neutral-600"
            aria-label="Notiz"
          />
        </div>

        {/* Subtasks */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500">
              Teilschritte
            </span>
            {task.subtasks.length > 0 && (
              <span className="font-mono text-[10px] text-neutral-500">
                {doneTally}
              </span>
            )}
          </div>

          {task.subtasks.map((sub) => (
            <SubtaskRow
              key={sub.id}
              subtask={sub}
              onToggle={() => handleSubtaskToggle(sub.id)}
            />
          ))}

          <AddSubtaskRow onAdd={handleAddSubtask} />
        </div>
      </div>

      {/* ── Action bar ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-t border-neutral-800 bg-surface-raised flex gap-2 items-center">
        {isOpenOrActive && (
          <>
            <button
              type="button"
              onClick={onComplete}
              className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-accent text-surface-base font-medium hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              <CheckIcon className="w-3 h-3" aria-hidden="true" />
              Erledigt
            </button>
            {confirming ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setConfirming(false); onDelete(); }}
                  className="text-[10.5px] text-error hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Wirklich löschen?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[10.5px] text-neutral-500 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Abbrechen
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 text-[10.5px] text-neutral-500 hover:text-error focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                <TrashIcon className="w-3 h-3" aria-hidden="true" />
                Löschen
              </button>
            )}
          </>
        )}
        {isDone && (
          <>
            <button
              type="button"
              onClick={onReopen}
              className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-surface-raised text-neutral-200 shadow-hairline hover:bg-hover-overlay transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            >
              <ReopenIcon className="w-3 h-3" aria-hidden="true" />
              Wieder öffnen
            </button>
            {confirming ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { setConfirming(false); onDelete(); }}
                  className="text-[10.5px] text-error hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Wirklich löschen?
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="text-[10.5px] text-neutral-500 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                >
                  Abbrechen
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="inline-flex items-center gap-1.5 text-[10.5px] text-neutral-500 hover:text-error focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                <TrashIcon className="w-3 h-3" aria-hidden="true" />
                Löschen
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Accordion mode ─────────────────────────────────────────────────────

function AccordionDetail({
  task,
  availableProjects,
  onUpdate,
  onComplete,
  onReopen,
  onDelete,
  onExportIcs,
}: Omit<TaskDetailProps, "mode">): JSX.Element {
  const TrashIcon = ICONS.action.trash;

  const [noteValue, setNoteValue] = useState(task.note ?? "");

  useEffect(() => {
    setNoteValue(task.note ?? "");
  }, [task.id, task.note]);

  // Reset confirm state when the displayed task changes.
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setConfirming(false);
  }, [task.id]);

  const debouncedNoteUpdate = useDebounced((note: string) => {
    onUpdate({ note });
  }, 400);

  const handleNoteChange = (value: string): void => {
    setNoteValue(value);
    debouncedNoteUpdate(value);
  };

  const handleSubtaskToggle = (subtaskId: string): void => {
    const next = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, done: !s.done } : s,
    );
    onUpdate({ subtasks: next });
  };

  const doneTally = `${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`;

  return (
    <div className="exbody px-2 pb-2.5 pl-4 flex flex-col gap-2">
      {/* Meta: chiprow layout — the calmini inside TaskMetaChips is wired via onExportIcs */}
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={availableProjects}
        onUpdate={onUpdate}
        onComplete={onComplete}
        onReopen={onReopen}
        onExportIcs={onExportIcs}
      />

      {/* Compact note */}
      <textarea
        value={noteValue}
        onChange={(e) => handleNoteChange(e.target.value)}
        placeholder="Notiz hinzufügen"
        rows={2}
        className="bg-surface-base shadow-hairline rounded-md px-3 py-2 text-[12px] text-neutral-300 leading-relaxed w-full resize-none focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 placeholder:text-neutral-600"
        aria-label="Notiz"
      />

      {/* Subtasks summary + rows */}
      {task.subtasks.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500">
              Teilschritte
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              · {doneTally}
            </span>
          </div>
          {task.subtasks.map((sub) => (
            <SubtaskRow
              key={sub.id}
              subtask={sub}
              onToggle={() => handleSubtaskToggle(sub.id)}
            />
          ))}
        </div>
      )}

      {/* Tiny ghost Löschen with inline confirm */}
      {confirming ? (
        <span className="inline-flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setConfirming(false); onDelete(); }}
            className="text-[10.5px] text-error hover:underline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Wirklich löschen?
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="text-[10.5px] text-neutral-500 hover:text-neutral-300 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Abbrechen
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start inline-flex items-center gap-1.5 text-[10.5px] text-neutral-500 hover:text-error focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <TrashIcon className="w-3 h-3" aria-hidden="true" />
          Löschen
        </button>
      )}
    </div>
  );
}

// ── TaskDetail (exported) ─────────────────────────────────────────────

export function TaskDetail({
  task,
  mode,
  availableProjects,
  onUpdate,
  onComplete,
  onReopen,
  onDelete,
  onExportIcs,
  autoFocusTitle,
  onTitleAutoFocused,
}: TaskDetailProps): JSX.Element {
  if (mode === "accordion") {
    return (
      <AccordionDetail
        task={task}
        availableProjects={availableProjects}
        onUpdate={onUpdate}
        onComplete={onComplete}
        onReopen={onReopen}
        onDelete={onDelete}
        onExportIcs={onExportIcs}
      />
    );
  }

  return (
    <PaneDetail
      task={task}
      availableProjects={availableProjects}
      onUpdate={onUpdate}
      onComplete={onComplete}
      onReopen={onReopen}
      onDelete={onDelete}
      onExportIcs={onExportIcs}
      autoFocusTitle={autoFocusTitle}
      onTitleAutoFocused={onTitleAutoFocused}
    />
  );
}
