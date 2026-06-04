import { describe, it, expect, beforeEach } from "vitest";
import {
  useSessionStore,
  selectActiveSession,
  selectEffectiveSession,
  selectSessionCounts,
  generateUniqueDisplayId,
  type ClaudeSession,
  type SessionState,
  type SessionShell,
  type SessionStatus,
} from "./sessionStore";

// ============================================================================
// Helpers
// ============================================================================

function getState(): SessionState {
  return useSessionStore.getState();
}

function addTestSession(overrides?: {
  id?: string;
  title?: string;
  folder?: string;
  shell?: SessionShell;
}) {
  getState().addSession({
    id: overrides?.id ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: overrides?.title ?? "Test Session",
    folder: overrides?.folder ?? "C:/projects/test",
    shell: overrides?.shell ?? "powershell",
  });
}

// ============================================================================
// Reset
// ============================================================================

beforeEach(() => {
  // Zustand does not have a reset() — manually set back to initial state
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    layoutMode: "single",
    gridSessionIds: [],
    focusedGridSessionId: null,
  });
});

// ============================================================================
// Initial State
// ============================================================================

describe("initial state", () => {
  it("starts with empty sessions array", () => {
    expect(getState().sessions).toEqual([]);
  });

  it("starts with activeSessionId null", () => {
    expect(getState().activeSessionId).toBeNull();
  });
});

// ============================================================================
// addSession
// ============================================================================

describe("addSession", () => {
  it("adds a session with correct defaults", () => {
    addTestSession({ id: "s1", title: "My Session", folder: "C:/work" });
    const sessions = getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
    expect(sessions[0].title).toBe("My Session");
    expect(sessions[0].folder).toBe("C:/work");
    expect(sessions[0].shell).toBe("powershell");
    expect(sessions[0].status).toBe("starting");
    expect(sessions[0].exitCode).toBeNull();
    expect(sessions[0].finishedAt).toBeNull();
    expect(sessions[0].lastOutputSnippet).toBe("");
  });

  it("sets new session as activeSessionId", () => {
    addTestSession({ id: "s1" });
    expect(getState().activeSessionId).toBe("s1");
  });

  it("overwrites activeSessionId when adding second session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    expect(getState().activeSessionId).toBe("s2");
    expect(getState().sessions).toHaveLength(2);
  });

  it("enforces MAX_SESSIONS=8 limit", () => {
    for (let i = 0; i < 10; i++) {
      addTestSession({ id: `s${i}` });
    }
    expect(getState().sessions).toHaveLength(8);
  });

  it("returns original state when MAX_SESSIONS reached (no partial mutation)", () => {
    for (let i = 0; i < 8; i++) {
      addTestSession({ id: `s${i}` });
    }
    addTestSession({ id: "s-overflow" });
    const stateAfter = getState();
    // activeSessionId should remain from last successful add
    expect(stateAfter.activeSessionId).toBe("s7");
    expect(stateAfter.sessions).toHaveLength(8);
    // Should not contain overflow session
    expect(stateAfter.sessions.find((s) => s.id === "s-overflow")).toBeUndefined();
  });

  // FIX: Duplicate ID prevention — adding same ID twice is silently ignored
  it("rejects duplicate session IDs", () => {
    addTestSession({ id: "dupe" });
    addTestSession({ id: "dupe" });
    const dupes = getState().sessions.filter((s) => s.id === "dupe");
    expect(dupes).toHaveLength(1);
  });

  it("sets createdAt and lastOutputAt to approximately now", () => {
    const before = Date.now();
    addTestSession({ id: "s1" });
    const after = Date.now();
    const s = getState().sessions[0];
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
    expect(s.createdAt).toBeLessThanOrEqual(after);
    expect(s.lastOutputAt).toBeGreaterThanOrEqual(before);
    expect(s.lastOutputAt).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// removeSession
// ============================================================================

describe("removeSession", () => {
  it("removes the correct session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().removeSession("s1");
    expect(getState().sessions).toHaveLength(1);
    expect(getState().sessions[0].id).toBe("s2");
  });

  it("selects last remaining session when active session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    // s3 is active
    getState().removeSession("s3");
    // Should fallback to last remaining = s2
    expect(getState().activeSessionId).toBe("s2");
  });

  it("sets activeSessionId to null when last session is removed", () => {
    addTestSession({ id: "s1" });
    getState().removeSession("s1");
    expect(getState().activeSessionId).toBeNull();
    expect(getState().sessions).toHaveLength(0);
  });

  it("does not change activeSessionId when non-active session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    // s3 is active; remove s1
    getState().setActiveSession("s3");
    getState().removeSession("s1");
    expect(getState().activeSessionId).toBe("s3");
  });

  it("is a no-op when removing non-existent session ID", () => {
    addTestSession({ id: "s1" });
    getState().removeSession("nonexistent");
    expect(getState().sessions).toHaveLength(1);
  });

  // BUG: removeSession does NOT call close_session on the backend.
  // The PTY process keeps running even after frontend removes it.
  it("BUG: removeSession does not notify backend — PTY process leaks", () => {
    addTestSession({ id: "s1" });
    getState().removeSession("s1");
    // Session removed from frontend store, but no Tauri invoke("close_session")
    // is ever called. The Rust SessionManager still holds the PTY handle.
    expect(getState().sessions).toHaveLength(0);
    // This test documents the architectural bug — the store has no
    // side-effect to call the backend.
  });
});

// ============================================================================
// setActiveSession
// ============================================================================

describe("setActiveSession", () => {
  it("sets activeSessionId to given ID", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().setActiveSession("s1");
    expect(getState().activeSessionId).toBe("s1");
  });

  it("allows setting to null", () => {
    addTestSession({ id: "s1" });
    getState().setActiveSession(null);
    expect(getState().activeSessionId).toBeNull();
  });

  // FIX: Validation — setting activeSessionId to a non-existent session is ignored
  it("ignores setActiveSession with non-existent session ID", () => {
    getState().setActiveSession("ghost-id");
    expect(getState().activeSessionId).toBeNull();
  });
});

// ============================================================================
// updateStatus
// ============================================================================

describe("updateStatus", () => {
  it("updates session status", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].status).toBe("running");
  });

  it("sets finishedAt when transitioning to 'done'", () => {
    addTestSession({ id: "s1" });
    const before = Date.now();
    getState().updateStatus("s1", "done");
    const s = getState().sessions[0];
    expect(s.finishedAt).not.toBeNull();
    expect(s.finishedAt!).toBeGreaterThanOrEqual(before);
  });

  it("sets finishedAt when transitioning to 'error'", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "error");
    expect(getState().sessions[0].finishedAt).not.toBeNull();
  });

  it("does NOT set finishedAt for 'running' or 'waiting'", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].finishedAt).toBeNull();
    getState().updateStatus("s1", "waiting");
    expect(getState().sessions[0].finishedAt).toBeNull();
  });

  it("is a no-op for non-existent session ID (no crash)", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("nonexistent", "running");
    expect(getState().sessions[0].status).toBe("starting");
  });

  // done is terminal — the guard blocks done→running and preserves finishedAt
  it("done is a terminal state — updateStatus after done is a no-op", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "done");
    const finishedAt = getState().sessions[0].finishedAt;
    expect(finishedAt).not.toBeNull();
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].status).toBe("done");
    expect(getState().sessions[0].finishedAt).toBe(finishedAt);
  });
});

// ============================================================================
// setExitCode
// ============================================================================

describe("setExitCode", () => {
  it("sets exitCode and status to 'done' for exit code 0", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("s1", 0);
    const s = getState().sessions[0];
    expect(s.exitCode).toBe(0);
    expect(s.status).toBe("done");
    expect(s.finishedAt).not.toBeNull();
  });

  it("sets exitCode and status to 'error' for non-zero exit code", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("s1", 1);
    const s = getState().sessions[0];
    expect(s.exitCode).toBe(1);
    expect(s.status).toBe("error");
  });

  it("handles negative exit codes (e.g. signal kills)", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("s1", -1);
    expect(getState().sessions[0].status).toBe("error");
    expect(getState().sessions[0].exitCode).toBe(-1);
  });

  it("is a no-op for non-existent session", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("nonexistent", 42);
    expect(getState().sessions[0].exitCode).toBeNull();
  });
});

// ============================================================================
// updateLastOutput
// ============================================================================

describe("updateLastOutput", () => {
  it("updates lastOutputSnippet and lastOutputAt", () => {
    addTestSession({ id: "s1" });
    const before = Date.now();
    getState().updateLastOutput("s1", "Hello world");
    const s = getState().sessions[0];
    expect(s.lastOutputSnippet).toBe("Hello world");
    expect(s.lastOutputAt).toBeGreaterThanOrEqual(before);
  });

  it("replaces previous snippet entirely", () => {
    addTestSession({ id: "s1" });
    getState().updateLastOutput("s1", "first");
    getState().updateLastOutput("s1", "second");
    expect(getState().sessions[0].lastOutputSnippet).toBe("second");
  });

  it("handles empty string", () => {
    addTestSession({ id: "s1" });
    getState().updateLastOutput("s1", "something");
    getState().updateLastOutput("s1", "");
    expect(getState().sessions[0].lastOutputSnippet).toBe("");
  });
});

// ============================================================================
// Selectors
// ============================================================================

describe("selectActiveSession", () => {
  it("returns the active session", () => {
    addTestSession({ id: "s1", title: "First" });
    addTestSession({ id: "s2", title: "Second" });
    getState().setActiveSession("s1");
    const active = selectActiveSession(getState());
    expect(active?.id).toBe("s1");
    expect(active?.title).toBe("First");
  });

  it("returns undefined when no active session", () => {
    expect(selectActiveSession(getState())).toBeUndefined();
  });

  it("returns undefined when activeSessionId references removed session", () => {
    addTestSession({ id: "s1" });
    getState().setActiveSession("s1");
    // Directly set state to simulate race condition
    useSessionStore.setState({ sessions: [], activeSessionId: "s1" });
    expect(selectActiveSession(getState())).toBeUndefined();
  });
});

describe("selectEffectiveSession", () => {
  it("single mode → returns the activeSessionId session (ignores focusedGridSessionId)", () => {
    addTestSession({ id: "s1", title: "First" });
    addTestSession({ id: "s2", title: "Second" });
    useSessionStore.setState({
      layoutMode: "single",
      activeSessionId: "s1",
      focusedGridSessionId: "s2",
    });
    expect(selectEffectiveSession(getState())?.id).toBe("s1");
  });

  it("grid mode → follows focusedGridSessionId, not activeSessionId", () => {
    addTestSession({ id: "s1", title: "First" });
    addTestSession({ id: "s2", title: "Second" });
    useSessionStore.setState({
      layoutMode: "grid",
      activeSessionId: "s1",
      focusedGridSessionId: "s2",
    });
    expect(selectEffectiveSession(getState())?.id).toBe("s2");
  });

  it("grid mode with no focused cell → falls back to activeSessionId", () => {
    addTestSession({ id: "s1", title: "First" });
    addTestSession({ id: "s2", title: "Second" });
    useSessionStore.setState({
      layoutMode: "grid",
      activeSessionId: "s1",
      focusedGridSessionId: null,
    });
    expect(selectEffectiveSession(getState())?.id).toBe("s1");
  });
});

describe("selectSessionCounts", () => {
  it("returns all zeros for empty state", () => {
    const counts = selectSessionCounts(getState());
    expect(counts).toEqual({ active: 0, waiting: 0, done: 0, error: 0, total: 0 });
  });

  it("counts by status correctly", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    addTestSession({ id: "s4" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "waiting");
    getState().updateStatus("s3", "done");
    getState().updateStatus("s4", "error");
    const counts = selectSessionCounts(getState());
    expect(counts.active).toBe(1);
    expect(counts.waiting).toBe(1);
    expect(counts.done).toBe(1);
    expect(counts.error).toBe(1);
    expect(counts.total).toBe(4);
  });

  // FIX: "starting" sessions are now counted as "active"
  it("counts 'starting' sessions as active", () => {
    addTestSession({ id: "s1" });
    expect(getState().sessions[0].status).toBe("starting");
    const counts = selectSessionCounts(getState());
    expect(counts.active).toBe(1);
    expect(counts.total).toBe(1);
  });
});

// ============================================================================
// Race Conditions / Rapid Operations
// ============================================================================

describe("rapid operations", () => {
  it("handles rapid add/remove without corruption", () => {
    for (let i = 0; i < 20; i++) {
      addTestSession({ id: `rapid-${i}` });
      if (i > 0 && i % 3 === 0) {
        getState().removeSession(`rapid-${i - 1}`);
      }
    }
    // Should have at most 8 sessions (MAX_SESSIONS)
    expect(getState().sessions.length).toBeLessThanOrEqual(8);
    // No undefined/null entries
    getState().sessions.forEach((s) => {
      expect(s.id).toBeDefined();
      expect(s.status).toBeDefined();
    });
  });

  it("handles rapid status updates on same session — done is terminal", () => {
    addTestSession({ id: "s1" });
    const statuses: SessionStatus[] = [
      "running", "waiting", "running", "waiting", "done", "error",
    ];
    for (const status of statuses) {
      getState().updateStatus("s1", status);
    }
    // done is terminal — the guard blocks done→error, so done wins
    expect(getState().sessions[0].status).toBe("done");
  });
});

// ============================================================================
// setLayoutMode
// ============================================================================

describe("setLayoutMode", () => {
  it("defaults to 'single'", () => {
    expect(getState().layoutMode).toBe("single");
  });

  it("non-grid mode is a pure passthrough — sets layoutMode, leaves grid state untouched", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");
    getState().setLayoutMode("grid");
    const grid = [...getState().gridSessionIds];
    const focused = getState().focusedGridSessionId;

    getState().setLayoutMode("single");
    expect(getState().layoutMode).toBe("single");
    expect(getState().gridSessionIds).toEqual(grid);
    expect(getState().focusedGridSessionId).toBe(focused);
  });

  it("switches to 'grid' when at least one candidate session exists", () => {
    // Precondition matters now: with the empty-grid deadlock guard,
    // setLayoutMode('grid') without candidates is a no-op (see deadlock test).
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    getState().setLayoutMode("grid");
    expect(getState().layoutMode).toBe("grid");
  });

  it("auto-fills gridSessionIds with active sessions (max 4) when switching to grid", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");
    getState().updateStatus("s3", "running");

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(
      expect.arrayContaining(["s1", "s2", "s3"])
    );
    expect(getState().gridSessionIds.length).toBeLessThanOrEqual(4);
  });

  it("uses activeSessionId as fallback when 0 active sessions exist", () => {
    addTestSession({ id: "s1" });
    // s1 has status "starting" — not "running", but activeSessionId is "s1"
    getState().updateStatus("s1", "done");
    getState().setActiveSession("s1");

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toContain("s1");
  });

  it("limits gridSessionIds to first 4 when 5+ active sessions exist", () => {
    for (let i = 1; i <= 6; i++) {
      addTestSession({ id: `s${i}` });
      getState().updateStatus(`s${i}`, "running");
    }

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toHaveLength(4);
  });

  it("preserves gridSessionIds when switching back to 'single'", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");

    getState().setLayoutMode("grid");
    const gridIds = [...getState().gridSessionIds];
    expect(gridIds.length).toBeGreaterThan(0);

    getState().setLayoutMode("single");
    expect(getState().layoutMode).toBe("single");
    expect(getState().gridSessionIds).toEqual(gridIds);
  });

  it("preserves custom grid composition across single→grid round-trip", () => {
    // User has 5 active sessions but hand-curates a grid of [s2, s4] (count 2,
    // not first-4-auto-fill). Toggling fullscreen and back must NOT wipe that.
    // Precondition: activeSessionId points at a session that IS in the grid —
    // this matches the natural flow (maximizeGridSession sets activeSessionId
    // to a grid member). With activeSessionId outside the grid, the new
    // "append active to grid" behavior would grow the composition; that case
    // has its own dedicated test below.
    for (let i = 1; i <= 5; i++) {
      addTestSession({ id: `s${i}` });
      getState().updateStatus(`s${i}`, "running");
    }
    getState().setLayoutMode("grid");
    getState().removeFromGrid("s1");
    getState().removeFromGrid("s3");
    getState().removeFromGrid("s5");
    // After custom curation gridSessionIds should be [s2, s4] (only s2/s4 left
    // from the original auto-fill of first-4, since s5 was never in the grid).
    expect(getState().gridSessionIds).toEqual(["s2", "s4"]);
    getState().setActiveSession("s2"); // user is "on" a grid member

    // Fullscreen.
    getState().setLayoutMode("single");
    // Back to grid — MUST preserve [s2, s4], not re-apply first-4 of [s1..s4].
    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(["s2", "s4"]);
    expect(getState().focusedGridSessionId).toBe("s2");
  });

  it("single→grid: focuses the maximized session (activeSessionId), not the previously-focused grid session", () => {
    // Exact user scenario (Bug 2026-05-27): user was in grid with focus on sB,
    // double-clicked sC to go fullscreen on sC, then toggles back to grid.
    // Expected: sC is focused in grid (the session they were working on).
    // Previous behavior: focus stayed on sB (last grid selection wins).
    addTestSession({ id: "sA" });
    addTestSession({ id: "sB" });
    addTestSession({ id: "sC" });
    getState().updateStatus("sA", "running");
    getState().updateStatus("sB", "running");
    getState().updateStatus("sC", "running");

    // Enter grid, then click sB so grid-focus = sB.
    getState().setLayoutMode("grid");
    getState().setFocusedGridSession("sB");
    expect(getState().focusedGridSessionId).toBe("sB");

    // Maximize sC → single mode, activeSessionId = sC. focusedGridSessionId
    // (sB) is intentionally NOT cleared, so it can compete with activeSessionId.
    getState().maximizeGridSession("sC");
    expect(getState().layoutMode).toBe("single");
    expect(getState().activeSessionId).toBe("sC");

    // Back to grid: activeSessionId (sC) MUST win over previous grid focus (sB).
    getState().setLayoutMode("grid");
    expect(getState().focusedGridSessionId).toBe("sC");
  });

  it("single→grid: focuses activeSessionId in the auto-fill path even when it isn't slot 0", () => {
    // No previous grid history (first time entering grid mode). User has 5
    // running sessions and is currently in single mode on s3. Auto-fill picks
    // the first 4 → [s1, s2, s3, s4]. Focus must land on s3 (the session the
    // user was viewing), not s1 (the previous default of activeIds[0]).
    for (let i = 1; i <= 5; i++) {
      addTestSession({ id: `s${i}` });
      getState().updateStatus(`s${i}`, "running");
    }
    getState().setActiveSession("s3");

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toContain("s3");
    expect(getState().focusedGridSessionId).toBe("s3");
  });

  it("single→grid: appends activeSessionId to preserved grid when active is not yet a member", () => {
    // Exact user scenario (Bug 2026-05-27 #2): user is in single mode on B
    // while the preserved grid is [A]. Clicking the grid button should land
    // the user in grid view with B visible AND focused — not the old [A]
    // composition alone. Append-when-room policy: grid grows from 1 to 2.
    addTestSession({ id: "sA" });
    addTestSession({ id: "sB" });
    getState().updateStatus("sA", "running");
    getState().updateStatus("sB", "running");

    // Seed grid with just sA, then user goes to single on sB.
    getState().addToGrid("sA");
    getState().setActiveSession("sB");
    expect(getState().gridSessionIds).toEqual(["sA"]);

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(["sA", "sB"]);
    expect(getState().focusedGridSessionId).toBe("sB");
  });

  it("single→grid: evicts the last preserved slot when grid is full and activeSessionId is not in it", () => {
    // Full grid [A, B, C, D] + active=E not in grid → composition becomes
    // [A, B, C, E]. Preserves the first three curated cells; the last slot
    // makes room for the user's just-viewed session.
    for (const id of ["sA", "sB", "sC", "sD", "sE"]) {
      addTestSession({ id });
      getState().updateStatus(id, "running");
    }
    getState().addToGrid("sA");
    getState().addToGrid("sB");
    getState().addToGrid("sC");
    getState().addToGrid("sD");
    expect(getState().gridSessionIds).toEqual(["sA", "sB", "sC", "sD"]);

    getState().setActiveSession("sE");
    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(["sA", "sB", "sC", "sE"]);
    expect(getState().focusedGridSessionId).toBe("sE");
  });

  it("falls back to auto-fill when all preserved grid sessions have been closed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");
    getState().updateStatus("s3", "running");

    getState().setLayoutMode("grid");
    // Capture initial preserved IDs, then close them all.
    const initialGrid = [...getState().gridSessionIds];
    expect(initialGrid.length).toBeGreaterThan(0);
    for (const id of initialGrid) getState().removeSession(id);

    // Add a fresh active session that was NEVER in the previous grid.
    addTestSession({ id: "s99" });
    getState().updateStatus("s99", "running");

    // Round-trip — preserved list is empty after the closes, so the fallback
    // path must kick in and pick s99.
    getState().setLayoutMode("single");
    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(["s99"]);
  });
});

// ============================================================================
// addToGrid
// ============================================================================

describe("addToGrid", () => {
  it("adds a session to gridSessionIds", () => {
    addTestSession({ id: "s1" });
    getState().addToGrid("s1");
    expect(getState().gridSessionIds).toContain("s1");
  });

  it("rejects addToGrid for an unknown session id (existence guard)", () => {
    // Without this guard a phantom id would silently allocate a grid slot
    // (SessionManagerView.resolveGridArea / isVisible look up by id and would
    // render an empty cell). Regression guard for INV-3.
    addTestSession({ id: "real-1" });
    getState().addToGrid("nonexistent-id");
    expect(getState().gridSessionIds).not.toContain("nonexistent-id");
    expect(getState().gridSessionIds).toEqual([]);
    expect(getState().focusedGridSessionId).toBeNull();
  });

  it("sets focusedGridSessionId to the newly added session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    expect(getState().focusedGridSessionId).toBe("s2");
  });

  it("enforces max 4 sessions — 5th session is rejected", () => {
    for (let i = 1; i <= 5; i++) {
      addTestSession({ id: `s${i}` });
      getState().addToGrid(`s${i}`);
    }
    expect(getState().gridSessionIds).toHaveLength(4);
    expect(getState().gridSessionIds).not.toContain("s5");
  });

  it("does not add duplicate IDs", () => {
    addTestSession({ id: "s1" });
    getState().addToGrid("s1");
    getState().addToGrid("s1");
    const count = getState().gridSessionIds.filter((id) => id === "s1").length;
    expect(count).toBe(1);
  });

  it("does not crash when session ID is not in sessions array", () => {
    // No session added — ID does not exist in store
    getState().addToGrid("nonexistent");
    // Should not throw; behavior (add or reject) is implementation detail
    expect(true).toBe(true);
  });
});

// ============================================================================
// removeFromGrid
// ============================================================================

describe("removeFromGrid", () => {
  it("removes a session from gridSessionIds", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().removeFromGrid("s1");
    expect(getState().gridSessionIds).not.toContain("s1");
    expect(getState().gridSessionIds).toContain("s2");
  });

  it("moves focusedGridSessionId to first remaining when focused session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().addToGrid("s3");
    // s3 is focused (last added)
    expect(getState().focusedGridSessionId).toBe("s3");

    getState().removeFromGrid("s3");
    // Should fallback to first remaining
    expect(getState().focusedGridSessionId).toBe("s1");
  });

  it("switches to 'single' layout when last grid session is removed", () => {
    addTestSession({ id: "s1" });
    getState().setLayoutMode("grid");
    // Ensure s1 is in the grid
    if (!getState().gridSessionIds.includes("s1")) {
      getState().addToGrid("s1");
    }

    getState().removeFromGrid("s1");
    expect(getState().layoutMode).toBe("single");
  });

  it("does not crash when removing non-existent ID", () => {
    getState().removeFromGrid("ghost-id");
    // No throw expected
    expect(getState().gridSessionIds).toEqual([]);
  });
});

// ============================================================================
// setFocusedGridSession
// ============================================================================

describe("setFocusedGridSession", () => {
  it("sets focusedGridSessionId", () => {
    addTestSession({ id: "s1" });
    getState().setFocusedGridSession("s1");
    expect(getState().focusedGridSessionId).toBe("s1");
  });

  it("allows null", () => {
    addTestSession({ id: "s1" });
    getState().setFocusedGridSession("s1");
    getState().setFocusedGridSession(null);
    expect(getState().focusedGridSessionId).toBeNull();
  });
});

// ============================================================================
// maximizeGridSession
// ============================================================================

describe("maximizeGridSession", () => {
  it("sets layoutMode to 'single'", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().setLayoutMode("grid");
    getState().maximizeGridSession("s1");
    expect(getState().layoutMode).toBe("single");
  });

  it("sets activeSessionId to the maximized session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().setLayoutMode("grid");
    getState().maximizeGridSession("s1");
    expect(getState().activeSessionId).toBe("s1");
  });
});

// ============================================================================
// removeSession — Grid Cleanup
// ============================================================================

describe("removeSession grid cleanup", () => {
  it("removes session from gridSessionIds when session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");

    getState().removeSession("s1");
    expect(getState().gridSessionIds).not.toContain("s1");
    expect(getState().gridSessionIds).toContain("s2");
  });

  it("clears focusedGridSessionId when focused session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().setFocusedGridSession("s1");

    getState().removeSession("s1");
    // Should either be null or fallback to another grid session
    expect(getState().focusedGridSessionId).not.toBe("s1");
  });
});

// ============================================================================
// Edge Cases — Grid Layout
// ============================================================================

describe("grid layout edge cases", () => {
  it("handles rapid layout toggling (single→grid→single→grid)", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");

    getState().setLayoutMode("grid");
    getState().setLayoutMode("single");
    getState().setLayoutMode("grid");
    getState().setLayoutMode("single");
    getState().setLayoutMode("grid");

    expect(getState().layoutMode).toBe("grid");
    // State should be consistent — no corruption
    expect(getState().gridSessionIds.length).toBeGreaterThan(0);
    expect(getState().gridSessionIds.length).toBeLessThanOrEqual(4);
  });

  it("grid works with sessions in terminal states (done/error)", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "done");
    getState().updateStatus("s2", "error");

    getState().addToGrid("s1");
    getState().addToGrid("s2");
    expect(getState().gridSessionIds).toContain("s1");
    expect(getState().gridSessionIds).toContain("s2");
  });

  it("addToGrid works when layoutMode is still 'single'", () => {
    addTestSession({ id: "s1" });
    expect(getState().layoutMode).toBe("single");

    getState().addToGrid("s1");
    // Should add to gridSessionIds even if layoutMode is "single"
    expect(getState().gridSessionIds).toContain("s1");
  });
});

describe("displayId — visual disambiguation", () => {
  it("addSession persists displayId when provided", () => {
    getState().addSession({
      id: "s1",
      title: "agentic-dashboard",
      displayId: "3K2X",
      folder: "C:/projects/test",
      shell: "powershell",
    });
    expect(getState().sessions[0]?.displayId).toBe("3K2X");
  });

  it("addSession leaves displayId undefined when not provided (backward-compat for old sessions)", () => {
    addTestSession({ id: "s1" });
    expect(getState().sessions[0]?.displayId).toBeUndefined();
  });

  it("renameSession clears displayId — user has taken control of disambiguation", () => {
    getState().addSession({
      id: "s1",
      title: "agentic-dashboard",
      displayId: "3K2X",
      folder: "C:/projects/test",
      shell: "powershell",
    });
    getState().renameSession("s1", "Mein Projekt");
    expect(getState().sessions[0]?.title).toBe("Mein Projekt");
    expect(getState().sessions[0]?.displayId).toBeUndefined();
  });

  describe("generateUniqueDisplayId", () => {
    it("returns 4 chars from the [A-Z0-9] alphabet", () => {
      const id = generateUniqueDisplayId([]);
      expect(id).toMatch(/^[A-Z0-9]{4}$/);
    });

    it("returns a valid ID for an empty session list", () => {
      const id = generateUniqueDisplayId([]);
      expect(id).toHaveLength(4);
      expect(id).toMatch(/^[A-Z0-9]{4}$/);
    });

    it("generates different IDs across many calls (uniqueness pressure)", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 200; i++) {
        ids.add(generateUniqueDisplayId([]));
      }
      // 36^4 keyspace — 200 random draws should yield well over 100 distinct.
      expect(ids.size).toBeGreaterThan(100);
    });

    it("never returns an ID that already exists in the input list", () => {
      // Seed with all but a tiny set of possible IDs to force the re-roll path.
      const sessions: ClaudeSession[] = Array.from({ length: 50 }, (_, i) => ({
        id: `s${i}`,
        title: `t${i}`,
        displayId: `T${String(i).padStart(3, "0")}`, // T000..T049
        folder: "/tmp",
        shell: "powershell",
        status: "running",
        createdAt: 0,
        finishedAt: null,
        exitCode: null,
        lastOutputAt: 0,
        lastOutputSnippet: "",
      }));
      const taken = new Set(sessions.map((s) => s.displayId));
      // Run many generations to be confident the re-roll path holds.
      for (let i = 0; i < 100; i++) {
        const id = generateUniqueDisplayId(sessions);
        expect(taken.has(id)).toBe(false);
      }
    });

    it("ignores sessions without displayId in the collision set", () => {
      // Session without displayId (legacy) should not crash or block generation.
      const sessions: ClaudeSession[] = [{
        id: "legacy",
        title: "Legacy",
        folder: "/tmp",
        shell: "powershell",
        status: "running",
        createdAt: 0,
        finishedAt: null,
        exitCode: null,
        lastOutputAt: 0,
        lastOutputSnippet: "",
      }];
      const id = generateUniqueDisplayId(sessions);
      expect(id).toMatch(/^[A-Z0-9]{4}$/);
    });
  });
});

// ============================================================================
// addSession — additional coverage
// ============================================================================

describe("addSession — extended", () => {
  it("persists shell variants verbatim (cmd, gitbash)", () => {
    addTestSession({ id: "c1", shell: "cmd" });
    addTestSession({ id: "g1", shell: "gitbash" });
    expect(getState().sessions.find((s) => s.id === "c1")?.shell).toBe("cmd");
    expect(getState().sessions.find((s) => s.id === "g1")?.shell).toBe("gitbash");
  });

  it("persists claudeSessionId when provided", () => {
    getState().addSession({
      id: "s1",
      title: "T",
      folder: "/tmp",
      shell: "powershell",
      claudeSessionId: "uuid-abc",
    });
    expect(getState().sessions[0].claudeSessionId).toBe("uuid-abc");
  });

  it("leaves claudeSessionId undefined when not provided", () => {
    addTestSession({ id: "s1" });
    expect(getState().sessions[0].claudeSessionId).toBeUndefined();
  });

  it("persists isGitRepo and snapshotCommit when provided", () => {
    getState().addSession({
      id: "s1",
      title: "T",
      folder: "/tmp",
      shell: "powershell",
      isGitRepo: true,
      snapshotCommit: "deadbeef",
    });
    expect(getState().sessions[0].isGitRepo).toBe(true);
    expect(getState().sessions[0].snapshotCommit).toBe("deadbeef");
  });

  it("leaves isGitRepo and snapshotCommit undefined when not provided", () => {
    addTestSession({ id: "s1" });
    expect(getState().sessions[0].isGitRepo).toBeUndefined();
    expect(getState().sessions[0].snapshotCommit).toBeUndefined();
  });

  it("appends sessions in insertion order", () => {
    addTestSession({ id: "a" });
    addTestSession({ id: "b" });
    addTestSession({ id: "c" });
    expect(getState().sessions.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("preserves earlier sessions unchanged when duplicate ID is rejected", () => {
    addTestSession({ id: "dupe", title: "Original" });
    getState().updateStatus("dupe", "running");
    getState().addSession({
      id: "dupe",
      title: "Replacement",
      folder: "/tmp",
      shell: "cmd",
    });
    const s = getState().sessions[0];
    expect(s.title).toBe("Original");
    expect(s.status).toBe("running");
    expect(s.shell).toBe("powershell");
  });

  it("accepts exactly MAX_SESSIONS=8 sessions", () => {
    for (let i = 0; i < 8; i++) addTestSession({ id: `s${i}` });
    expect(getState().sessions).toHaveLength(8);
  });
});

// ============================================================================
// setClaudeSessionId
// ============================================================================

describe("setClaudeSessionId", () => {
  it("sets the claudeSessionId on an existing session", () => {
    addTestSession({ id: "s1" });
    getState().setClaudeSessionId("s1", "resume-uuid");
    expect(getState().sessions[0].claudeSessionId).toBe("resume-uuid");
  });

  it("overwrites a previous claudeSessionId", () => {
    getState().addSession({
      id: "s1",
      title: "T",
      folder: "/tmp",
      shell: "powershell",
      claudeSessionId: "old",
    });
    getState().setClaudeSessionId("s1", "new");
    expect(getState().sessions[0].claudeSessionId).toBe("new");
  });

  it("only updates the targeted session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().setClaudeSessionId("s2", "uuid-2");
    expect(getState().sessions.find((s) => s.id === "s1")?.claudeSessionId).toBeUndefined();
    expect(getState().sessions.find((s) => s.id === "s2")?.claudeSessionId).toBe("uuid-2");
  });

  it("is a no-op for a non-existent session ID", () => {
    addTestSession({ id: "s1" });
    getState().setClaudeSessionId("ghost", "uuid");
    expect(getState().sessions[0].claudeSessionId).toBeUndefined();
  });
});

// ============================================================================
// renameSession — extended
// ============================================================================

describe("renameSession — extended", () => {
  it("changes the title of an existing session", () => {
    addTestSession({ id: "s1", title: "Old" });
    getState().renameSession("s1", "New Title");
    expect(getState().sessions[0].title).toBe("New Title");
  });

  it("only renames the targeted session", () => {
    addTestSession({ id: "s1", title: "One" });
    addTestSession({ id: "s2", title: "Two" });
    getState().renameSession("s1", "Renamed");
    expect(getState().sessions.find((s) => s.id === "s2")?.title).toBe("Two");
  });

  it("is a no-op for a non-existent session ID", () => {
    addTestSession({ id: "s1", title: "Keep" });
    getState().renameSession("ghost", "Whatever");
    expect(getState().sessions[0].title).toBe("Keep");
  });

  it("accepts an empty title string", () => {
    addTestSession({ id: "s1", title: "Old" });
    getState().renameSession("s1", "");
    expect(getState().sessions[0].title).toBe("");
  });

  it("does not alter status or other fields", () => {
    addTestSession({ id: "s1", title: "Old" });
    getState().updateStatus("s1", "running");
    getState().renameSession("s1", "Renamed");
    expect(getState().sessions[0].status).toBe("running");
  });
});

// ============================================================================
// updateStatus — transition guard coverage
// ============================================================================

describe("updateStatus — transitions", () => {
  it("is a no-op when status is unchanged (same status)", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    const ref = getState().sessions;
    getState().updateStatus("s1", "running");
    // Skip-redundant-update path returns the same state object reference.
    expect(getState().sessions).toBe(ref);
  });

  it("allows starting → running → waiting forward transitions", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].status).toBe("running");
    getState().updateStatus("s1", "waiting");
    expect(getState().sessions[0].status).toBe("waiting");
  });

  it("allows waiting → running (back-and-forth before terminal)", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "waiting");
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].status).toBe("running");
  });

  it("error is terminal — updateStatus after error is a no-op", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "error");
    const finishedAt = getState().sessions[0].finishedAt;
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].status).toBe("error");
    expect(getState().sessions[0].finishedAt).toBe(finishedAt);
  });

  it("error → done is blocked (error is terminal)", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "error");
    getState().updateStatus("s1", "done");
    expect(getState().sessions[0].status).toBe("error");
  });

  it("clears finishedAt when moving running → waiting after a prior terminal-like field", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    expect(getState().sessions[0].finishedAt).toBeNull();
    getState().updateStatus("s1", "waiting");
    expect(getState().sessions[0].finishedAt).toBeNull();
  });

  it("only updates the targeted session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    expect(getState().sessions.find((s) => s.id === "s2")?.status).toBe("starting");
  });
});

// ============================================================================
// setExitCode — extended
// ============================================================================

describe("setExitCode — extended", () => {
  it("is ignored on an already-done session (terminal guard)", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("s1", 0);
    expect(getState().sessions[0].status).toBe("done");
    getState().setExitCode("s1", 1);
    // Terminal guard blocks the second call — stays done, exitCode 0.
    expect(getState().sessions[0].status).toBe("done");
    expect(getState().sessions[0].exitCode).toBe(0);
  });

  it("is ignored on an already-error session (terminal guard)", () => {
    addTestSession({ id: "s1" });
    getState().setExitCode("s1", 1);
    getState().setExitCode("s1", 0);
    expect(getState().sessions[0].status).toBe("error");
    expect(getState().sessions[0].exitCode).toBe(1);
  });

  it("works after a non-terminal status update (starting → running → exit)", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    getState().setExitCode("s1", 0);
    expect(getState().sessions[0].status).toBe("done");
  });

  it("sets finishedAt to approximately now", () => {
    addTestSession({ id: "s1" });
    const before = Date.now();
    getState().setExitCode("s1", 0);
    expect(getState().sessions[0].finishedAt!).toBeGreaterThanOrEqual(before);
  });

  it("only updates the targeted session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().setExitCode("s2", 1);
    expect(getState().sessions.find((s) => s.id === "s1")?.exitCode).toBeNull();
  });
});

// ============================================================================
// updateLastOutput — extended
// ============================================================================

describe("updateLastOutput — extended", () => {
  it("is a no-op for a non-existent session ID", () => {
    addTestSession({ id: "s1" });
    getState().updateLastOutput("ghost", "data");
    expect(getState().sessions[0].lastOutputSnippet).toBe("");
  });

  it("only updates the targeted session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateLastOutput("s2", "for s2");
    expect(getState().sessions.find((s) => s.id === "s1")?.lastOutputSnippet).toBe("");
    expect(getState().sessions.find((s) => s.id === "s2")?.lastOutputSnippet).toBe("for s2");
  });

  it("does not alter session status", () => {
    addTestSession({ id: "s1" });
    getState().updateStatus("s1", "running");
    getState().updateLastOutput("s1", "output");
    expect(getState().sessions[0].status).toBe("running");
  });

  it("advances lastOutputAt on each call", () => {
    addTestSession({ id: "s1" });
    getState().updateLastOutput("s1", "first");
    const t1 = getState().sessions[0].lastOutputAt;
    getState().updateLastOutput("s1", "second");
    const t2 = getState().sessions[0].lastOutputAt;
    expect(t2).toBeGreaterThanOrEqual(t1);
  });
});

// ============================================================================
// setActiveSession — extended
// ============================================================================

describe("setActiveSession — extended", () => {
  it("preserves activeSessionId when targeting a non-existent ID", () => {
    addTestSession({ id: "s1" });
    getState().setActiveSession("s1");
    getState().setActiveSession("ghost");
    expect(getState().activeSessionId).toBe("s1");
  });

  it("can re-select the already-active session (idempotent)", () => {
    addTestSession({ id: "s1" });
    getState().setActiveSession("s1");
    getState().setActiveSession("s1");
    expect(getState().activeSessionId).toBe("s1");
  });
});

// ============================================================================
// setLayoutMode — extended
// ============================================================================

describe("setLayoutMode — extended", () => {
  it("includes 'starting' sessions in grid auto-fill", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    // both still "starting"
    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toEqual(
      expect.arrayContaining(["s1", "s2"])
    );
  });

  it("excludes done/error sessions from grid auto-fill", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "done");
    getState().setActiveSession("s1");
    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).toContain("s1");
    expect(getState().gridSessionIds).not.toContain("s2");
  });

  it("refuses to enter grid mode when there are no candidate sessions (deadlock guard)", () => {
    // Without this guard, setLayoutMode('grid') with zero sessions AND null
    // activeSessionId would land in layoutMode='grid' with gridSessionIds=[].
    // That UI state renders no terminals and can only be left via the toolbar
    // toggle — a dead-end. Stay in single instead; the next addSession will
    // land naturally there and the user can opt into grid when they have
    // something to grid.
    expect(getState().layoutMode).toBe("single");
    getState().setLayoutMode("grid");
    expect(getState().layoutMode).toBe("single");
    expect(getState().gridSessionIds).toEqual([]);
    expect(getState().focusedGridSessionId).toBeNull();
  });

  it("sets focusedGridSessionId to activeSessionId when active is in the auto-filled grid", () => {
    // Focus-pick hierarchy puts activeSessionId first — that's the session the
    // user was just viewing in single mode and the strongest intent signal.
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "running");
    // addTestSession leaves activeSessionId on the last-added session (s2).
    getState().setLayoutMode("grid");
    expect(getState().focusedGridSessionId).toBe("s2");
  });

  it("falls back to first grid slot when activeSessionId is not in the auto-filled grid", () => {
    // Edge case for the focus-pick hierarchy: active session exists but isn't
    // one of the auto-filled grid members (e.g., it's a done session that got
    // skipped by the running/waiting/starting filter). focusedGridSessionId
    // must then fall through to the previous-grid-focus tier, and finally to
    // candidates[0]. Both fallback tiers are empty here → first slot wins.
    addTestSession({ id: "active-done" });
    addTestSession({ id: "running-1" });
    addTestSession({ id: "running-2" });
    getState().updateStatus("active-done", "done"); // excluded from auto-fill
    getState().updateStatus("running-1", "running");
    getState().updateStatus("running-2", "running");
    getState().setActiveSession("active-done");

    getState().setLayoutMode("grid");
    expect(getState().gridSessionIds).not.toContain("active-done");
    expect(getState().focusedGridSessionId).toBe(getState().gridSessionIds[0]);
  });

  it("does not touch gridSessionIds when switching to 'single'", () => {
    addTestSession({ id: "s1" });
    getState().addToGrid("s1");
    getState().setLayoutMode("single");
    expect(getState().gridSessionIds).toEqual(["s1"]);
  });
});

// ============================================================================
// addToGrid / removeFromGrid — extended
// ============================================================================

describe("addToGrid — extended", () => {
  it("does not change focusedGridSessionId when a duplicate add is rejected", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().addToGrid("s1"); // duplicate — rejected
    expect(getState().focusedGridSessionId).toBe("s2");
  });

  it("does not change focus when 5th add is rejected by the cap", () => {
    for (let i = 1; i <= 4; i++) {
      addTestSession({ id: `s${i}` });
      getState().addToGrid(`s${i}`);
    }
    expect(getState().focusedGridSessionId).toBe("s4");
    addTestSession({ id: "s5" });
    getState().addToGrid("s5");
    expect(getState().focusedGridSessionId).toBe("s4");
  });
});

describe("removeFromGrid — extended", () => {
  it("keeps focusedGridSessionId when a non-focused session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    // s2 focused; remove s1
    getState().removeFromGrid("s1");
    expect(getState().focusedGridSessionId).toBe("s2");
  });

  it("sets focusedGridSessionId to null when the last grid session is removed", () => {
    addTestSession({ id: "s1" });
    getState().addToGrid("s1");
    getState().removeFromGrid("s1");
    expect(getState().focusedGridSessionId).toBeNull();
  });

  it("does not switch to 'single' if grid still has sessions", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().setLayoutMode("grid");
    getState().removeFromGrid("s1");
    expect(getState().layoutMode).toBe("grid");
  });
});

// ============================================================================
// maximizeGridSession — extended
// ============================================================================

describe("maximizeGridSession — extended", () => {
  it("leaves gridSessionIds intact", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().maximizeGridSession("s1");
    expect(getState().gridSessionIds).toEqual(["s1", "s2"]);
  });

  it("can set activeSessionId to an ID not present in sessions (no validation)", () => {
    getState().maximizeGridSession("anything");
    expect(getState().activeSessionId).toBe("anything");
    expect(getState().layoutMode).toBe("single");
  });
});

// ============================================================================
// removeSession — layout/active interaction
// ============================================================================

describe("removeSession — layout interaction", () => {
  it("reverts layoutMode to 'single' when removing the last grid session", () => {
    addTestSession({ id: "s1" });
    getState().addToGrid("s1");
    getState().setLayoutMode("grid");
    getState().removeSession("s1");
    expect(getState().layoutMode).toBe("single");
  });

  it("keeps layoutMode 'grid' when other grid sessions remain", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().setLayoutMode("grid");
    getState().removeSession("s1");
    expect(getState().layoutMode).toBe("grid");
  });

  it("moves focusedGridSessionId to first remaining grid session", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().setFocusedGridSession("s2");
    getState().removeSession("s2");
    expect(getState().focusedGridSessionId).toBe("s1");
  });

  it("does not alter focusedGridSessionId when a non-focused session is removed", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    getState().addToGrid("s1");
    getState().addToGrid("s2");
    getState().setFocusedGridSession("s1");
    getState().removeSession("s2");
    expect(getState().focusedGridSessionId).toBe("s1");
  });
});

// ============================================================================
// selectSessionCounts — extended
// ============================================================================

describe("selectSessionCounts — extended", () => {
  it("counts multiple sessions of the same status", () => {
    for (let i = 0; i < 3; i++) {
      addTestSession({ id: `s${i}` });
      getState().updateStatus(`s${i}`, "running");
    }
    expect(selectSessionCounts(getState()).active).toBe(3);
  });

  it("counts mixed 'starting' and 'running' together as active", () => {
    addTestSession({ id: "s1" }); // starting
    addTestSession({ id: "s2" });
    getState().updateStatus("s2", "running");
    expect(selectSessionCounts(getState()).active).toBe(2);
  });

  it("does not count waiting/done/error as active", () => {
    addTestSession({ id: "s1" });
    addTestSession({ id: "s2" });
    addTestSession({ id: "s3" });
    getState().updateStatus("s1", "waiting");
    getState().updateStatus("s2", "done");
    getState().updateStatus("s3", "error");
    expect(selectSessionCounts(getState()).active).toBe(0);
  });

  it("total reflects every session regardless of status", () => {
    for (let i = 0; i < 5; i++) addTestSession({ id: `s${i}` });
    expect(selectSessionCounts(getState()).total).toBe(5);
  });
});

// ============================================================================
// reorderSessions
// ============================================================================

describe("reorderSessions", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [] });
  });

  it("reorders sessions by id array", () => {
    useSessionStore.setState({
      sessions: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s1", folder: "/a", title: "S1" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s2", folder: "/b", title: "S2" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s3", folder: "/c", title: "S3" } as any,
      ],
    });
    useSessionStore.getState().reorderSessions(["s3", "s1", "s2"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(useSessionStore.getState().sessions.map((s: any) => s.id))
      .toEqual(["s3", "s1", "s2"]);
  });

  it("appends ids not in orderedIds at the end", () => {
    useSessionStore.setState({
      sessions: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s1" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s2" } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: "s3" } as any,
      ],
    });
    useSessionStore.getState().reorderSessions(["s2"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(useSessionStore.getState().sessions.map((s: any) => s.id))
      .toEqual(["s2", "s1", "s3"]);
  });

  it("drops unknown ids gracefully", () => {
    useSessionStore.setState({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions: [{ id: "s1" } as any],
    });
    useSessionStore.getState().reorderSessions(["ghost", "s1"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(useSessionStore.getState().sessions.map((s: any) => s.id))
      .toEqual(["s1"]);
  });

  it("is a no-op when orderedIds is empty", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessions = [{ id: "s1" } as any, { id: "s2" } as any];
    useSessionStore.setState({ sessions });
    useSessionStore.getState().reorderSessions([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(useSessionStore.getState().sessions.map((s: any) => s.id))
      .toEqual(["s1", "s2"]);
  });
});
