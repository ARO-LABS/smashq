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
 * Rust NDJSON sink via `append_frontend_logs`. Driven by backendFileLogging,
 * INDEPENDENT of the in-memory master gate above: the file is the post-mortem
 * artifact and must receive frontend entries even when the ring buffer is off.
 *
 * `null` = not wired yet (early startup): entries are buffered so startup
 * errors — the main reason the file exists — are not lost, then flushed or
 * dropped once wireRuntimeGates delivers the real gate.
 */
let persistenceGate: LoggingGate | null = null;
export function wirePersistenceGate(gate: LoggingGate): void {
  persistenceGate = gate;
  if (gate()) {
    // Flush immediately (not via the 2s timer): pre-wiring startup errors
    // should reach the disk artifact promptly.
    if (pending.length > 0) void flushFrontendLogs();
  } else {
    // User has file logging off — the buffered pre-wiring entries stay
    // in-memory only (ring buffer), never on disk.
    pending = [];
  }
}

/** Test-only: revert to the unwired state with an empty buffer. */
export function resetPersistenceGateForTest(): void {
  persistenceGate = null;
  pending = [];
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
  // Master gate — gates the ring buffer + console mirror ONLY. Persistence
  // below is independent (backendFileLogging), so the NDJSON post-mortem file
  // receives frontend entries even when the in-memory view is disabled.
  // Toasts via globalErrorHandler are independent and remain visible.
  if (isLoggingEnabled()) {
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

  // Persist to the NDJSON sink when the disk-logging toggle is on — or buffer
  // while the gate is not wired yet (early startup). Batched by count
  // (threshold) and time (interval) to avoid an IPC call per log line.
  if (persistenceGate === null || persistenceGate()) {
    pending.push({
      ts: entry.timestamp,
      level: entry.severity,
      source: "frontend",
      module: entry.source,
      message: entry.message,
      stack: entry.stack,
    });
    if (pending.length > MAX_PENDING_ENTRIES) {
      pending = pending.slice(pending.length - MAX_PENDING_ENTRIES);
    }
    // Only actively flush once the gate is wired ON; pre-wiring entries wait
    // for wirePersistenceGate to decide (flush or drop).
    if (persistenceGate?.()) {
      if (pending.length >= FLUSH_THRESHOLD) void flushFrontendLogs();
      else scheduleFlush();
    }
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
    // JSON.stringify(undefined | Function | Symbol) returns the VALUE
    // undefined (not a string, no throw) — fall through to String() then,
    // otherwise the logger crashes exactly when it is needed (e.g.
    // Promise.reject() without a reason).
    return { message: JSON.stringify(error) ?? String(error) };
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
