import { create } from "zustand";

export type LogSeverity = "trace" | "debug" | "info" | "warn" | "error";
export type LogSource = "frontend" | "backend";

export interface UnifiedLogEntry {
  id: number;
  timestamp: string;
  severity: LogSeverity;
  source: LogSource;
  module?: string;
  message: string;
  stack?: string;
}

/** A log entry with a group count for consecutive identical entries */
export interface GroupedLogEntry extends UnifiedLogEntry {
  /** Number of consecutive identical entries (same message + source + severity) */
  count: number;
}

const MAX_ENTRIES = 1000;
let entryCounter = 0;

/**
 * Noise patterns that should be downgraded from error/warn to debug.
 * Each pattern is tested against the log message (case-insensitive).
 */
const NOISE_PATTERNS: readonly string[] = [
  "update endpoint did not respond",
  "updater endpoint did not respond",
  "exited with unexpected code: -1073741510", // Windows Ctrl+C (0xC000013A)
  "exited with unexpected code: -1073741509", // Windows Ctrl+Break (0xC000013B)
];

interface LogViewerState {
  entries: UnifiedLogEntry[];
  severityFilter: Set<LogSeverity>;
  sourceFilter: Set<LogSource>;
  searchText: string;
  liveTail: boolean;

  addEntries: (entries: Omit<UnifiedLogEntry, "id">[]) => void;
  clearEntries: () => void;
  setSeverityFilter: (filter: Set<LogSeverity>) => void;
  setSourceFilter: (filter: Set<LogSource>) => void;
  setSearchText: (text: string) => void;
  toggleLiveTail: () => void;
}

export const useLogViewerStore = create<LogViewerState>((set) => ({
  entries: [],
  // Default view hides debug/trace (captured but off by default to keep the
  // live view readable); the user can toggle them on via the filter buttons.
  severityFilter: new Set<LogSeverity>(["error", "warn", "info"]),
  sourceFilter: new Set<LogSource>(["frontend", "backend"]),
  searchText: "",
  liveTail: true,

  addEntries: (newEntries) =>
    set((state) => {
      // Dedup against entries already in the store. loadBackendLogs re-reads
      // the same on-disk log file on every mount and on manual refresh —
      // without this, each refresh would append up to 500 duplicate backend
      // lines and evict genuine entries via the MAX_ENTRIES cap.
      // Key intentionally omits severity/module/stack: an identical
      // timestamp+source+message is treated as the same line (the grouping UI
      // surfaces repeat counts, so collapsing same-ms duplicates is desired).
      const keyOf = (e: {
        timestamp: string;
        source: LogSource;
        message: string;
      }) => `${e.timestamp} ${e.source} ${e.message}`;
      const seen = new Set(state.entries.map(keyOf));
      const fresh = newEntries.filter((e) => !seen.has(keyOf(e)));
      if (fresh.length === 0) return state;

      const processed = fresh.map((e) => {
        // Tauri event payloads are a trust boundary — a malformed entry with
        // a non-string message must not crash the store (the noise check
        // below calls toLowerCase).
        const message = typeof e.message === "string" ? e.message : String(e.message);
        // Downgrade noisy log messages to debug severity
        const isNoise = NOISE_PATTERNS.some((p) =>
          message.toLowerCase().includes(p),
        );
        return {
          ...e,
          message,
          severity: isNoise ? ("debug" as LogSeverity) : e.severity,
          id: ++entryCounter,
        };
      });
      const merged = [...state.entries, ...processed];
      // Skip sort when a single entry appends chronologically (live-tail).
      // Sort for batches or when timestamps are out of order.
      const needsSort =
        processed.length > 1 ||
        (state.entries.length > 0 &&
          processed.length === 1 &&
          processed[0].timestamp <
            state.entries[state.entries.length - 1].timestamp);
      if (needsSort) {
        merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      }
      return { entries: merged.slice(-MAX_ENTRIES) };
    }),

  clearEntries: () => set({ entries: [] }),

  setSeverityFilter: (filter) => set({ severityFilter: filter }),
  setSourceFilter: (filter) => set({ sourceFilter: filter }),
  setSearchText: (text) => set({ searchText: text }),
  toggleLiveTail: () => set((state) => ({ liveTail: !state.liveTail })),
}));

/**
 * Group consecutive entries with the same message, source, and severity.
 * Reduces e.g. 33 identical errors to 1 entry with count=33.
 */
export function groupConsecutiveEntries(
  entries: UnifiedLogEntry[],
): GroupedLogEntry[] {
  if (entries.length === 0) return [];

  const result: GroupedLogEntry[] = [];
  let current: GroupedLogEntry = { ...entries[0], count: 1 };

  for (let i = 1; i < entries.length; i++) {
    const e = entries[i];
    if (
      e.message === current.message &&
      e.source === current.source &&
      e.severity === current.severity
    ) {
      current.count++;
    } else {
      result.push(current);
      current = { ...e, count: 1 };
    }
  }
  result.push(current);
  return result;
}

/** Shape returned by the Rust `read_structured_log` command / `log-line` event. */
export interface StructuredEntry {
  ts: string;
  level: string;
  source: string;
  module?: string;
  message: string;
  stack?: string;
}

const SEVERITIES: readonly LogSeverity[] = ["trace", "debug", "info", "warn", "error"];

/** Map a structured (NDJSON) entry to a store entry, defensively. */
export function structuredToUnified(e: StructuredEntry): Omit<UnifiedLogEntry, "id"> {
  const severity = (SEVERITIES as readonly string[]).includes(e.level)
    ? (e.level as LogSeverity)
    : "info";
  const source: LogSource = e.source === "backend" ? "backend" : "frontend";
  return { timestamp: e.ts, severity, source, module: e.module, message: e.message, stack: e.stack };
}

/** Format an ISO timestamp as local HH:MM:SS (no milliseconds). */
export function formatTime(timestamp: string): string {
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return timestamp.slice(11, 19);
    return d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp.slice(11, 19);
  }
}
