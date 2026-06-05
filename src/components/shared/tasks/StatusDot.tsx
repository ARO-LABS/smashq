/**
 * StatusDot — visual indicator for a TaskItem's status.
 *
 * Renders one of three states:
 * - open   → hollow ring (border only, transparent fill)
 * - active → solid accent dot with ambient pulse (reuses animate-pulse from SessionCard)
 * - done   → solid success-green dot
 *
 * Why the size offset for "open"?
 * The spec calls for size+1 on the hollow ring so its visual weight matches
 * the filled dots at the same nominal size. A 1.5px border on an 8px circle
 * appears lighter than an 8px filled circle, so the ring is rendered 1px
 * larger (size+1) to balance perceived weight.
 */

import type { TaskStatus } from "../../../store/tasksStore";

export interface StatusDotProps {
  status: TaskStatus;
  /** Diameter in px for filled dots. Open ring renders at size+1. Default: 8. */
  size?: number;
}

export function StatusDot({ status, size = 8 }: StatusDotProps): JSX.Element {
  if (status === "open") {
    // Hollow ring: 1px larger than filled variants to match visual weight.
    const ringSize = size + 1;
    return (
      <span
        aria-label="offen"
        role="img"
        className="shrink-0 rounded-full border-[1.5px] border-neutral-500"
        style={{ width: ringSize, height: ringSize, display: "inline-block" }}
      />
    );
  }

  if (status === "active") {
    return (
      <span
        aria-label="in Arbeit"
        role="img"
        className="shrink-0 rounded-full bg-accent status-pulse-animation"
        style={{ width: size, height: size, display: "inline-block" }}
      />
    );
  }

  // done
  return (
    <span
      aria-label="erledigt"
      role="img"
      className="shrink-0 rounded-full bg-success"
      style={{ width: size, height: size, display: "inline-block" }}
    />
  );
}
