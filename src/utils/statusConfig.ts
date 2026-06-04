/**
 * Centralized status configuration — single source of truth.
 *
 * All status-to-color/icon mappings live here.
 * Components import from this file instead of defining their own maps.
 */

/* ── Color tokens (Tailwind classes) ── */
export const STATUS_STYLES = {
  idle:     { text: "text-neutral-500",  border: "border-neutral-700", bg: "bg-neutral-500",   dot: "bg-neutral-500", pillBg: "bg-neutral-500/15" },
  active:   { text: "text-accent",       border: "border-accent",      bg: "bg-accent",        dot: "bg-accent",      pillBg: "bg-accent/15" },
  running:  { text: "text-accent",       border: "border-accent",      bg: "bg-accent",        dot: "bg-accent",      pillBg: "bg-accent/15" },
  done:     { text: "text-success",      border: "border-success",     bg: "bg-success",       dot: "bg-success",     pillBg: "bg-success/15" },
  pass:     { text: "text-success",      border: "border-success",     bg: "bg-success",       dot: "bg-success",     pillBg: "bg-success/15" },
  error:    { text: "text-error",        border: "border-error",       bg: "bg-error",         dot: "bg-error",       pillBg: "bg-error/15" },
  fail:     { text: "text-error",        border: "border-error",       bg: "bg-error",         dot: "bg-error",       pillBg: "bg-error/15" },
  blocked:  { text: "text-warning",      border: "border-warning",     bg: "bg-warning",       dot: "bg-warning",     pillBg: "bg-warning/15" },
  waiting:  { text: "text-warning",      border: "border-warning",     bg: "bg-warning",       dot: "bg-warning",     pillBg: "bg-warning/15" },
  pending:  { text: "text-neutral-500",  border: "border-neutral-700", bg: "bg-neutral-500",   dot: "bg-neutral-500", pillBg: "bg-neutral-500/15" },
  skipped:  { text: "text-neutral-400",  border: "border-neutral-600", bg: "bg-neutral-400",   dot: "bg-neutral-400", pillBg: "bg-neutral-400/15" },
  planning: { text: "text-accent",       border: "border-accent",      bg: "bg-accent",        dot: "bg-accent",      pillBg: "bg-accent/15" },
  generated_manifest: { text: "text-success", border: "border-success", bg: "bg-success",      dot: "bg-success",     pillBg: "bg-success/15" },
  waiting_for_input:  { text: "text-warning", border: "border-warning", bg: "bg-warning",      dot: "bg-warning",     pillBg: "bg-warning/15" },
} as const;

export type StatusKey = keyof typeof STATUS_STYLES;

/** Style bundle (text/border/bg/dot/pillBg classes) for a single status. */
export type StatusStyle = (typeof STATUS_STYLES)[StatusKey];

/** Get styles for any status string, with fallback to idle */
export function getStatusStyle(status: string): StatusStyle {
  return STATUS_STYLES[status as StatusKey] ?? STATUS_STYLES.idle;
}

/** Statuses that should pulse their indicator dot */
export const PULSE_STATUSES = new Set<string>(["active", "running", "planning"]);
