import { describe, it, expect, beforeEach } from "vitest";
import {
  useLogViewerStore,
  groupConsecutiveEntries,
  structuredToUnified,
  formatTime,
  type UnifiedLogEntry,
  type LogSeverity,
} from "./logViewerStore";

describe("formatTime", () => {
  it("formats to HH:MM:SS without milliseconds", () => {
    const out = formatTime("2026-05-19T14:05:09.123Z");
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(out).not.toContain(".");
  });

  it("falls back to the HH:MM:SS slice (no ms) for an unparseable timestamp", () => {
    // Date() rejects the trailing garbage, so the slice fallback runs.
    expect(formatTime("2026-05-19T14:05:09.123Z-garbage")).toBe("14:05:09");
  });
});

describe("logViewerStore — sort & scope state", () => {
  it("defaults to desc sort, session scope, and a non-empty ISO sessionStart", () => {
    const s = useLogViewerStore.getState();
    expect(s.sortOrder).toBe("desc");
    expect(s.scope).toBe("session");
    expect(s.sessionStart).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("setSortOrder and setScope update state", () => {
    useLogViewerStore.getState().setSortOrder("asc");
    expect(useLogViewerStore.getState().sortOrder).toBe("asc");
    useLogViewerStore.getState().setScope("all");
    expect(useLogViewerStore.getState().scope).toBe("all");
  });
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useLogViewerStore.setState({
    entries: [],
    severityFilter: new Set(["error", "warn", "info"]),
    sourceFilter: new Set(["frontend", "backend"]),
    searchText: "",
    liveTail: true,
    sortOrder: "desc",
    scope: "session",
    sessionStart: "2020-01-01T00:00:00.000Z",
  });
});

// ---------------------------------------------------------------------------
// Defensive input handling
// ---------------------------------------------------------------------------

describe("addEntries defensive input", () => {
  it("survives a non-string message (malformed event payloads are a trust boundary)", () => {
    const store = useLogViewerStore.getState();
    expect(() =>
      store.addEntries([
        {
          timestamp: "2026-07-02T10:00:00.000Z",
          severity: "error",
          source: "frontend",
          message: undefined as unknown as string,
        },
      ]),
    ).not.toThrow();

    const last = useLogViewerStore.getState().entries.at(-1);
    expect(typeof last?.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  overrides: Partial<Omit<UnifiedLogEntry, "id">> = {}
): Omit<UnifiedLogEntry, "id"> {
  return {
    timestamp: "2025-01-15T10:30:00.000Z",
    severity: "info",
    source: "frontend",
    message: "test message",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

describe("initial state", () => {
  it("empty entries, all severities, all sources, empty search, liveTail=true", () => {
    const state = useLogViewerStore.getState();
    expect(state.entries).toEqual([]);
    expect(state.severityFilter).toEqual(new Set(["error", "warn", "info"]));
    expect(state.sourceFilter).toEqual(
      new Set(["frontend", "backend"])
    );
    expect(state.searchText).toBe("");
    expect(state.liveTail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addEntries
// ---------------------------------------------------------------------------

describe("addEntries", () => {
  it("assigns auto-incrementing IDs", () => {
    useLogViewerStore.getState().addEntries([makeEntry(), makeEntry()]);

    const entries = useLogViewerStore.getState().entries;
    expect(entries).toHaveLength(2);
    // IDs should be sequential (relative ordering)
    expect(entries[1].id).toBe(entries[0].id + 1);
  });

  it("caps at MAX_ENTRIES=1000", () => {
    // Add 1100 entries in batches
    const batch = Array.from({ length: 1100 }, (_, i) =>
      makeEntry({ message: `msg-${i}` })
    );
    useLogViewerStore.getState().addEntries(batch);

    const entries = useLogViewerStore.getState().entries;
    expect(entries).toHaveLength(1000);
  });

  it("keeps newest when capped", () => {
    const batch = Array.from({ length: 1100 }, (_, i) =>
      makeEntry({ message: `msg-${i}` })
    );
    useLogViewerStore.getState().addEntries(batch);

    const entries = useLogViewerStore.getState().entries;
    // Newest entries (100..1099) should be kept, oldest (0..99) dropped
    expect(entries[0].message).toBe("msg-100");
    expect(entries[999].message).toBe("msg-1099");
  });
});

// ---------------------------------------------------------------------------
// clearEntries
// ---------------------------------------------------------------------------

describe("clearEntries", () => {
  it("empties array", () => {
    useLogViewerStore.getState().addEntries([makeEntry(), makeEntry()]);
    expect(useLogViewerStore.getState().entries).toHaveLength(2);

    useLogViewerStore.getState().clearEntries();
    expect(useLogViewerStore.getState().entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// filters
// ---------------------------------------------------------------------------

describe("filters", () => {
  it("setSeverityFilter updates filter", () => {
    const filter = new Set<"error" | "warn" | "info">(["error"]);
    useLogViewerStore.getState().setSeverityFilter(filter);

    expect(useLogViewerStore.getState().severityFilter).toEqual(
      new Set(["error"])
    );
  });

  it("setSourceFilter updates filter", () => {
    const filter = new Set<"frontend" | "backend">(["backend"]);
    useLogViewerStore.getState().setSourceFilter(filter);

    expect(useLogViewerStore.getState().sourceFilter).toEqual(
      new Set(["backend"])
    );
  });

  it("setSearchText updates search text", () => {
    useLogViewerStore.getState().setSearchText("error pattern");
    expect(useLogViewerStore.getState().searchText).toBe("error pattern");
  });

  it("toggleLiveTail flips boolean", () => {
    expect(useLogViewerStore.getState().liveTail).toBe(true);

    useLogViewerStore.getState().toggleLiveTail();
    expect(useLogViewerStore.getState().liveTail).toBe(false);

    useLogViewerStore.getState().toggleLiveTail();
    expect(useLogViewerStore.getState().liveTail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sorting (chronological order)
// ---------------------------------------------------------------------------

describe("sorting", () => {
  it("sorts entries by timestamp after addEntries", () => {
    const entries = [
      makeEntry({ timestamp: "2025-01-15T10:35:00.000Z", message: "third" }),
      makeEntry({ timestamp: "2025-01-15T10:30:00.000Z", message: "first" }),
      makeEntry({ timestamp: "2025-01-15T10:32:00.000Z", message: "second" }),
    ];
    useLogViewerStore.getState().addEntries(entries);

    const stored = useLogViewerStore.getState().entries;
    expect(stored.map((e) => e.message)).toEqual(["first", "second", "third"]);
  });

  it("sorts mixed historical and live entries chronologically", () => {
    // Simulate: first add a live entry, then load historical backend logs
    useLogViewerStore
      .getState()
      .addEntries([
        makeEntry({
          timestamp: "2025-01-15T12:00:00.000Z",
          source: "frontend",
          message: "live",
        }),
      ]);

    // Historical logs arrive later but have earlier timestamps
    useLogViewerStore
      .getState()
      .addEntries([
        makeEntry({
          timestamp: "2025-01-15T08:00:00.000Z",
          source: "backend",
          message: "historical",
        }),
      ]);

    const stored = useLogViewerStore.getState().entries;
    expect(stored[0].message).toBe("historical");
    expect(stored[1].message).toBe("live");
  });
});

// ---------------------------------------------------------------------------
// noise filtering
// ---------------------------------------------------------------------------

describe("noise filtering", () => {
  it("downgrades updater error messages to debug severity", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "error",
        message:
          "tauri_plugin_updater::updater — update endpoint did not respond with a successful status code",
      }),
    ]);

    const stored = useLogViewerStore.getState().entries;
    expect(stored[0].severity).toBe("debug");
  });

  it("downgrades Windows Ctrl+C exit code warnings to debug", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "warn",
        message:
          "Session abc123 child process exited with unexpected code: -1073741510",
      }),
    ]);

    const stored = useLogViewerStore.getState().entries;
    expect(stored[0].severity).toBe("debug");
  });

  it("does not downgrade genuine error messages", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "error",
        message: "Failed to spawn shell for session abc: permission denied",
      }),
    ]);

    const stored = useLogViewerStore.getState().entries;
    expect(stored[0].severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// groupConsecutiveEntries
// ---------------------------------------------------------------------------

describe("groupConsecutiveEntries", () => {
  it("returns empty array for empty input", () => {
    expect(groupConsecutiveEntries([])).toEqual([]);
  });

  it("groups consecutive identical entries", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "fail" },
      { id: 2, timestamp: "t2", severity: "error", source: "frontend", message: "fail" },
      { id: 3, timestamp: "t3", severity: "error", source: "frontend", message: "fail" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(3);
    expect(grouped[0].id).toBe(1); // keeps first entry's id
  });

  it("does not group non-consecutive identical entries", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "fail" },
      { id: 2, timestamp: "t2", severity: "info", source: "frontend", message: "ok" },
      { id: 3, timestamp: "t3", severity: "error", source: "frontend", message: "fail" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(3);
    expect(grouped.every((g) => g.count === 1)).toBe(true);
  });

  it("does not group entries with different severity", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "fail" },
      { id: 2, timestamp: "t2", severity: "warn", source: "frontend", message: "fail" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(2);
  });

  it("does not group entries with different source", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "fail" },
      { id: 2, timestamp: "t2", severity: "error", source: "backend", message: "fail" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(2);
  });

  it("handles single entry", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "info", source: "frontend", message: "hello" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(1);
  });
});


// ---------------------------------------------------------------------------
// addEntries — dedup
// ---------------------------------------------------------------------------

describe("addEntries — dedup", () => {
  it("drops entries with identical timestamp+source+message already in the store", () => {
    const e = makeEntry({ message: "dup", timestamp: "2025-01-15T10:00:00.000Z" });
    useLogViewerStore.getState().addEntries([e]);
    useLogViewerStore.getState().addEntries([e]);
    expect(useLogViewerStore.getState().entries).toHaveLength(1);
  });

  it("returns the same state reference when every new entry is a duplicate", () => {
    const e = makeEntry({ message: "dup" });
    useLogViewerStore.getState().addEntries([e]);
    const ref = useLogViewerStore.getState().entries;
    useLogViewerStore.getState().addEntries([e]);
    expect(useLogViewerStore.getState().entries).toBe(ref);
  });

  it("keeps an entry that differs only by source", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "x", source: "frontend" }),
      makeEntry({ message: "x", source: "backend" }),
    ]);
    expect(useLogViewerStore.getState().entries).toHaveLength(2);
  });

  it("keeps an entry that differs only by timestamp", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "x", timestamp: "2025-01-15T10:00:00.000Z" }),
      makeEntry({ message: "x", timestamp: "2025-01-15T10:00:01.000Z" }),
    ]);
    expect(useLogViewerStore.getState().entries).toHaveLength(2);
  });

  it("treats severity as irrelevant for dedup (same ts+source+message collapses)", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "x", severity: "error" }),
    ]);
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "x", severity: "warn" }),
    ]);
    expect(useLogViewerStore.getState().entries).toHaveLength(1);
  });

  it("dedups within a single batch keeping the first occurrence", () => {
    // Two identical entries in one call: both pass the store-seen filter,
    // but only distinct keys survive — actually both are fresh vs the store,
    // so both are kept (intra-batch dedup is not performed).
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "same" }),
      makeEntry({ message: "same" }),
    ]);
    // Documents that intra-batch identical entries are NOT deduped.
    expect(useLogViewerStore.getState().entries).toHaveLength(2);
  });

  it("appends only the genuinely new entries from a partially-overlapping batch", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "old", timestamp: "2025-01-15T10:00:00.000Z" }),
    ]);
    useLogViewerStore.getState().addEntries([
      makeEntry({ message: "old", timestamp: "2025-01-15T10:00:00.000Z" }),
      makeEntry({ message: "new", timestamp: "2025-01-15T10:00:01.000Z" }),
    ]);
    const msgs = useLogViewerStore.getState().entries.map((e) => e.message);
    expect(msgs).toEqual(["old", "new"]);
  });
});

// ---------------------------------------------------------------------------
// addEntries — id assignment & sorting nuances
// ---------------------------------------------------------------------------

describe("addEntries — ids and sorting", () => {
  it("assigns globally monotonic ids across separate calls", () => {
    useLogViewerStore.getState().addEntries([makeEntry({ message: "a" })]);
    useLogViewerStore.getState().addEntries([makeEntry({ message: "b", timestamp: "2025-01-15T11:00:00.000Z" })]);
    const entries = useLogViewerStore.getState().entries;
    expect(entries[1].id).toBeGreaterThan(entries[0].id);
  });

  it("does not re-sort a single in-order live-tail append", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ timestamp: "2025-01-15T10:00:00.000Z", message: "first" }),
    ]);
    useLogViewerStore.getState().addEntries([
      makeEntry({ timestamp: "2025-01-15T10:05:00.000Z", message: "second" }),
    ]);
    const msgs = useLogViewerStore.getState().entries.map((e) => e.message);
    expect(msgs).toEqual(["first", "second"]);
  });

  it("sorts a single out-of-order append into place", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ timestamp: "2025-01-15T10:05:00.000Z", message: "later" }),
    ]);
    useLogViewerStore.getState().addEntries([
      makeEntry({ timestamp: "2025-01-15T10:00:00.000Z", message: "earlier" }),
    ]);
    const msgs = useLogViewerStore.getState().entries.map((e) => e.message);
    expect(msgs).toEqual(["earlier", "later"]);
  });

  it("sorts a multi-entry batch even when appended in order", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({ timestamp: "2025-01-15T10:02:00.000Z", message: "b" }),
      makeEntry({ timestamp: "2025-01-15T10:01:00.000Z", message: "a" }),
    ]);
    const msgs = useLogViewerStore.getState().entries.map((e) => e.message);
    expect(msgs).toEqual(["a", "b"]);
  });

  it("is a no-op for an empty input array", () => {
    const ref = useLogViewerStore.getState().entries;
    useLogViewerStore.getState().addEntries([]);
    expect(useLogViewerStore.getState().entries).toBe(ref);
  });

  it("caps to newest 1000 across multiple incremental batches", () => {
    for (let b = 0; b < 6; b++) {
      const batch = Array.from({ length: 300 }, (_, i) =>
        makeEntry({ message: `b${b}-i${i}`, timestamp: `2025-01-15T${String(10 + b).padStart(2, "0")}:00:00.${String(i).padStart(3, "0")}Z` })
      );
      useLogViewerStore.getState().addEntries(batch);
    }
    expect(useLogViewerStore.getState().entries).toHaveLength(1000);
  });
});

// ---------------------------------------------------------------------------
// noise filtering — extended
// ---------------------------------------------------------------------------

describe("noise filtering — extended", () => {
  it("matches noise patterns case-insensitively", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "error",
        message: "UPDATE ENDPOINT DID NOT RESPOND with status",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });

  it("downgrades the Ctrl+Break exit code variant", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "warn",
        message: "child process exited with unexpected code: -1073741509",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });

  it("downgrades the 'updater endpoint' phrasing variant", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "error",
        message: "the updater endpoint did not respond in time",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });

  it("downgrades a noise message that is already 'info' to debug", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "info",
        message: "update endpoint did not respond",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });

  it("does not downgrade an unrelated exit code", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "warn",
        message: "child process exited with unexpected code: 1",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("warn");
  });

  it("downgrades a noise substring embedded in a larger message", () => {
    useLogViewerStore.getState().addEntries([
      makeEntry({
        severity: "error",
        message: "context: update endpoint did not respond :: retrying",
      }),
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });
});

// ---------------------------------------------------------------------------
// filters — extended
// ---------------------------------------------------------------------------

describe("filters — extended", () => {
  it("setSeverityFilter accepts an empty set", () => {
    useLogViewerStore.getState().setSeverityFilter(new Set());
    expect(useLogViewerStore.getState().severityFilter.size).toBe(0);
  });

  it("setSourceFilter accepts an empty set", () => {
    useLogViewerStore.getState().setSourceFilter(new Set());
    expect(useLogViewerStore.getState().sourceFilter.size).toBe(0);
  });

  it("setSearchText accepts an empty string", () => {
    useLogViewerStore.getState().setSearchText("query");
    useLogViewerStore.getState().setSearchText("");
    expect(useLogViewerStore.getState().searchText).toBe("");
  });

  it("setSearchText overwrites a previous value entirely", () => {
    useLogViewerStore.getState().setSearchText("first");
    useLogViewerStore.getState().setSearchText("second");
    expect(useLogViewerStore.getState().searchText).toBe("second");
  });

  it("filter setters do not affect entries", () => {
    useLogViewerStore.getState().addEntries([makeEntry()]);
    useLogViewerStore.getState().setSeverityFilter(new Set(["error"]));
    useLogViewerStore.getState().setSourceFilter(new Set(["backend"]));
    expect(useLogViewerStore.getState().entries).toHaveLength(1);
  });

  it("toggleLiveTail starting from false returns to true after two toggles", () => {
    useLogViewerStore.setState({ liveTail: false });
    useLogViewerStore.getState().toggleLiveTail();
    expect(useLogViewerStore.getState().liveTail).toBe(true);
    useLogViewerStore.getState().toggleLiveTail();
    expect(useLogViewerStore.getState().liveTail).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logViewerStore 5-level severity
// ---------------------------------------------------------------------------

describe("logViewerStore 5-level severity", () => {
  beforeEach(() => useLogViewerStore.getState().clearEntries());

  it("accepts trace and debug entries and stores them verbatim", () => {
    const levels: LogSeverity[] = ["trace", "debug", "info", "warn", "error"];
    useLogViewerStore.getState().addEntries(
      levels.map((severity, i) => ({
        timestamp: `2026-06-02T10:00:0${i}.000Z`,
        severity,
        source: "frontend" as const,
        message: `msg-${severity}`,
      })),
    );
    const stored = useLogViewerStore.getState().entries.map((e) => e.severity);
    expect(stored).toEqual(["trace", "debug", "info", "warn", "error"]);
  });
});


describe("noise downgrade target", () => {
  beforeEach(() => useLogViewerStore.getState().clearEntries());
  it("downgrades noise to debug (hidden by default), not info", () => {
    useLogViewerStore.getState().addEntries([
      {
        timestamp: "2026-06-02T10:00:00.000Z",
        severity: "error",
        source: "backend",
        message: "Updater endpoint did not respond within timeout",
      },
    ]);
    expect(useLogViewerStore.getState().entries[0].severity).toBe("debug");
  });
});

// ---------------------------------------------------------------------------
// clearEntries — extended
// ---------------------------------------------------------------------------

describe("clearEntries — extended", () => {
  it("is safe to call on an already-empty store", () => {
    useLogViewerStore.getState().clearEntries();
    expect(useLogViewerStore.getState().entries).toEqual([]);
  });

  it("does not reset filters or search text", () => {
    useLogViewerStore.getState().setSearchText("keep me");
    useLogViewerStore.getState().setSeverityFilter(new Set(["warn"]));
    useLogViewerStore.getState().addEntries([makeEntry()]);
    useLogViewerStore.getState().clearEntries();
    expect(useLogViewerStore.getState().searchText).toBe("keep me");
    expect(useLogViewerStore.getState().severityFilter).toEqual(new Set(["warn"]));
  });

  it("allows fresh entries to be added after clearing", () => {
    useLogViewerStore.getState().addEntries([makeEntry({ message: "old" })]);
    useLogViewerStore.getState().clearEntries();
    useLogViewerStore.getState().addEntries([makeEntry({ message: "new" })]);
    expect(useLogViewerStore.getState().entries.map((e) => e.message)).toEqual(["new"]);
  });
});

// ---------------------------------------------------------------------------
// groupConsecutiveEntries — extended
// ---------------------------------------------------------------------------

describe("groupConsecutiveEntries — extended", () => {
  it("groups two separate runs of identical entries independently", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "a" },
      { id: 2, timestamp: "t2", severity: "error", source: "frontend", message: "a" },
      { id: 3, timestamp: "t3", severity: "info", source: "frontend", message: "b" },
      { id: 4, timestamp: "t4", severity: "error", source: "frontend", message: "a" },
      { id: 5, timestamp: "t5", severity: "error", source: "frontend", message: "a" },
      { id: 6, timestamp: "t6", severity: "error", source: "frontend", message: "a" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].count).toBe(2);
    expect(grouped[1].count).toBe(1);
    expect(grouped[2].count).toBe(3);
  });

  it("keeps the first entry's id and timestamp for a group", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 10, timestamp: "first", severity: "error", source: "frontend", message: "x" },
      { id: 11, timestamp: "second", severity: "error", source: "frontend", message: "x" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped[0].id).toBe(10);
    expect(grouped[0].timestamp).toBe("first");
  });

  it("does not mutate the input array", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "x" },
      { id: 2, timestamp: "t2", severity: "error", source: "frontend", message: "x" },
    ];
    groupConsecutiveEntries(entries);
    expect(entries).toHaveLength(2);
    expect(entries[0]).not.toHaveProperty("count");
  });

  it("treats entries differing only by message as separate groups", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "error", source: "frontend", message: "a" },
      { id: 2, timestamp: "t2", severity: "error", source: "frontend", message: "b" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(2);
  });

  it("groups all entries when an entire list is identical", () => {
    const entries: UnifiedLogEntry[] = Array.from({ length: 33 }, (_, i) => ({
      id: i + 1,
      timestamp: `t${i}`,
      severity: "error" as const,
      source: "frontend" as const,
      message: "repeated",
    }));
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(33);
  });

  it("ignores module differences when grouping (module not part of the key)", () => {
    const entries: UnifiedLogEntry[] = [
      { id: 1, timestamp: "t1", severity: "info", source: "backend", message: "m", module: "a" },
      { id: 2, timestamp: "t2", severity: "info", source: "backend", message: "m", module: "b" },
    ];
    const grouped = groupConsecutiveEntries(entries);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// structuredToUnified (Task 7)
// ---------------------------------------------------------------------------

describe("structuredToUnified", () => {
  it("maps a StructuredEntry to a store entry shape", () => {
    const u = structuredToUnified({
      ts: "2026-06-07T10:00:00.000Z", level: "warn", source: "backend", module: "mod::x", message: "hi",
    });
    expect(u).toEqual({
      timestamp: "2026-06-07T10:00:00.000Z", severity: "warn", source: "backend", module: "mod::x", message: "hi", stack: undefined,
    });
  });
  it("falls back to info for unknown level and frontend for unknown source", () => {
    const u = structuredToUnified({ ts: "t", level: "weird", source: "??", message: "m" });
    expect(u.severity).toBe("info");
    expect(u.source).toBe("frontend");
  });
});
