/**
 * TaskDeadlineChip — relative-time pill rendered next to a task's startsAt slot.
 *
 * Severity logic (compared to wall-clock Date.now()):
 * - past (startsAt < now)       → error color  (text-error  bg-error/15)
 * - ≤ tomorrow                  → warning color (text-warning bg-warning/15)
 * - further in the future       → neutral       (text-neutral-400 bg-neutral-800)
 *
 * Why compare to "end of tomorrow" rather than "next 24 h"?
 * Appointments are often set as same-day slots. A task starting tomorrow at midnight
 * should already show as a warning when the user wakes up today, not only
 * when 24 h remain. We compute the boundary as the start of the day after
 * tomorrow (i.e. 48 h from midnight tonight), so any startsAt on today or
 * tomorrow in local time gets the warning style.
 *
 * formatDeadlineRelative(startsAt, compact?) is exported so callers
 * that need only the string (e.g. aria-labels) don't have to render the chip.
 */

import { ICONS } from "../../../utils/icons";
import type { TaskItem } from "../../../store/tasksStore";

// ── Severity ──────────────────────────────────────────────────────────

type Severity = "past" | "soon" | "later";

/**
 * Compute the display severity for a startsAt epoch-ms value against
 * the current wall clock.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function computeDeadlineSeverity(
  startsAt: number,
  now: number = Date.now(),
): Severity {
  if (startsAt < now) return "past";

  // "≤ tomorrow" — any startsAt that falls on today or tomorrow in local time.
  // Build "start of day after tomorrow" as the exclusive boundary.
  const d = new Date();
  d.setHours(0, 0, 0, 0); // midnight tonight (start of today)
  d.setDate(d.getDate() + 2); // start of day after tomorrow
  const endOfTomorrow = d.getTime();

  if (startsAt < endOfTomorrow) return "soon";
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
 * Format a startsAt slot as a human-readable relative string.
 *
 * @param startsAt  epoch-ms
 * @param compact   when true uses the abbreviated form for multi-day values
 *                  (e.g. "5 T." instead of "5 Tage")
 *
 * Returns: "überfällig" | "heute" | "morgen" | "N Tage" | "N T."
 */
// eslint-disable-next-line react-refresh/only-export-components
export function formatDeadlineRelative(
  startsAt: number,
  compact?: boolean,
): string {
  const now = Date.now();

  if (startsAt < now) {
    return "überfällig";
  }

  // Compute calendar-day difference in local time.
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startsAtDate = new Date(startsAt);
  const startsAtDayStart = new Date(startsAtDate);
  startsAtDayStart.setHours(0, 0, 0, 0);

  const diffDays = Math.round(
    (startsAtDayStart.getTime() - todayStart.getTime()) / MS_PER_DAY,
  );

  if (diffDays === 0) return "heute";
  if (diffDays === 1) return "morgen";

  return compact ? `${diffDays} T.` : `${diffDays} Tage`;
}

// ── Component ─────────────────────────────────────────────────────────

export interface TaskDeadlineChipProps {
  task: Pick<TaskItem, "startsAt">;
  compact?: boolean;
}

export function TaskDeadlineChip({ task, compact }: TaskDeadlineChipProps): JSX.Element | null {
  // Kein Termin → kein Chip. computeDeadlineSeverity/formatDeadlineRelative
  // keep their non-null number signatures; this guard is the single gate.
  if (task.startsAt === null) return null;

  const severity = computeDeadlineSeverity(task.startsAt);

  const label = formatDeadlineRelative(task.startsAt, compact);
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
