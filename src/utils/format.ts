/**
 * Canonical number-formatters for UI rendering.
 *
 * Rules (from CLAUDE.md design-system → "Number-Formatting"):
 *  - Durations   → `ms`   format, with space, lowercase unit (e.g. `312 ms`)
 *  - Elapsed     → `mm:ss`                                   (e.g. `2:14`)
 *
 * Use these helpers at every rendering site — do NOT build ad-hoc inline
 * formatters. Verbatim durations coming from Claude-CLI output (like
 * `"2m 38s"` parsed from a tool-line) are out of scope and stay as-is.
 */

/** Format a millisecond duration for UI. Example: `formatMs(312) → "312 ms"`. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "– ms";
  const rounded = Math.max(0, Math.round(ms));
  return `${rounded} ms`;
}

/**
 * Format an elapsed duration as `mm:ss` (or `h:mm:ss` once it crosses 1h).
 *
 * Accepts milliseconds (not seconds) for symmetry with `Date.now()` deltas
 * and our Tauri payloads. Examples:
 *   formatElapsed(0)            → "0:00"
 *   formatElapsed(65_000)       → "1:05"
 *   formatElapsed(134_000)      → "2:14"
 *   formatElapsed(3_600_000)    → "1:00:00"
 *   formatElapsed(10_800_000)   → "3:00:00"
 *
 * Multi-hour Claude sessions and long-running pipeline runs are real, so
 * `mm:ss` overflows like `180:00` are not acceptable in history/metrics
 * views. Live status bars naturally stay below 1h and are unaffected.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = seconds.toString().padStart(2, "0");
  if (hours > 0) {
    const mm = minutes.toString().padStart(2, "0");
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
