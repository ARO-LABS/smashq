/**
 * TaskGridTile — anchored popover for a session grid cell.
 *
 * Renders a compact task list for the session's project key, anchored to the
 * top-right corner of the (relative) cell. The popover is absolute-positioned
 * so the cell wrapper must be `position: relative` (it already is in GridCell).
 *
 * Anatomy:
 *   popover [absolute top-10 right-2 z-20 w-[238px] bg-surface-raised shadow-lift]
 *     header  — "AUFGABEN" uppercase + mono "N offen"
 *     list    — up to ~5 rows: StatusDot8 + truncated title + compact deadline chip
 *               next task row: bg-accent-a05 border-l-2 border-accent
 *     footer  — "In großer Ansicht öffnen" + ICONS.tasks.next
 *     empty   — "Keine offenen Aufgaben"
 *
 * Close behaviour: click-outside + Escape.
 *
 * Why a dedicated folder prop instead of reading from sessionStore?
 * The cell already has the resolved folder string at mount time; passing it as
 * a prop avoids an extra store subscription and makes the component easier to
 * test in isolation.
 */

import { useEffect, useRef } from "react";
import { useTasksStore, selectOpenTasksForProject, selectNextTask } from "../../../store/tasksStore";
import { normalizeProjectKey } from "../../../store/settingsStore";
import { StatusDot } from "../../shared/tasks/StatusDot";
import { TaskDeadlineChip } from "../../shared/tasks/TaskDeadlineChip";
import { ICONS } from "../../../utils/icons";

// ── Props ──────────────────────────────────────────────────────────────

export interface TaskGridTileProps {
  sessionId: string;
  folder?: string;
  open: boolean;
  onClose: () => void;
  onOpenLarge: () => void;
}

// ── Component ──────────────────────────────────────────────────────────

export function TaskGridTile({
  sessionId: _sessionId,
  folder,
  open,
  onClose,
  onOpenLarge,
}: TaskGridTileProps): JSX.Element | null {
  const projectKey = folder ? normalizeProjectKey(folder) : null;

  const openTasks = useTasksStore(selectOpenTasksForProject(projectKey));
  const nextTask = useTasksStore(selectNextTask(projectKey));

  // ── Click-outside + Escape close ─────────────────────────────────────
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: PointerEvent): void {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const openCount = openTasks.length;
  // Cap display to ~5 rows; overflow handled by scrollable container
  const DISPLAY_CAP = 5;
  const NextIcon = ICONS.tasks.next;

  return (
    <div
      ref={popoverRef}
      data-testid="task-grid-tile"
      className="absolute top-10 right-2 z-20 w-[238px] bg-surface-raised rounded-md shadow-lift overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-neutral-800">
        <span className="text-[10px] tracking-wide uppercase text-neutral-400">
          Aufgaben
        </span>
        <span className="font-mono text-[10px] text-neutral-400">
          {openCount} offen
        </span>
      </div>

      {/* Task list or empty state */}
      {openCount === 0 ? (
        <div className="px-2.5 py-3 text-[10.5px] text-neutral-500">
          Keine offenen Aufgaben
        </div>
      ) : (
        <div
          className="p-1.5 flex flex-col gap-px overflow-y-auto"
          style={{ maxHeight: `${DISPLAY_CAP * 36}px` }}
        >
          {openTasks.map((task) => {
            const isNext = nextTask?.id === task.id;
            return (
              <div
                key={task.id}
                className={[
                  "flex items-center gap-2 px-1.5 py-1.5 rounded-sm",
                  isNext
                    ? "bg-accent-a05 border-l-2 border-accent pl-[5px]"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <StatusDot status={task.status} size={8} />
                <span className="text-[11px] text-neutral-200 truncate flex-1">
                  {task.title}
                </span>
                <TaskDeadlineChip task={task} compact />
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-2.5 py-1.5 border-t border-neutral-800">
        <button
          type="button"
          onClick={onOpenLarge}
          className={[
            "inline-flex items-center gap-1.5",
            "text-[10px] text-neutral-500 hover:text-accent",
            "transition-colors",
            "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
          ].join(" ")}
        >
          In großer Ansicht öffnen
          <NextIcon className="w-3 h-3" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
