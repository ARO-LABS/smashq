/**
 * ADPError utilities for structured error handling from Tauri commands.
 *
 * After migrating Tauri commands from `Result<T, String>` to `Result<T, ADPError>`,
 * the `.catch` handler receives a JSON object instead of a plain string.
 * These utilities provide type-safe parsing and backward-compatible handling.
 */

import type { ADPError } from "../protocols/schema";
import { isMacOS } from "./platform";

/**
 * Type guard: checks if an unknown error value is a structured ADPError.
 * Works for both the new ADPError objects and any object with matching shape.
 */
export function isADPError(err: unknown): err is ADPError {
  if (err == null || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  return (
    typeof obj.code === "string" &&
    typeof obj.message === "string" &&
    typeof obj.retryable === "boolean"
  );
}

/**
 * Parse an invoke error into a normalized ADPError.
 * Handles both old-style string errors and new structured ADPError objects.
 */
export function parseInvokeError(err: unknown): ADPError {
  // Already a structured error from the new Rust commands
  if (isADPError(err)) return err;

  // Old-style string error (backward compat during migration)
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : String(err);

  return {
    code: "INTERNAL_ERROR",
    message,
    retryable: false,
  };
}

/**
 * Extract a user-friendly message from an invoke error.
 * Prefers the structured message, falls back to string representation.
 */
export function getErrorMessage(err: unknown): string {
  const parsed = parseInvokeError(err);
  return parsed.message;
}

/** Distinct, actionable classes of GitHub-integration failure. */
export type GithubErrorKind =
  | "gh_missing"
  | "not_logged_in"
  | "scope_missing"
  | "forbidden"
  | "board_not_found"
  | "rate_limited"
  | "network"
  | "unknown";

export interface GithubErrorInfo {
  kind: GithubErrorKind;
  /** Short German headline for the error UI. */
  title: string;
  /** German, actionable next step. */
  hint: string;
  /** Whether retrying the same call could succeed. */
  retryable: boolean;
}

/**
 * Classifies a GitHub-integration error into a distinct, actionable kind.
 *
 * Branches on the structured `code` + `details` discriminator the Rust backend
 * now sets (`classify_gh_error`), NOT on substring matching of the message.
 * This replaces the former `message.includes("project")` heuristic that
 * mis-reported a deleted board (NOT_FOUND, whose message contains "project")
 * as a missing OAuth scope — sending users down a useless `gh auth refresh`
 * path. Each kind carries a German title + concrete next step.
 */
export function classifyGithubError(err: unknown): GithubErrorInfo {
  const parsed = parseInvokeError(err);
  const code = parsed.code;
  const details = parsed.details;
  const lowerMsg = parsed.message.toLowerCase();

  // gh binary missing — checked first because it shares SERVICE_REQUEST_FAILED
  // with board-not-found. Prefer the structured `gh_missing` details set by
  // ensure_gh; keep the message fallback for robustness during migration.
  if (
    details === "gh_missing" ||
    lowerMsg.includes("gh cli not found") ||
    lowerMsg.includes("gh not found")
  ) {
    return {
      kind: "gh_missing",
      title: "GitHub CLI nicht gefunden",
      hint: "GitHub CLI von https://cli.github.com installieren und die App neu starten.",
      retryable: false,
    };
  }

  if (code === "SERVICE_REQUEST_FAILED" && details === "not_found") {
    return {
      kind: "board_not_found",
      title: "Board nicht gefunden",
      hint: "Das gespeicherte Board wurde vermutlich gelöscht, umbenannt oder ist nicht mehr zugänglich. Ein anderes Board wählen.",
      retryable: false,
    };
  }

  if (code === "SERVICE_AUTH_FAILED" && details === "scope") {
    return {
      kind: "scope_missing",
      title: "GitHub-Scope fehlt",
      hint: "Dem Token fehlt der nötige Scope. Ausführen: gh auth refresh -s read:project,project",
      retryable: false,
    };
  }

  if (code === "SERVICE_AUTH_FAILED" && details === "auth") {
    return {
      kind: "not_logged_in",
      title: "Nicht bei GitHub angemeldet",
      hint: "Anmelden mit: gh auth login",
      retryable: false,
    };
  }

  if (code === "SERVICE_AUTH_FAILED" && details === "forbidden") {
    return {
      kind: "forbidden",
      title: "Kein Zugriff",
      hint: "Kein Zugriff auf dieses Board. Zugriff anfragen oder ein anderes Konto wählen.",
      retryable: false,
    };
  }

  if (code === "SERVICE_RATE_LIMITED") {
    return {
      kind: "rate_limited",
      title: "GitHub-Rate-Limit erreicht",
      hint: "Zu viele Anfragen. In einer Minute erneut versuchen.",
      retryable: true,
    };
  }

  if (code === "SERVICE_TIMEOUT") {
    return {
      kind: "network",
      title: "Netzwerkfehler",
      hint: "GitHub war nicht erreichbar. Verbindung prüfen und erneut versuchen.",
      retryable: true,
    };
  }

  return {
    kind: "unknown",
    title: "Fehler beim Laden des Boards",
    hint: parsed.message,
    retryable: parsed.retryable,
  };
}

/** Distinct classes of missing-prerequisite failure at session start. */
export type PrerequisiteErrorKind = "claude_missing" | "unknown";

export interface PrerequisiteErrorInfo {
  kind: PrerequisiteErrorKind;
  /** Short German headline for the error toast. */
  title: string;
  /** German, actionable next step (install command). */
  hint: string;
  /** Whether retrying the same call could succeed. */
  retryable: boolean;
}

/**
 * Platform-aware install hint for the Claude CLI. Shared by the session-start
 * error classifier and the System settings panel so the copy never drifts.
 */
export function claudeInstallHint(): string {
  const base = "Installieren mit: npm install -g @anthropic-ai/claude-code";
  return isMacOS() ? `${base}. Auf macOS danach PATH in ~/.zprofile prüfen.` : base;
}

/**
 * Classifies a session-start failure. Branches on the structured `details`
 * discriminator the backend sets (`claude_missing`, mirroring `gh_missing`),
 * NOT on message substrings. The `unknown` branch deliberately reproduces the
 * previous toast shape (title "Session-Start fehlgeschlagen", hint = raw
 * message) so existing behaviour — and its tests — stay intact.
 */
export function classifyPrerequisiteError(err: unknown): PrerequisiteErrorInfo {
  const parsed = parseInvokeError(err);
  if (parsed.details === "claude_missing") {
    return {
      kind: "claude_missing",
      title: "Claude CLI nicht gefunden",
      hint: claudeInstallHint(),
      retryable: false,
    };
  }
  return {
    kind: "unknown",
    title: "Session-Start fehlgeschlagen",
    hint: parsed.message,
    retryable: parsed.retryable,
  };
}
