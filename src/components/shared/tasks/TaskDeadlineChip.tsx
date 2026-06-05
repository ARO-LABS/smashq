/**
 * TaskDeadlineChip — relative-time pill rendered next to a task's deadline.
 *
 * Severity logic (compared to wall-clock Date.now()):
 * - past (deadline < now)       → error color  (text-error  bg-error/15)
 * - ≤ tomorrow                  → warning color (text-warning bg-warning/15)
 * - further in the future       → neutral       (text-neutral-400 bg-neutral-800)
 * - null deadline               → renders nothing
 *
 * Why compare to "end of tomorrow" rather than "next 24 h"?
 * Deadlines are often set as all-day dates. A task due tomorrow at midnight
 * should already show as a warning when the user wakes up today, not only
 * when 24 h remain. We compute the boundary as the start of the day after
 * tomorrow (i.e. 48 h from midnight tonight), so any deadline on today or
 * tomorrow in local time gets the warning style.
 *
 * formatDeadlineRelative(deadline, hasTime, compact?) is exported so callers
 * that need only the string (e.g. aria-labels) don't have to render the chip.
 */

import { ICONS } from "../../../utils/icons";
import type { TaskItem } from "../../../store/tasksStore";

// ── Severity ──────────────────────────────────────────────────────────

type Severity = "past" | "soon" | "later";

/**
 * Compute the display severity for a deadline epoch-ms value against
 * the current wall clock. Returns null when deadline is null.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeDeadlineSeverity(
  deadline: number | null,
  now: number = Date.now(),
): Severity | null {
  if (deadline === null) return null;

  if (deadline < now) return "past";

  // "≤ tomorrow" — any deadline that falls on today or tomorrow in local time.
  // Build "start of day after tomorrow" as the exclusive boundary.
  const d = new Date();
  d.setHours(0, 0, 0, 0); // midnight tonight (start of today)
  d.setDate(d.getDate() + 2); // start of day after tomorrow
  const endOfTomorrow = d.getTime();

  if (deadline < endOfTomorrow) return "soon";
  return "later";
}

const SEVERITY_CLASSES: Record<Severity, string> = {
  past: "text-error bg-error/15",
  soon: "text-warning bg-warning/15",
  later: "text-neutral-400 bg-neutral-800",
};

// ── Label formatting ──────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Format a deadline as a human-readable relative string.
 *
 * @param deadline  epoch-ms; must not be null (guard at call site)
 * @param hasTime   when true the deadline is timed, so "überfällig" omits
 *                  a day count because we already know it's past
 * @param compact   when true uses the abbreviated form for multi-day values
 *                  (e.g. "5 T." instead of "5 Tage")
 *
 * Returns: "überfällig" | "heute" | "morgen" | "N Tage" | "N T."
 */
// eslint-disable-next-line react-refresh/only-export-components
export function formatDeadlineRelative(
  deadline: number,
  hasTime: boolean,
  compact?: boolean,
): string {
  const now = Date.now();

  if (deadline < now) {
    return "überfällig";
  }

  // Compute calendar-day difference in local time.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const deadlineDate = new Date(deadline);
  const deadlineDayStart = new Date(deadlineDate);
  deadlineDayStart.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (deadlineDayStart.getTime() - todayStart.getTime()) / MS_PER_DAY,
  );

  if (diffDays === 0) return "heute";
  if (diffDays === 1) return "morgen";

  // hasTime is unused for the label when diffDays > 1 (we always show the day
  // count), but we accept it for API consistency and future timed-format needs.
  void hasTime;

  return compact ? `${diffDays} T.` : `${diffDays} Tage`;
}

// ── Component ─────────────────────────────────────────────────────────

export interface TaskDeadlineChipProps {
  task: Pick<TaskItem, "deadline" | "deadlineHasTime">;
  compact?: boolean;
}

export function TaskDeadlineChip({ task, compact }: TaskDeadlineChipProps): JSX.Element | null {
  const severity = computeDeadlineSeverity(task.deadline);
  if (severity === null || task.deadline === null) return null;

  const label = formatDeadlineRelative(task.deadline, task.deadlineHasTime, compact);
  const ClockIcon = ICONS.tasks.clock;

  return (
    <span
      className={[
        "inline-flex items-center gap-1",
        "font-mono text-[10px]",
        "px-1.5 py-px rounded-full whitespace-nowrap",
        SEVERITY_CLASSES[severity],
      ].join(" ")}
    >
      <ClockIcon className="w-2.5 h-2.5" aria-hidden="true" />
      {label}
    </span>
  );
}
