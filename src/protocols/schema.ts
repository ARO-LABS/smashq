/**
 * ADP (IPC-Error-Protocol) — Fehler-Modell.
 *
 * Envelope, Retry-Policy und Idempotency-Helpers wurden entfernt, nachdem
 * die v2.0-Pipeline-Engine-Roadmap verworfen wurde (commit bd19266) und das
 * tote ADP-Event-Modul (src-tauri/src/adp/) geloescht wurde. Was bleibt: das
 * Fehler-Modell, das live ueber Tauri-Command-Results vom Backend
 * (error.rs `ADPError`/`ADPErrorCode`) zum Frontend (utils/adpError.ts)
 * round-trippt. Diese Union ist die kanonische TS-Spiegelung des Rust-Enums.
 */

export interface ADPError {
  code: ADPErrorCode;
  message: string;
  details?: string;
  retryable: boolean;
  retryAfterMs?: number;
}

export type ADPErrorCode =
  | "PIPELINE_SPAWN_FAILED"
  | "PIPELINE_ALREADY_RUNNING"
  | "PIPELINE_NOT_RUNNING"
  | "WORKTREE_NOT_FOUND"
  | "WORKTREE_STEP_INVALID"
  | "QA_CHECK_TIMEOUT"
  | "TERMINAL_SPAWN_FAILED"
  | "TERMINAL_NOT_FOUND"
  | "SESSION_NOT_FOUND"
  | "SERVICE_AUTH_FAILED"
  | "SERVICE_REQUEST_FAILED"
  | "SERVICE_RATE_LIMITED"
  | "SERVICE_TIMEOUT"
  | "FILE_IO_ERROR"
  | "COMMAND_EXECUTION_FAILED"
  | "PARSE_ERROR"
  | "SCHEMA_VALIDATION_FAILED"
  | "UNKNOWN_EVENT_TYPE"
  | "INTERNAL_ERROR";
