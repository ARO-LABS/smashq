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
import type { LogSeverity, StructuredEntry, UnifiedLogEntry } from "../store/logViewerStore";

export type { LogSeverity };

// Per-call check (not a module-level const): the Tauri globals may appear
// after this module is evaluated (test setup, SSR-like early imports).
function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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
// Serialization handle. flushFrontendLogs is async; the threshold path, the
// timer, and the close/unmount paths can all trigger it concurrently. Callers
// AWAIT the in-flight drain and then drain what accumulated since — an
// early-return here (the previous `flushing` flag) let the close-requested
// flush resolve while a batch was still in the air; Tauri destroys the window
// the moment the close handler resolves, so the rescheduled timer never fired
// and those entries were lost.
let inFlight: Promise<void> | null = null;

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
  // while, not if: after awaiting, another caller may have started a new
  // drain in the microtask gap. Sends stay strictly serialized.
  while (inFlight) {
    await inFlight;
  }
  if (pending.length === 0) return;
  const work = (async () => {
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
  })();
  inFlight = work;
  try {
    await work;
  } finally {
    inFlight = null;
  }
}

/**
 * Drain pending entries, THEN run the gate sync. Used by settingsStore when
 * backendFileLogging turns OFF — flipping the Rust gate first would reject
 * the final batch (entries logged while the toggle was still on).
 */
export async function flushBeforeGateClose(syncGate: () => Promise<void>): Promise<void> {
  await flushFrontendLogs();
  await syncGate();
}

// ---------------------------------------------------------------------------
// Cross-window log sync. Each Tauri webview holds its OWN logViewerStore
// instance — without an explicit channel, the detached Protokolle window
// never sees main-window frontend entries (the NDJSON file only exists when
// backendFileLogging is on, and `log-line` events cover backend logs only).
// Mirrors the preferencesBroadcast pattern: payloads carry `sourceWindow`,
// receivers filter their own echo.
// ---------------------------------------------------------------------------

const LOG_ENTRY_EVENT = "frontend-log-entry";
const SNAPSHOT_REQUEST_EVENT = "log-snapshot-request";
const SNAPSHOT_RESPONSE_EVENT = "log-snapshot-response";

let cachedWindowLabel: string | null = null;
async function getWindowLabel(): Promise<string> {
  if (cachedWindowLabel !== null) return cachedWindowLabel;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  cachedWindowLabel = getCurrentWindow().label;
  return cachedWindowLabel;
}

export interface LogEntryBroadcast {
  entry: StructuredEntry;
  sourceWindow: string;
}

export interface LogSnapshotResponse {
  entries: Omit<UnifiedLogEntry, "id">[];
  sourceWindow: string;
}

/**
 * Fire-and-forget: mirror a ring-buffer entry to every other window. Errors
 * are swallowed — a failed broadcast must not break the local log call.
 */
async function broadcastLogEntry(entry: StructuredEntry): Promise<void> {
  if (!isTauriEnv()) return;
  try {
    const [{ emit }, sourceWindow] = await Promise.all([
      import("@tauri-apps/api/event"),
      getWindowLabel(),
    ]);
    await emit(LOG_ENTRY_EVENT, { entry, sourceWindow } satisfies LogEntryBroadcast);
  } catch {
    // best-effort
  }
}

/**
 * Answer snapshot requests from a freshly mounted LogViewer in another window
 * with this window's in-memory entries (mount-time history). Wired per window
 * by wireRuntimeGates; the LogViewer merges + dedupes all responses.
 */
export async function listenForLogSnapshotRequests(): Promise<() => void> {
  if (!isTauriEnv()) return () => {};
  const [{ listen, emit }, myLabel] = await Promise.all([
    import("@tauri-apps/api/event"),
    getWindowLabel(),
  ]);
  return listen<{ sourceWindow: string }>(SNAPSHOT_REQUEST_EVENT, (event) => {
    if (!event.payload || event.payload.sourceWindow === myLabel) return;
    const entries = useLogViewerStore.getState().entries;
    if (entries.length === 0) return;
    void emit(SNAPSHOT_RESPONSE_EVENT, {
      entries: entries.map(({ id: _id, ...rest }) => rest),
      sourceWindow: myLabel,
    } satisfies LogSnapshotResponse).catch(() => {
      // best-effort — the requesting window still has file + live channels
    });
  });
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

    // Mirror to other windows (Protokolle-Fenster hat eigene Store-Instanz).
    void broadcastLogEntry({
      ts: entry.timestamp,
      level: entry.severity,
      source: "frontend",
      module: entry.source,
      message: entry.message,
      stack: entry.stack,
    });

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
