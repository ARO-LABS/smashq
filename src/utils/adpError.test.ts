import { describe, it, expect } from "vitest";
import {
  isADPError,
  parseInvokeError,
  getErrorMessage,
  classifyGithubError,
  classifyPrerequisiteError,
} from "./adpError";
import type { ADPError } from "../protocols/schema";

describe("isADPError", () => {
  it("returns true for valid ADPError objects", () => {
    const err: ADPError = {
      code: "INTERNAL_ERROR",
      message: "something broke",
      retryable: false,
    };
    expect(isADPError(err)).toBe(true);
  });

  it("returns true for ADPError with optional fields", () => {
    const err: ADPError = {
      code: "SERVICE_RATE_LIMITED",
      message: "slow down",
      retryable: true,
      retryAfterMs: 5000,
      details: "stack trace",
    };
    expect(isADPError(err)).toBe(true);
  });

  it("returns false for plain strings", () => {
    expect(isADPError("some error")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isADPError(null)).toBe(false);
    expect(isADPError(undefined)).toBe(false);
  });

  it("returns false for objects missing required fields", () => {
    expect(isADPError({ code: "X" })).toBe(false);
    expect(isADPError({ code: "X", message: "y" })).toBe(false);
    expect(isADPError({ message: "y", retryable: false })).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isADPError({})).toBe(false);
  });

  it("returns false for arrays and numbers", () => {
    expect(isADPError([])).toBe(false);
    expect(isADPError(123)).toBe(false);
    expect(isADPError(true)).toBe(false);
  });

  it("returns false when code is not a string", () => {
    expect(isADPError({ code: 42, message: "m", retryable: false })).toBe(false);
  });

  it("returns false when message is not a string", () => {
    expect(isADPError({ code: "X", message: 99, retryable: false })).toBe(false);
  });

  it("returns false when retryable is not a boolean", () => {
    expect(isADPError({ code: "X", message: "m", retryable: "yes" })).toBe(false);
  });

  it("returns true even with extra unknown fields", () => {
    expect(
      isADPError({ code: "X", message: "m", retryable: false, extra: 1, more: [] }),
    ).toBe(true);
  });

  it("returns false for a native Error instance (no ADPError shape)", () => {
    expect(isADPError(new Error("boom"))).toBe(false);
  });
});

describe("parseInvokeError", () => {
  it("passes through a valid ADPError", () => {
    const err: ADPError = {
      code: "FILE_IO_ERROR",
      message: "disk full",
      retryable: false,
    };
    expect(parseInvokeError(err)).toBe(err);
  });

  it("wraps a string error into INTERNAL_ERROR", () => {
    const result = parseInvokeError("something went wrong");
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("something went wrong");
    expect(result.retryable).toBe(false);
  });

  it("wraps an Error instance", () => {
    const result = parseInvokeError(new Error("boom"));
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("boom");
  });

  it("handles non-string non-Error values", () => {
    const result = parseInvokeError(42);
    expect(result.message).toBe("42");
  });

  it("wraps null into INTERNAL_ERROR with message 'null'", () => {
    const result = parseInvokeError(null);
    expect(result.code).toBe("INTERNAL_ERROR");
    expect(result.message).toBe("null");
    expect(result.retryable).toBe(false);
  });

  it("wraps undefined into message 'undefined'", () => {
    expect(parseInvokeError(undefined).message).toBe("undefined");
  });

  it("stringifies a plain object via String()", () => {
    expect(parseInvokeError({ a: 1 }).message).toBe("[object Object]");
  });

  it("wraps a boolean value", () => {
    expect(parseInvokeError(false).message).toBe("false");
  });

  it("preserves a subclassed Error's message", () => {
    class CustomError extends Error {}
    const result = parseInvokeError(new CustomError("custom boom"));
    expect(result.message).toBe("custom boom");
    expect(result.code).toBe("INTERNAL_ERROR");
  });

  it("returns the exact same object reference for a valid ADPError", () => {
    const err: ADPError = {
      code: "PARSE_ERROR",
      message: "m",
      retryable: true,
      retryAfterMs: 100,
    };
    const result = parseInvokeError(err);
    expect(result).toBe(err);
    expect(result.retryAfterMs).toBe(100);
  });

  it("wrapped error is always non-retryable", () => {
    expect(parseInvokeError("x").retryable).toBe(false);
    expect(parseInvokeError(new Error("y")).retryable).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("extracts message from ADPError", () => {
    expect(
      getErrorMessage({ code: "PARSE_ERROR", message: "bad json", retryable: false }),
    ).toBe("bad json");
  });

  it("returns string errors directly", () => {
    expect(getErrorMessage("plain error")).toBe("plain error");
  });

  it("extracts message from native Error", () => {
    expect(getErrorMessage(new Error("native error"))).toBe("native error");
  });

  it("returns String() representation for numbers", () => {
    expect(getErrorMessage(7)).toBe("7");
  });

  it("returns 'null' for a null error", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  it("returns the structured message for a retryable ADPError", () => {
    expect(
      getErrorMessage({
        code: "SERVICE_TIMEOUT",
        message: "timed out",
        retryable: true,
      }),
    ).toBe("timed out");
  });
});

describe("classifyGithubError", () => {
  it("flags a missing gh CLI", () => {
    const r = classifyGithubError({
      code: "SERVICE_REQUEST_FAILED",
      message: "gh CLI not found. Install from https://cli.github.com",
      retryable: false,
    });
    expect(r.kind).toBe("gh_missing");
  });

  it("flags a deleted/unfindable board via the not_found details discriminator", () => {
    const r = classifyGithubError({
      code: "SERVICE_REQUEST_FAILED",
      message: "Projekt-Board #4 nicht gefunden",
      details: "not_found",
      retryable: false,
    });
    expect(r.kind).toBe("board_not_found");
  });

  it("flags a missing OAuth scope", () => {
    const r = classifyGithubError({
      code: "SERVICE_AUTH_FAILED",
      message: "required scopes: read:project",
      details: "scope",
      retryable: false,
    });
    expect(r.kind).toBe("scope_missing");
    // The recovery command lives in the structured `command` field (copyable
    // in the UI), not buried in the hint prose.
    expect(r.command).toBe("gh auth refresh -s read:project,project");
  });

  it("flags a not-logged-in state with its recovery command", () => {
    const r = classifyGithubError({
      code: "SERVICE_AUTH_FAILED",
      message: "please run: gh auth login",
      details: "auth",
      retryable: false,
    });
    expect(r.kind).toBe("not_logged_in");
    expect(r.command).toBe("gh auth login");
  });

  it("carries no command for errors without a shell fix (forbidden, unknown)", () => {
    const forbidden = classifyGithubError({
      code: "SERVICE_AUTH_FAILED",
      message: "Resource not accessible",
      details: "forbidden",
      retryable: false,
    });
    expect(forbidden.command).toBeUndefined();
    const unknown = classifyGithubError("boom");
    expect(unknown.command).toBeUndefined();
  });

  it("flags a forbidden (no-access) error distinctly from scope", () => {
    const r = classifyGithubError({
      code: "SERVICE_AUTH_FAILED",
      message: "Resource not accessible",
      details: "forbidden",
      retryable: false,
    });
    expect(r.kind).toBe("forbidden");
    expect(r.kind).not.toBe("scope_missing");
  });

  it("flags a missing gh CLI via the structured gh_missing discriminator", () => {
    const r = classifyGithubError({
      code: "SERVICE_REQUEST_FAILED",
      message: "etwas ganz anderes",
      details: "gh_missing",
      retryable: false,
    });
    expect(r.kind).toBe("gh_missing");
  });

  it("flags rate limiting as retryable", () => {
    const r = classifyGithubError({
      code: "SERVICE_RATE_LIMITED",
      message: "API rate limit exceeded",
      retryable: true,
    });
    expect(r.kind).toBe("rate_limited");
    expect(r.retryable).toBe(true);
  });

  it("flags network/timeout as retryable", () => {
    const r = classifyGithubError({
      code: "SERVICE_TIMEOUT",
      message: "could not resolve host",
      retryable: true,
    });
    expect(r.kind).toBe("network");
    expect(r.retryable).toBe(true);
  });

  it("does NOT misclassify a not_found board as a scope problem (the original bug)", () => {
    // Regression guard: the deleted-board NOT_FOUND message contains 'project'
    // but must never surface as 'GitHub Scope fehlt'.
    const r = classifyGithubError({
      code: "SERVICE_REQUEST_FAILED",
      message: "Could not resolve to a ProjectV2 with the number 4.",
      details: "not_found",
      retryable: false,
    });
    expect(r.kind).toBe("board_not_found");
    expect(r.kind).not.toBe("scope_missing");
  });

  it("falls back to unknown with the raw message for unclassified errors", () => {
    const r = classifyGithubError({
      code: "COMMAND_EXECUTION_FAILED",
      message: "some entirely unexpected failure",
      retryable: false,
    });
    expect(r.kind).toBe("unknown");
    expect(r.hint).toContain("some entirely unexpected failure");
  });

  it("classifies a raw string error (legacy pre-ADPError path) as unknown", () => {
    // Backward-compat: before the Result<T, ADPError> migration, invoke rejected
    // with a plain string. parseInvokeError must still yield a usable info object.
    const r = classifyGithubError("irgendein roher Fehlertext");
    expect(r.kind).toBe("unknown");
    expect(r.hint).toContain("irgendein roher Fehlertext");
  });

  it("still detects gh_missing from a raw legacy string message", () => {
    const r = classifyGithubError("gh CLI not found");
    expect(r.kind).toBe("gh_missing");
  });

  it("does not throw on a null/undefined error and falls back to unknown", () => {
    expect(classifyGithubError(null).kind).toBe("unknown");
    expect(classifyGithubError(undefined).kind).toBe("unknown");
  });

  it("gives every kind a non-empty German title and hint", () => {
    for (const sample of [
      { code: "SERVICE_AUTH_FAILED", message: "x", details: "scope", retryable: false },
      { code: "SERVICE_REQUEST_FAILED", message: "y", details: "not_found", retryable: false },
      { code: "SERVICE_TIMEOUT", message: "z", retryable: true },
    ] as const) {
      const r = classifyGithubError(sample);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyPrerequisiteError", () => {
  it("classifies a claude_missing ADPError with an install hint", () => {
    const info = classifyPrerequisiteError({
      code: "TERMINAL_SPAWN_FAILED",
      message: "Claude CLI wurde nicht auf dem PATH gefunden.",
      details: "claude_missing",
      retryable: false,
    });
    expect(info.kind).toBe("claude_missing");
    expect(info.title).toBe("Claude CLI nicht gefunden");
    expect(info.hint).toContain("npm install -g @anthropic-ai/claude-code");
    expect(info.retryable).toBe(false);
  });

  it("preserves the legacy toast shape for an unknown error", () => {
    // Guards the useSessionCreation integration tests: title must stay
    // "Session-Start fehlgeschlagen" and the hint must echo the raw message.
    const info = classifyPrerequisiteError(new Error("boom: pty spawn failed"));
    expect(info.kind).toBe("unknown");
    expect(info.title).toBe("Session-Start fehlgeschlagen");
    expect(info.hint).toContain("boom: pty spawn failed");
  });

  it("treats a plain string error as unknown", () => {
    const info = classifyPrerequisiteError("shell executable 'pwsh' not found");
    expect(info.kind).toBe("unknown");
    expect(info.hint).toContain("pwsh");
  });
});
