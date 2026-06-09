import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { renderHook } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useSessionEvents,
  pickBestHistoryMatch,
  type ClaudeHistoryEntry,
} from "./useSessionEvents";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockUpdateLastOutput = vi.fn();
const mockSetExitCode = vi.fn();
const mockUpdateStatus = vi.fn();
const mockSetClaudeSessionId = vi.fn();

// Mutable so individual tests can inject their own sessions array
let mockSessionsData: Array<{
  id: string;
  createdAt: number;
  claudeSessionId?: string;
  folder: string;
  title: string;
}> = [];

vi.mock("../../../store/sessionStore", () => ({
  useSessionStore: {
    getState: () => ({
      sessions: mockSessionsData,
      updateLastOutput: mockUpdateLastOutput,
      setExitCode: mockSetExitCode,
      updateStatus: mockUpdateStatus,
      setClaudeSessionId: mockSetClaudeSessionId,
    }),
  },
}));

const mockSetSessionTitleOverride = vi.fn();
let mockSessionTitleOverridesData: Record<string, string> = {};

vi.mock("../../../store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      sessionTitleOverrides: mockSessionTitleOverridesData,
      setSessionTitleOverride: mockSetSessionTitleOverride,
    }),
  },
}));

vi.mock("../../../utils/perfLogger", () => ({
  createEventTracker: () => vi.fn(),
}));

vi.mock("../../../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────

type ListenCallback = (event: { payload: Record<string, unknown> }) => void;

/** Capture the callback registered for a given event name */
function getListenCallback(eventName: string): ListenCallback {
  const calls = (listen as Mock).mock.calls;
  const call = calls.find(
    (c: unknown[]) => c[0] === eventName,
  );
  if (!call) throw new Error(`No listener for event "${eventName}"`);
  return call[1] as ListenCallback;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("useSessionEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockSessionsData = [];
    mockSessionTitleOverridesData = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers 3 core event listeners on mount", () => {
    renderHook(() => useSessionEvents());

    const expectedEvents = [
      "session-output",
      "session-exit",
      "session-status",
    ];

    for (const event of expectedEvents) {
      expect(listen).toHaveBeenCalledWith(event, expect.any(Function));
    }

    // Agent events should NOT be registered
    expect(listen).not.toHaveBeenCalledWith("agent-detected", expect.any(Function));
    expect(listen).not.toHaveBeenCalledWith("agent-completed", expect.any(Function));
  });

  it("calls cleanup functions on unmount", async () => {
    const mockUnlisten = vi.fn();
    (listen as Mock).mockResolvedValue(mockUnlisten);

    const { unmount } = renderHook(() => useSessionEvents());
    unmount();

    // Allow promises to resolve
    await vi.runAllTimersAsync();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  it("session-output: debounces and updates lastOutput", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-output");

    cb({ payload: { id: "s1", data: "hello world" } });

    // Not called immediately (debounced)
    expect(mockUpdateLastOutput).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);

    expect(mockUpdateLastOutput).toHaveBeenCalledWith(
      "s1",
      "hello world",
    );
  });

  it("session-output: ignores invalid payload", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-output");

    cb({ payload: { id: 123, data: null } as unknown as Record<string, unknown> });

    vi.advanceTimersByTime(300);
    expect(mockUpdateLastOutput).not.toHaveBeenCalled();
  });

  it("session-exit: sets exit code", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-exit");

    cb({ payload: { id: "s1", exit_code: 0 } });
    expect(mockSetExitCode).toHaveBeenCalledWith("s1", 0);
  });

  it("session-exit: accepts a valid non-zero number", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-exit");

    cb({ payload: { id: "s1", exit_code: 137 } });
    expect(mockSetExitCode).toHaveBeenCalledWith("s1", 137);
  });

  it("session-exit: ignores a non-number exit_code (string)", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-exit");

    // unknown payload — a string must not be force-cast into the store.
    cb({ payload: { id: "s1", exit_code: "0" } as unknown as Record<string, unknown> });
    expect(mockSetExitCode).not.toHaveBeenCalled();
  });

  it("session-status: updates valid status", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-status");

    cb({ payload: { id: "s1", status: "running" } });
    expect(mockUpdateStatus).toHaveBeenCalledWith("s1", "running");
  });

  it("session-status: ignores invalid status", () => {
    renderHook(() => useSessionEvents());
    const cb = getListenCallback("session-status");

    cb({ payload: { id: "s1", status: "unknown-status" } });
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  // ── Discovery Tests (Issue #176) ────────────────────────────────────

  describe("claudeSessionId discovery", () => {
    it("happy path: assigns claudeSessionId when timestamp matches session creation time", async () => {
      const createdAt = 100_000;
      mockSessionsData = [
        { id: "tab-1", createdAt, folder: "C:/foo", title: "My Session" },
      ];
      (invoke as Mock).mockResolvedValue([
        { session_id: "SID-NEW", started_at: new Date(createdAt).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-1", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000);

      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-1", "SID-NEW");
      // Title override written because none existed yet
      expect(mockSetSessionTitleOverride).toHaveBeenCalledWith("SID-NEW", "My Session");
    });

    it("old entry: does not assign when only history entries from before session creation exist", async () => {
      const createdAt = 100_000;
      mockSessionsData = [
        { id: "tab-1", createdAt, folder: "C:/foo", title: "New Session" },
      ];
      // Only an old entry — started 60s before session was created, far outside 10s tolerance
      (invoke as Mock).mockResolvedValue([
        { session_id: "SID-OLD", started_at: new Date(createdAt - 60_000).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-1", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000); // attempt 1 — no match

      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();

      // A retry should be scheduled — advancing timer triggers attempt 2.
      // Filter to scan_claude_sessions to ignore the session_has_diff probe
      // that also fires on every "running" status event.
      await vi.advanceTimersByTimeAsync(3_000);
      const scanCalls = (invoke as Mock).mock.calls.filter(
        (c) => c[0] === "scan_claude_sessions",
      );
      expect(scanCalls).toHaveLength(2);
      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();
    });

    it("claim conflict: does not assign an ID already claimed by another tab's discovery", async () => {
      const now = 100_000;
      mockSessionsData = [
        { id: "tab-a", createdAt: now - 5_000, folder: "C:/foo", title: "Old Session" },
        { id: "tab-b", createdAt: now, folder: "C:/foo", title: "New Session" },
      ];
      // Only SID-A exists in history — within tolerance for both tabs
      (invoke as Mock).mockResolvedValue([
        { session_id: "SID-A", started_at: new Date(now - 5_000).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      // Tab A discovers SID-A first → claimedIds.add("SID-A")
      cb({ payload: { id: "tab-a", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-a", "SID-A");

      // Tab B fires — SID-A is the only entry but it's now claimed
      cb({ payload: { id: "tab-b", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000);

      // Only 1 setClaudeSessionId call total — tab-b was blocked by claim check
      expect(mockSetClaudeSessionId).toHaveBeenCalledTimes(1);
    });

    it("override existence check: does not overwrite an existing user-set title override", async () => {
      const createdAt = 100_000;
      mockSessionsData = [
        { id: "tab-1", createdAt, folder: "C:/foo", title: "Default Title" },
      ];
      // Pre-existing user override for this claudeSessionId
      mockSessionTitleOverridesData = { "SID-NEW": "Mein Custom Name" };
      (invoke as Mock).mockResolvedValue([
        { session_id: "SID-NEW", started_at: new Date(createdAt).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-1", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000);

      // ID is assigned correctly
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-1", "SID-NEW");
      // But override is NOT overwritten — existing user title is preserved
      expect(mockSetSessionTitleOverride).not.toHaveBeenCalled();
    });

    it("claim conflict (concurrent): both tabs fire running simultaneously, only one gets the ID", async () => {
      const now = 100_000;
      mockSessionsData = [
        { id: "tab-a", createdAt: now - 5_000, folder: "C:/foo", title: "Old Session" },
        { id: "tab-b", createdAt: now, folder: "C:/foo", title: "New Session" },
      ];
      // SID-A is the only entry — within tolerance for both tabs
      (invoke as Mock).mockResolvedValue([
        { session_id: "SID-A", started_at: new Date(now - 5_000).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      // Both tabs fire "running" before either discovery completes (concurrent scenario)
      cb({ payload: { id: "tab-a", status: "running" } });
      cb({ payload: { id: "tab-b", status: "running" } });

      // Both discovery timers fire at t=3000ms; microtasks execute sequentially
      // tab-a's continuation runs first: claimedIds.add("SID-A"), setClaudeSessionId("tab-a")
      // tab-b's continuation runs next: claimedIds.has("SID-A") = true → no match
      await vi.advanceTimersByTimeAsync(3_000);

      // Only one assignment — whichever tab ran first gets SID-A, the other is blocked
      expect(mockSetClaudeSessionId).toHaveBeenCalledTimes(1);
    });

    it("retry: retries discovery on each failed attempt and succeeds on a later attempt", async () => {
      const createdAt = 100_000;
      mockSessionsData = [
        { id: "tab-1", createdAt, folder: "C:/foo", title: "My Session" },
      ];
      // Command-aware mock: queue-based mockResolvedValueOnce can't be used
      // here because session_has_diff fires on every "running" status event
      // and would consume queue entries meant for scan_claude_sessions.
      let scanAttempt = 0;
      (invoke as Mock).mockImplementation((cmd: string) => {
        if (cmd === "session_has_diff") return Promise.resolve(false);
        if (cmd === "scan_claude_sessions") {
          scanAttempt++;
          if (scanAttempt <= 2) return Promise.resolve([]); // empty for attempts 1+2
          return Promise.resolve([
            { session_id: "SID-NEW", started_at: new Date(createdAt).toISOString() },
          ]);
        }
        return Promise.resolve(undefined);
      });

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-1", status: "running" } });

      const scanCount = (): number =>
        (invoke as Mock).mock.calls.filter((c) => c[0] === "scan_claude_sessions").length;

      await vi.advanceTimersByTimeAsync(3_000); // attempt 1
      expect(scanCount()).toBe(1);
      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000); // attempt 2
      expect(scanCount()).toBe(2);
      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3_000); // attempt 3 — success
      expect(scanCount()).toBe(3);
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-1", "SID-NEW");
    });

    it("3-session race regression: 3 same-folder sessions get distinct UUIDs", async () => {
      // Repro the bug team's failure-mode: 3 sessions spawn at +0/+100/+200ms
      // in the same folder. Their jsonl files are written ~300ms after spawn.
      // Closest-match must assign each card to its OWN jsonl, not "the newest
      // unclaimed" which would invert the ordering.
      mockSessionsData = [
        { id: "tab-A", createdAt: 1000, folder: "C:/proj/m2", title: "m2" },
        { id: "tab-B", createdAt: 1100, folder: "C:/proj/m2", title: "m2" },
        { id: "tab-C", createdAt: 1200, folder: "C:/proj/m2", title: "m2" },
      ];
      (invoke as Mock).mockResolvedValue([
        // Backend returns DESC sorted by started_at (newest first)
        { session_id: "uuid-C", started_at: new Date(1500).toISOString() },
        { session_id: "uuid-B", started_at: new Date(1400).toISOString() },
        { session_id: "uuid-A", started_at: new Date(1300).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-A", status: "running" } });
      cb({ payload: { id: "tab-B", status: "running" } });
      cb({ payload: { id: "tab-C", status: "running" } });

      await vi.advanceTimersByTimeAsync(3_000);

      // Each card claims its own jsonl — no UUID collisions.
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-A", "uuid-A");
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-B", "uuid-B");
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-C", "uuid-C");
      expect(mockSetClaudeSessionId).toHaveBeenCalledTimes(3);
    });

    it("respects existing store-claimed UUIDs across an effect remount", async () => {
      // Defense across StrictMode / hot-reload: a fresh useEffect run gets a
      // new local claimedIds Set, but the store still carries the previous
      // session's claudeSessionId. The discovery must not re-pick that UUID.
      mockSessionsData = [
        // tab-old already has uuid-A claimed in the store
        { id: "tab-old", createdAt: 1000, folder: "C:/proj/m2", title: "m2", claudeSessionId: "uuid-A" },
        // tab-new is the one currently discovering
        { id: "tab-new", createdAt: 1100, folder: "C:/proj/m2", title: "m2" },
      ];
      (invoke as Mock).mockResolvedValue([
        { session_id: "uuid-A", started_at: new Date(1300).toISOString() },
        { session_id: "uuid-B", started_at: new Date(1400).toISOString() },
      ]);

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-status");

      cb({ payload: { id: "tab-new", status: "running" } });
      await vi.advanceTimersByTimeAsync(3_000);

      // uuid-A is store-claimed → tab-new must pick uuid-B.
      expect(mockSetClaudeSessionId).toHaveBeenCalledWith("tab-new", "uuid-B");
      expect(mockSetClaudeSessionId).not.toHaveBeenCalledWith("tab-new", "uuid-A");
    });
  });

  // ── Deterministic claudeSessionId resolution via Rust event ───────────
  //
  // Replaces the started_at proximity heuristic for fresh spawns. Rust
  // snapshots `~/.claude/projects/<slug>/` before spawn and watches for
  // the new jsonl to appear post-spawn — that file's UUID is unambiguously
  // this session's. Frontend just listens and applies.
  describe("session-claude-id-resolved event", () => {
    it("registers a listener for session-claude-id-resolved", () => {
      renderHook(() => useSessionEvents());
      expect(listen).toHaveBeenCalledWith(
        "session-claude-id-resolved",
        expect.any(Function),
      );
    });

    it("forwards resolved claudeSessionId to the store", () => {
      mockSessionsData = [
        { id: "tab-1", createdAt: 1000, folder: "C:/proj", title: "My Session" },
      ];

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-claude-id-resolved");

      cb({ payload: { id: "tab-1", claudeSessionId: "deterministic-uuid" } });

      expect(mockSetClaudeSessionId).toHaveBeenCalledWith(
        "tab-1",
        "deterministic-uuid",
      );
    });

    it("writes title override when none exists yet", () => {
      mockSessionsData = [
        { id: "tab-1", createdAt: 1000, folder: "C:/proj", title: "My Session" },
      ];

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-claude-id-resolved");

      cb({ payload: { id: "tab-1", claudeSessionId: "deterministic-uuid" } });

      expect(mockSetSessionTitleOverride).toHaveBeenCalledWith(
        "deterministic-uuid",
        "My Session",
      );
    });

    it("does not overwrite an existing user-set title override", () => {
      mockSessionsData = [
        { id: "tab-1", createdAt: 1000, folder: "C:/proj", title: "My Session" },
      ];
      mockSessionTitleOverridesData = { "deterministic-uuid": "User Renamed" };

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-claude-id-resolved");

      cb({ payload: { id: "tab-1", claudeSessionId: "deterministic-uuid" } });

      expect(mockSetClaudeSessionId).toHaveBeenCalledWith(
        "tab-1",
        "deterministic-uuid",
      );
      expect(mockSetSessionTitleOverride).not.toHaveBeenCalled();
    });

    it("ignores invalid payload (non-string id or claudeSessionId)", () => {
      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-claude-id-resolved");

      cb({ payload: { id: 123, claudeSessionId: "x" } as unknown as Record<string, unknown> });
      cb({ payload: { id: "tab-1", claudeSessionId: null } as unknown as Record<string, unknown> });
      cb({ payload: {} });

      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();
    });

    it("no-ops when the runtime session has been removed before the event arrives", () => {
      // Rust watcher may resolve AFTER the user closed the card — guard
      // against writing an override for a UUID that has no live session.
      mockSessionsData = [];

      renderHook(() => useSessionEvents());
      const cb = getListenCallback("session-claude-id-resolved");

      cb({ payload: { id: "tab-gone", claudeSessionId: "uuid-x" } });

      expect(mockSetClaudeSessionId).not.toHaveBeenCalled();
      expect(mockSetSessionTitleOverride).not.toHaveBeenCalled();
    });
  });
});

// ── Pure helper: pickBestHistoryMatch ────────────────────────────────────

const NEVER_CLAIMED = (): boolean => false;

function entry(session_id: string, isoStartedAt: string): ClaudeHistoryEntry {
  return { session_id, started_at: isoStartedAt };
}

describe("pickBestHistoryMatch", () => {
  it("returns null for empty history", () => {
    expect(pickBestHistoryMatch([], Date.now(), NEVER_CLAIMED)).toBeNull();
  });

  it("returns null when every entry is already claimed", () => {
    const history = [entry("uuid-1", "2026-01-01T10:00:00.000Z")];
    const claimed = (id: string) => id === "uuid-1";
    expect(
      pickBestHistoryMatch(history, Date.parse("2026-01-01T10:00:00Z"), claimed),
    ).toBeNull();
  });

  it("returns null when entries are outside the tolerance window", () => {
    const history = [entry("uuid-1", "2026-01-01T10:00:00.000Z")];
    const sessionCreatedAt = Date.parse("2026-01-01T10:01:00.000Z"); // +60s away
    expect(
      pickBestHistoryMatch(history, sessionCreatedAt, NEVER_CLAIMED, 10_000),
    ).toBeNull();
  });

  it("returns the single unclaimed in-window entry", () => {
    const history = [entry("uuid-1", "2026-01-01T10:00:00.500Z")];
    const sessionCreatedAt = Date.parse("2026-01-01T10:00:00.000Z"); // 500ms before
    expect(pickBestHistoryMatch(history, sessionCreatedAt, NEVER_CLAIMED)?.session_id).toBe("uuid-1");
  });

  it("picks closest started_at — not newest, when sessions are well-spaced", () => {
    // Three sessions widely spaced enough that each is unambiguously closer
    // to its own jsonl. The naive `find()` over a DESC-sorted history would
    // pick uuid-newest for ALL queries; closest-match picks the right one
    // per session.
    //
    // For closely-spaced sessions (within the spawn-to-jsonl delay), the
    // picker alone is insufficient — see the regression test below for the
    // claim-set sequence that handles that case.
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-3", new Date(9_100).toISOString()),
      entry("uuid-2", new Date(5_100).toISOString()),
      entry("uuid-1", new Date(1_100).toISOString()),
    ];

    expect(pickBestHistoryMatch(history, 1_000, NEVER_CLAIMED)?.session_id).toBe("uuid-1");
    expect(pickBestHistoryMatch(history, 5_000, NEVER_CLAIMED)?.session_id).toBe("uuid-2");
    expect(pickBestHistoryMatch(history, 9_000, NEVER_CLAIMED)?.session_id).toBe("uuid-3");
  });

  it("skips claimed entries and falls back to next-closest", () => {
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-A", new Date(1300).toISOString()),
      entry("uuid-B", new Date(1400).toISOString()),
      entry("uuid-C", new Date(1500).toISOString()),
    ];
    const claimed = (id: string) => id === "uuid-A";

    expect(pickBestHistoryMatch(history, 1000, claimed)?.session_id).toBe("uuid-B");
  });

  it("ignores entries with invalid timestamps", () => {
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-bad", "not-a-date"),
      entry("uuid-good", new Date(1100).toISOString()),
    ];

    expect(pickBestHistoryMatch(history, 1000, NEVER_CLAIMED)?.session_id).toBe("uuid-good");
  });

  it("respects a custom tolerance parameter", () => {
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-X", new Date(2000).toISOString()), // 1000ms after
    ];

    expect(pickBestHistoryMatch(history, 1000, NEVER_CLAIMED)?.session_id).toBe("uuid-X");
    expect(pickBestHistoryMatch(history, 1000, NEVER_CLAIMED, 500)).toBeNull();
  });

  it("is deterministic on tie — first encountered wins", () => {
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-first", new Date(900).toISOString()),  // -100ms
      entry("uuid-second", new Date(1100).toISOString()), // +100ms
    ];

    expect(pickBestHistoryMatch(history, 1000, NEVER_CLAIMED)?.session_id).toBe("uuid-first");
  });

  it("regression: simulated 3-session sequence produces 3 distinct UUIDs", () => {
    const history: ClaudeHistoryEntry[] = [
      entry("uuid-C", new Date(1500).toISOString()),
      entry("uuid-B", new Date(1400).toISOString()),
      entry("uuid-A", new Date(1300).toISOString()),
    ];
    const claimed = new Set<string>();
    const isClaimed = (id: string) => claimed.has(id);

    const matchA = pickBestHistoryMatch(history, 1000, isClaimed);
    if (matchA) claimed.add(matchA.session_id);

    const matchB = pickBestHistoryMatch(history, 1100, isClaimed);
    if (matchB) claimed.add(matchB.session_id);

    const matchC = pickBestHistoryMatch(history, 1200, isClaimed);
    if (matchC) claimed.add(matchC.session_id);

    expect(matchA?.session_id).toBe("uuid-A");
    expect(matchB?.session_id).toBe("uuid-B");
    expect(matchC?.session_id).toBe("uuid-C");
    expect(new Set([matchA?.session_id, matchB?.session_id, matchC?.session_id]).size).toBe(3);
  });
});
