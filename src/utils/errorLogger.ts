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

import { useLogViewerStore } from "../store/logViewerStore";
import type { LogSeverity } from "../store/logViewerStore";

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
