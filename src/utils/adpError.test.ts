import { describe, it, expect } from "vitest";
import {
  isADPError,
  parseInvokeError,
  getErrorMessage,
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
