import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  logError,
  logWarn,
  logInfo,
  logDebug,
  logTrace,
  wireLoggingGate,
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
