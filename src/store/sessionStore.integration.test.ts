/**
 * Integration tests for the session status pipeline.
 *
 * Verifies the full state machine: addSession → transitions → terminal states.
 * Specifically covers the backward-transition guard added in #223.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  useSessionStore,
  selectSessionCounts,
  type SessionState,
  type SessionShell,
} from "./sessionStore";

// ============================================================================
// Helpers
// ============================================================================

function getState(): SessionState {
  return useSessionStore.getState();
}

const DEFAULT_SESSION = {
  id: "test-session-001",
  title: "Integration Test Session",
  folder: "C:/projects/test",
  shell: "powershell" as SessionShell,
};

function addSession(overrides?: Partial<typeof DEFAULT_SESSION>) {
  getState().addSession({ ...DEFAULT_SESSION, ...overrides });
}

// ============================================================================
// Reset
// ============================================================================

beforeEach(() => {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    layoutMode: "single",
    gridSessionIds: [],
    focusedGridSessionId: null,
  });
});

// ============================================================================
// 1. Initial status
// ============================================================================

describe("addSession", () => {
  it("sets initial status to 'starting'", () => {
    addSession();
    const session = getState().sessions[0];
    expect(session.status).toBe("starting");
    expect(session.finishedAt).toBeNull();
  });
});

// ============================================================================
// 2. Forward transitions
// ============================================================================

describe("forward transitions", () => {
  it("starting → running clears finishedAt", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "running");
    const s = getState().sessions[0];
    expect(s.status).toBe("running");
    expect(s.finishedAt).toBeNull();
  });

  it("starting → waiting clears finishedAt", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "waiting");
    const s = getState().sessions[0];
    expect(s.status).toBe("waiting");
    expect(s.finishedAt).toBeNull();
  });

  it("running → waiting and back to running is allowed", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "running");
    getState().updateStatus(DEFAULT_SESSION.id, "waiting");
    getState().updateStatus(DEFAULT_SESSION.id, "running");
    expect(getState().sessions[0].status).toBe("running");
  });

  it("setExitCode 0 → done with finishedAt set", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "running");
    getState().setExitCode(DEFAULT_SESSION.id, 0);
    const s = getState().sessions[0];
    expect(s.status).toBe("done");
    expect(s.exitCode).toBe(0);
    expect(s.finishedAt).toBeTypeOf("number");
  });

  it("setExitCode non-zero → error with finishedAt set", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "running");
    getState().setExitCode(DEFAULT_SESSION.id, 1);
    const s = getState().sessions[0];
    expect(s.status).toBe("error");
    expect(s.exitCode).toBe(1);
    expect(s.finishedAt).toBeTypeOf("number");
  });
});

// ============================================================================
// 3. Terminal-state guard (#223)
// ============================================================================

describe("transition guard — terminal states are final", () => {
  it("updateStatus after done is a no-op", () => {
    addSession();
    getState().setExitCode(DEFAULT_SESSION.id, 0);
    expect(getState().sessions[0].status).toBe("done");

    const finishedAtBefore = getState().sessions[0].finishedAt;
    getState().updateStatus(DEFAULT_SESSION.id, "running");

    const s = getState().sessions[0];
    expect(s.status).toBe("done");
    expect(s.finishedAt).toBe(finishedAtBefore);
  });

  it("updateStatus after error is a no-op", () => {
    addSession();
    getState().setExitCode(DEFAULT_SESSION.id, 137);
    expect(getState().sessions[0].status).toBe("error");

    getState().updateStatus(DEFAULT_SESSION.id, "running");
    expect(getState().sessions[0].status).toBe("error");
  });

  it("setExitCode after done is a no-op — preserves original exit code", () => {
    addSession();
    getState().setExitCode(DEFAULT_SESSION.id, 0);
    const firstFinishedAt = getState().sessions[0].finishedAt;

    getState().setExitCode(DEFAULT_SESSION.id, 1);

    const s = getState().sessions[0];
    expect(s.status).toBe("done");
    expect(s.exitCode).toBe(0);
    expect(s.finishedAt).toBe(firstFinishedAt);
  });

  it("done→running→done bounce does NOT change status", () => {
    addSession();
    getState().setExitCode(DEFAULT_SESSION.id, 0);
    getState().updateStatus(DEFAULT_SESSION.id, "running"); // stale backend event
    getState().updateStatus(DEFAULT_SESSION.id, "done");    // another stale event
    expect(getState().sessions[0].status).toBe("done");
  });
});

// ============================================================================
// 4. Legitimate edge cases
// ============================================================================

describe("legitimate transitions", () => {
  it("starting → waiting directly (backend can skip running)", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "waiting");
    expect(getState().sessions[0].status).toBe("waiting");
  });

  it("starting → done directly (fast exit)", () => {
    addSession();
    getState().updateStatus(DEFAULT_SESSION.id, "done");
    expect(getState().sessions[0].status).toBe("done");
  });
});

// ============================================================================
// 5. selectSessionCounts consistency
// ============================================================================

describe("selectSessionCounts", () => {
  it("reflects correct buckets across multiple sessions", () => {
    addSession({ id: "s1" });
    addSession({ id: "s2" });
    addSession({ id: "s3" });
    addSession({ id: "s4" });

    getState().updateStatus("s1", "running");
    getState().updateStatus("s2", "waiting");
    getState().setExitCode("s3", 0);
    getState().setExitCode("s4", 1);

    const counts = selectSessionCounts(getState());
    expect(counts.active).toBe(1);
    expect(counts.waiting).toBe(1);
    expect(counts.done).toBe(1);
    expect(counts.error).toBe(1);
    expect(counts.total).toBe(4);
  });

  it("done session stays in done bucket after stale running event", () => {
    addSession({ id: "s1" });
    getState().setExitCode("s1", 0);
    getState().updateStatus("s1", "running"); // stale event — guard blocks it

    const counts = selectSessionCounts(getState());
    expect(counts.active).toBe(0);
    expect(counts.done).toBe(1);
  });
});
