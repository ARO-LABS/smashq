/**
 * TaskRow — a single task rendered in a list (comfortable or compact density).
 *
 * Anatomy (comfortable):
 *   button[border-l-2] ← selected: bg-accent-a05 + border-accent
 *                       ← overdue & not done & not selected: border-error
 *     header [flex gap-2 items-start]
 *       StatusDot [mt-1 shrink-0]
 *       title [flex-1] ← done: neutral-500; compact done adds line-through
 *       isNext marker [shrink-0 mt-0.5]  ← ICONS.tasks.next + "nächste"
 *     footer [pl-[17px] flex items-center justify-between] (comfortable only)
 *       source label:
 *         active → "in Arbeit" text-accent
 *         session → pill bg-accent-a15 text-accent
 *         manual  → plain text-neutral-600 "manuell"
 *       TaskDeadlineChip
 *
 * Compact variant: omits the footer; done title gains line-through.
 *
 * Why border-l-2 rather than a left-ring?
 * A 2px left border is the design-system's canonical selection indicator
 * (see TasksWindow accordion spec). It reads at a glance without stealing
 * horizontal space from the title.
 */

import { ICONS } from "../../../utils/icons";
import type { TaskItem } from "../../../store/tasksStore";
import { StatusDot } from "./StatusDot";
import { TaskDeadlineChip } from "./TaskDeadlineChip";

// ── Props ──────────────────────────────────────────────────────────────

export interface TaskRowProps {
  task: TaskItem;
  selected?: boolean;
  isNext?: boolean;
  showSource?: boolean;
  density?: "comfortable" | "compact";
  onSelect: (id: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Returns true when the task is overdue: has a deadline in the past,
 * is not done, and is not currently selected (selected uses accent border).
 */
function isOverdue(task: TaskItem, selected: boolean): boolean {
  return (
    task.deadline !== null &&
    task.deadline < Date.now() &&
    task.status !== "done" &&
    !selected
  );
}

// ── Source label ───────────────────────────────────────────────────────

function SourceLabel({ task }: { task: TaskItem }): JSX.Element | null {
  // Active state overrides source display
  if (task.status === "active") {
    return (
      <span className="text-[9.5px] text-accent leading-none">in Arbeit</span>
    );
  }

  if (task.source === "session") {
    return (
      <span className="text-[9.5px] px-1.5 py-px rounded-full bg-accent-a15 text-accent leading-none whitespace-nowrap">
        via Session
      </span>
    );
  }

  // manual
  return (
    <span className="text-[10px] text-neutral-600 leading-none">manuell</span>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export function TaskRow({
  task,
  selected = false,
  isNext = false,
  showSource = true,
  density = "comfortable",
  onSelect,
}: TaskRowProps): JSX.Element {
  const overdue = isOverdue(task, selected);
  const isDone = task.status === "done";
  const compact = density === "compact";

  // Left-border state: selected > overdue > transparent
  const borderClass = selected
    ? "border-accent"
    : overdue
      ? "border-error"
      : "border-transparent";

  // Title color + strikethrough
  const titleClass = isDone
    ? compact
      ? "text-neutral-500 line-through"
      : "text-neutral-500"
    : "text-neutral-200";

  const NextIcon = ICONS.tasks.next;

  return (
    <button
      type="button"
      className={[
        "w-full flex flex-col gap-1.5 px-2.5 py-2",
        "rounded-md border-l-2 text-left",
        "transition-colors hover:bg-hover-overlay",
        "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
        selected ? "bg-accent-a05" : "",
        borderClass,
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(task.id)}
      aria-pressed={selected}
    >
      {/* Header row */}
      <div className="flex gap-2 items-start">
        <StatusDot status={task.status} size={8} aria-hidden />

        <span
          className={[
            "flex-1 text-[12.5px] leading-snug",
            titleClass,
          ].join(" ")}
        >
          {task.title}
        </span>

        {isNext && (
          <span className="inline-flex items-center gap-1 text-[9px] text-accent shrink-0 mt-0.5">
            <NextIcon className="w-2.5 h-2.5" aria-hidden="true" />
            nächste
          </span>
        )}
      </div>

      {/* Footer row — comfortable only */}
      {!compact && (
        <div className="flex items-center justify-between gap-1.5 pl-[17px]">
          {showSource && <SourceLabel task={task} />}
          {/* When showSource is false, render nothing on the left so the chip
              aligns to the right via justify-between. An empty span keeps the
              flex layout intact. */}
          {!showSource && <span />}
          <TaskDeadlineChip task={task} compact={false} />
        </div>
      )}
    </button>
  );
}
