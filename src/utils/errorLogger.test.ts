import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import {
  logError,
  logWarn,
  logInfo,
  logDebug,
  logTrace,
  wireLoggingGate,
  wirePersistenceGate,
  flushFrontendLogs,
} from "./errorLogger";
import { useLogViewerStore } from "../store/logViewerStore";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset shared log store between tests (no longer a separate ring buffer
  // in errorLogger — it pushes directly into logViewerStore now).
  useLogViewerStore.setState({
    entries: [],
    severityFilter: new Set(["error", "warn", "info"]),
    sourceFilter: new Set(["frontend", "backend"]),
    searchText: "",
    liveTail: true,
  });
  // Open the gate so prior tests' wireLoggingGate-off doesn't bleed in.
  wireLoggingGate(() => true);
  vi.restoreAllMocks();
});

afterEach(() => {
  // Reset gate to default for the rest of the suite.
  wireLoggingGate(() => true);
});

// ---------------------------------------------------------------------------
// logError — pushes into logViewerStore with source: "frontend"
// ---------------------------------------------------------------------------

describe("logError", () => {
  it("pushes an error entry into logViewerStore", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("test-source", new Error("boom"));

    const entries = useLogViewerStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].severity).toBe("error");
    expect(entries[0].source).toBe("frontend");
    expect(entries[0].module).toBe("test-source");
    expect(entries[0].message).toBe("boom");
  });

  it("calls console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", "fail");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("captures the stack from Error objects", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("mod", new Error("something broke"));

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.message).toBe("something broke");
    expect(entry.stack).toBeDefined();
    expect(entry.stack).toContain("something broke");
  });

  it("extracts a string error verbatim", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("mod", "plain string error");

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.message).toBe("plain string error");
    expect(entry.stack).toBeUndefined();
  });

  it("JSON-stringifies plain object errors", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("mod", { code: 42, detail: "oops" });

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.message).toBe(JSON.stringify({ code: 42, detail: "oops" }));
  });

  it("falls back to String() for non-stringifiable values", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logError("mod", circular);

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.message).toBe("[object Object]");
  });

  // JSON.stringify(undefined | Function | Symbol) returns the VALUE undefined
  // (no throw), so the catch-based String() fallback never fired — the logger
  // crashed in the store's noise check exactly when it was needed (e.g.
  // Promise.reject() without a reason via globalErrorHandler).
  it("logError(undefined) produces a string message instead of crashing", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logError("test", undefined)).not.toThrow();

    const entries = useLogViewerStore.getState().entries;
    expect(entries[entries.length - 1].message).toBe("undefined");
  });

  it("logError with a function value coerces to string", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logError("test", () => {})).not.toThrow();

    const entries = useLogViewerStore.getState().entries;
    expect(typeof entries[entries.length - 1].message).toBe("string");
  });

  it("logError(Symbol()) coerces to string", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => logError("test", Symbol("boom"))).not.toThrow();

    const entries = useLogViewerStore.getState().entries;
    expect(entries[entries.length - 1].message).toBe("Symbol(boom)");
  });
});

// ---------------------------------------------------------------------------
// logWarn / logInfo
// ---------------------------------------------------------------------------

describe("logWarn / logInfo", () => {
  it("logWarn pushes a warn entry and calls console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("src", "warning msg");

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.severity).toBe("warn");
    expect(entry.message).toBe("warning msg");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("logInfo pushes an info entry and calls console.info", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("src", "info msg");

    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.severity).toBe("info");
    expect(entry.message).toBe("info msg");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("logWarn entry has no stack and source frontend", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("warn-mod", "w");
    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.stack).toBeUndefined();
    expect(entry.source).toBe("frontend");
    expect(entry.module).toBe("warn-mod");
  });

  it("logInfo entry carries the module name and no stack", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("info-mod", "i");
    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.module).toBe("info-mod");
    expect(entry.stack).toBeUndefined();
  });

  it("logWarn does not call console.error or console.info", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("src", "w");
    expect(errSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logInfo does not call console.error or console.warn", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    logInfo("src", "i");
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// timestamp + ordering
// ---------------------------------------------------------------------------

describe("entry timestamps and ordering", () => {
  it("writes a valid ISO-8601 timestamp on each entry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", "x");
    const entry = useLogViewerStore.getState().entries[0];
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it("accumulates multiple entries across log calls", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    logError("a", "e1");
    logWarn("b", "w1");
    logInfo("c", "i1");
    const entries = useLogViewerStore.getState().entries;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.message)).toEqual(["e1", "w1", "i1"]);
  });

  it("each logError call produces exactly one entry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", "first");
    logError("src", "second");
    expect(useLogViewerStore.getState().entries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// logError — extractMessage branch coverage
// ---------------------------------------------------------------------------

describe("logError — message extraction branches", () => {
  it("mirrors the stack as a second console.error argument", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("with stack");
    logError("src", err);
    expect(spy.mock.calls[0][1]).toBe(err.stack);
  });

  it("passes an empty string as second arg when there is no stack", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", "no stack here");
    expect(spy.mock.calls[0][1]).toBe("");
  });

  it("stringifies a number error value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", 404);
    expect(useLogViewerStore.getState().entries[0].message).toBe("404");
  });

  it("stringifies a boolean error value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", true);
    expect(useLogViewerStore.getState().entries[0].message).toBe("true");
  });

  it("stringifies an array error value as JSON", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", [1, 2, 3]);
    expect(useLogViewerStore.getState().entries[0].message).toBe("[1,2,3]");
  });

  it("represents null as JSON 'null'", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError("src", null);
    expect(useLogViewerStore.getState().entries[0].message).toBe("null");
  });

  it("preserves a subclassed Error message and stack", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    class CustomError extends Error {}
    logError("src", new CustomError("custom"));
    const entry = useLogViewerStore.getState().entries[0];
    expect(entry.message).toBe("custom");
    expect(entry.stack).toContain("custom");
  });

  it("formats the console line with timestamp, severity, source, message", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("my-source", "the message");
    const line = spy.mock.calls[0][0] as string;
    expect(line).toContain("[ERROR]");
    expect(line).toContain("[my-source]");
    expect(line).toContain("the message");
  });

  it("uppercases the severity in the warn console line", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logWarn("s", "m");
    expect(spy.mock.calls[0][0] as string).toContain("[WARN]");
  });
});

// ---------------------------------------------------------------------------
// wireLoggingGate — runtime master switch
// ---------------------------------------------------------------------------

describe("wireLoggingGate", () => {
  it("logViewerStore stays empty when the gate returns false", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    wireLoggingGate(() => false);

    logError("src", new Error("dropped"));
    logWarn("src", "also dropped");
    logInfo("src", "and this");

    expect(useLogViewerStore.getState().entries).toHaveLength(0);
  });

  it("console mirror is also silenced while the gate is closed", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    wireLoggingGate(() => false);

    logError("src", "muted");

    expect(errSpy).not.toHaveBeenCalled();
  });

  it("entries flow again once the gate reopens", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    let enabled = false;
    wireLoggingGate(() => enabled);

    logInfo("src", "first");
    expect(useLogViewerStore.getState().entries).toHaveLength(0);

    enabled = true;
    logInfo("src", "second");
    const entries = useLogViewerStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toBe("second");
  });

  it("re-evaluates the gate on every call (dynamic predicate)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let open = true;
    wireLoggingGate(() => open);

    logWarn("src", "a");
    open = false;
    logWarn("src", "b");
    open = true;
    logWarn("src", "c");

    const messages = useLogViewerStore.getState().entries.map((e) => e.message);
    expect(messages).toEqual(["a", "c"]);
  });

  it("drops all three severities while the gate is closed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    wireLoggingGate(() => false);

    logError("s", new Error("e"));
    logWarn("s", "w");
    logInfo("s", "i");

    expect(useLogViewerStore.getState().entries).toHaveLength(0);
  });

  it("silences the console.warn and console.info mirrors while gate is closed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    wireLoggingGate(() => false);

    logWarn("s", "w");
    logInfo("s", "i");

    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("a later wireLoggingGate call replaces the previous gate", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    wireLoggingGate(() => false);
    wireLoggingGate(() => true);
    logInfo("src", "passes");
    expect(useLogViewerStore.getState().entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// logDebug / logTrace
// ---------------------------------------------------------------------------

describe("logDebug/logTrace", () => {
  beforeEach(() => {
    useLogViewerStore.getState().clearEntries();
    wireLoggingGate(() => true);
  });
  it("logDebug pushes a debug entry", () => {
    logDebug("test.source", "a debug message");
    const e = useLogViewerStore.getState().entries.at(-1);
    expect(e?.severity).toBe("debug");
    expect(e?.message).toBe("a debug message");
  });
  it("logTrace pushes a trace entry", () => {
    logTrace("test.source", "a trace message");
    expect(useLogViewerStore.getState().entries.at(-1)?.severity).toBe("trace");
    expect(useLogViewerStore.getState().entries.at(-1)?.message).toBe("a trace message");
  });
});

// ---------------------------------------------------------------------------
// frontend log persistence flush (Task 7)
// ---------------------------------------------------------------------------

describe("frontend log persistence flush", () => {
  beforeEach(() => {
    clearMocks();
    wireLoggingGate(() => true);
  });
  afterEach(() => {
    // Reset persistence gate so it does not leak into other suites.
    wirePersistenceGate(() => false);
    clearMocks();
  });
  it("batches entries and flushes via append_frontend_logs when persistence is on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const received: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === "append_frontend_logs") received.push((args as { entries: unknown[] }).entries);
      return undefined;
    });
    wirePersistenceGate(() => true);
    logError("test", new Error("boom"));
    await flushFrontendLogs();
    expect(received.length).toBe(1);
    expect((received[0] as unknown[]).length).toBe(1);
  });
  it("does NOT flush when persistence gate is off (skips work)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let called = false;
    mockIPC((cmd) => { if (cmd === "append_frontend_logs") called = true; return undefined; });
    wirePersistenceGate(() => false);
    logError("test", new Error("boom"));
    await flushFrontendLogs();
    expect(called).toBe(false);
  });

  it("re-queues entries when the invoke fails so the next flush retries them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    let attempt = 0;
    const seen: number[] = [];
    mockIPC((cmd, args) => {
      if (cmd !== "append_frontend_logs") return undefined;
      attempt++;
      if (attempt === 1) throw new Error("sink down"); // first flush fails
      seen.push((args as { entries: unknown[] }).entries.length);
      return undefined;
    });
    wirePersistenceGate(() => true);
    logError("test", new Error("boom"));
    await flushFrontendLogs(); // fails -> re-queues
    await flushFrontendLogs(); // retry -> succeeds, entry not lost
    expect(attempt).toBe(2);
    expect(seen).toEqual([1]);
  });

  it("caps the re-queue so a permanently-down sink cannot grow unbounded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    let lastBatchLen = 0;
    mockIPC((cmd, args) => {
      if (cmd !== "append_frontend_logs") return undefined;
      lastBatchLen = (args as { entries: unknown[] }).entries.length;
      throw new Error("sink stays down"); // every flush fails
    });
    wirePersistenceGate(() => true);
    // Push well past the 1000-entry bound; FLUSH_THRESHOLD (25) auto-flushes,
    // each flush fails and re-queues, exercising the slice() cap.
    for (let i = 0; i < 1100; i++) logError("test", new Error(`e${i}`));
    await flushFrontendLogs();
    expect(lastBatchLen).toBeLessThanOrEqual(1000);
  });
});
