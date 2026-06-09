/**
 * Error Logging Service
 *
 * Captures errors with timestamp, severity, source, message, and stack.
 * Pushes directly into the unified `logViewerStore` (the single source of
 * truth for all log surfaces). Console output is preserved as a debugging
 * aid in DevTools.
 *
 * Why no second buffer here: a previous version maintained a 100-entry
 * ring buffer plus a single-subscriber callback as a separate pipeline.
 * It diverged from logViewerStore's 1000-entry FIFO and led to dual-store
 * coupling bugs. One store, one truth, one gate.
 */

import { invoke } from "@tauri-apps/api/core";
import { useLogViewerStore } from "../store/logViewerStore";
import type { LogSeverity, StructuredEntry } from "../store/logViewerStore";

export type { LogSeverity };

export interface LogEntry {
  timestamp: string;
  severity: LogSeverity;
  source: string;
  message: string;
  stack?: string;
}

/**
 * Runtime gate. Defaults to ON so early-startup errors (before the gate is
 * wired) are not silently dropped. The settingsStore replaces this at app
 * boot via wireLoggingGate(). Injection-pattern avoids a circular import
 * with settingsStore (which depends on logError for its own error paths).
 */
type LoggingGate = () => boolean;
let isLoggingEnabled: LoggingGate = () => true;

export function wireLoggingGate(gate: LoggingGate): void {
  isLoggingEnabled = gate;
}

/**
 * Persistence gate — when ON, frontend entries are batched and flushed to the
 * Rust NDJSON sink via `append_frontend_logs`. Follows the same master disk
 * toggle (backendFileLogging) so both log sources persist to one file.
 * Independent of the in-memory logging gate above.
 */
let isPersistenceEnabled: LoggingGate = () => false;
export function wirePersistenceGate(gate: LoggingGate): void {
  isPersistenceEnabled = gate;
}

const FLUSH_INTERVAL_MS = 2000;
const FLUSH_THRESHOLD = 25;
// Upper bound on the re-queue buffer. If the Rust sink stays down, we keep the
// newest MAX_PENDING_ENTRIES and drop the oldest overflow so a permanently
// failing flush cannot grow `pending` without limit.
const MAX_PENDING_ENTRIES = 1000;
let pending: StructuredEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Re-entrancy guard. flushFrontendLogs is async; the threshold path, the timer,
// and the close/unmount paths can all trigger it concurrently. Without this,
// two in-flight flushes that both fail would re-queue out of chronological
// order. Only one flush drains at a time; concurrent callers reschedule.
let flushing = false;

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushFrontendLogs();
  }, FLUSH_INTERVAL_MS);
}

/** Flush buffered frontend entries to the NDJSON sink. Best-effort. */
export async function flushFrontendLogs(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushing) {
    // A flush is already draining; let it finish and reschedule so entries
    // buffered since are picked up next tick. Keeps sends strictly serialized.
    scheduleFlush();
    return;
  }
  if (pending.length === 0) return;
  flushing = true;
  try {
    const batch = pending;
    pending = [];
    try {
      await invoke("append_frontend_logs", { entries: batch });
    } catch (e) {
      // IPC failed — the batch was already detached from `pending`. Re-queue it
      // ahead of anything buffered since (preserving chronological order) and
      // reschedule a retry, so a transient sink failure does not silently drop
      // log entries. Bound the result to avoid unbounded growth if the sink
      // stays down — keep the newest entries, drop the oldest overflow.
      pending = batch.concat(pending);
      if (pending.length > MAX_PENDING_ENTRIES) {
        pending = pending.slice(pending.length - MAX_PENDING_ENTRIES);
      }
      scheduleFlush();
      console.debug("[errorLogger] frontend log flush failed, re-queued", e); // eslint-disable-line no-console
    }
  } finally {
    flushing = false;
  }
}

function formatEntry(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.severity.toUpperCase()}] [${entry.source}] ${entry.message}`;
}

function addEntry(entry: LogEntry): void {
  // Master gate — when disabled, drop everything (no buffer, no console
  // mirror). Toasts via globalErrorHandler are independent and remain
  // visible even with the gate closed.
  if (!isLoggingEnabled()) return;

  // Push into the unified log store — one source of truth.
  useLogViewerStore.getState().addEntries([
    {
      timestamp: entry.timestamp,
      severity: entry.severity,
      source: "frontend",
      module: entry.source,
      message: entry.message,
      stack: entry.stack,
    },
  ]);

  // Persist to the NDJSON sink when the disk-logging toggle is on. Batched by
  // count (threshold) and time (interval) to avoid an IPC call per log line.
  if (isPersistenceEnabled()) {
    pending.push({
      ts: entry.timestamp,
      level: entry.severity,
      source: "frontend",
      module: entry.source,
      message: entry.message,
      stack: entry.stack,
    });
    if (pending.length >= FLUSH_THRESHOLD) void flushFrontendLogs();
    else scheduleFlush();
  }

  // Mirror to console (intentional — DevTools is the dev's debugging surface).
  const formatted = formatEntry(entry);
  switch (entry.severity) {
    case "error":
      console.error(formatted, entry.stack ?? ""); // eslint-disable-line no-console
      break;
    case "warn":
      console.warn(formatted); // eslint-disable-line no-console
      break;
    case "info":
      console.info(formatted); // eslint-disable-line no-console
      break;
    case "debug":
    case "trace":
      console.debug(formatted); // eslint-disable-line no-console
      break;
  }
}

function extractMessage(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function logError(source: string, error: unknown): void {
  const { message, stack } = extractMessage(error);
  addEntry({
    timestamp: new Date().toISOString(),
    severity: "error",
    source,
    message,
    stack,
  });
}

export function logWarn(source: string, message: string): void {
  addEntry({
    timestamp: new Date().toISOString(),
    severity: "warn",
    source,
    message,
  });
}

export function logInfo(source: string, message: string): void {
  addEntry({
    timestamp: new Date().toISOString(),
    severity: "info",
    source,
    message,
  });
}

export function logDebug(source: string, message: string): void {
  addEntry({
    timestamp: new Date().toISOString(),
    severity: "debug",
    source,
    message,
  });
}

export function logTrace(source: string, message: string): void {
  addEntry({
    timestamp: new Date().toISOString(),
    severity: "trace",
    source,
    message,
  });
}
