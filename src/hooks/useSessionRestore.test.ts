import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock @tauri-apps/api/core BEFORE importing the hook (hoisted)
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useSessionRestore } from "./useSessionRestore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUIStore } from "../store/uiStore";

const mockInvoke = vi.mocked(invoke);

interface ScanResult {
  session_id: string;
  started_at: string;
}

/**
 * Build a configurable invoke mock:
 *  - `create_session` echoes back the params with the chosen id/title/folder/shell
 *  - `scan_claude_sessions` returns the provided history per folder
 *  - other commands resolve to `undefined` (treated as no-op)
 */
function setupInvokeMock(historyPerFolder: Record<string, ScanResult[]> = {}) {
  // Tauri's invoke types `args` as `InvokeArgs` (which includes Uint8Array,
  // number[], etc.). For our tests every command takes a plain object, so we
  // narrow defensively at the call site.
  mockInvoke.mockImplementation((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === "create_session") {
      return Promise.resolve({
        id: a.id as string,
        title: a.title as string,
        folder: a.folder as string,
        shell: a.shell as string,
      });
    }
    if (cmd === "scan_claude_sessions") {
      const folder = a.folder as string;
      return Promise.resolve(historyPerFolder[folder] ?? []);
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    layoutMode: "single",
    gridSessionIds: [],
    focusedGridSessionId: null,
  });
  // Toasts + UI store reset
  useUIStore.setState({ toasts: [] });
});

describe("useSessionRestore — claim-set fallback", () => {
  it("assigns distinct claudeSessionIds when persisted entries lack them", async () => {
    // Repro the user's bug: 3 cards persisted with same folder + title, no
    // claudeSessionId. scan_claude_sessions returns 3 distinct UUIDs.
    const folder = "C:/proj/m2";
    setupInvokeMock({
      [folder]: [
        { session_id: "uuid-newest", started_at: "2026-01-03T10:00:00Z" },
        { session_id: "uuid-mid", started_at: "2026-01-02T10:00:00Z" },
        { session_id: "uuid-oldest", started_at: "2026-01-01T10:00:00Z" },
      ],
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder, title: "m2", shell: "powershell" },
          { folder, title: "m2", shell: "powershell" },
          { folder, title: "m2", shell: "powershell" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });

    const restoredIds = useSessionStore
      .getState()
      .sessions.map((s) => s.claudeSessionId)
      .sort();
    // Expect each card to have latched onto a different UUID — no duplicates.
    expect(restoredIds).toEqual(["uuid-mid", "uuid-newest", "uuid-oldest"]);
    expect(new Set(restoredIds).size).toBe(3);
  });

  it("drops a duplicate persisted claudeSessionId and falls back to scan", async () => {
    // Defense for old persisted state from before Fix 1: two entries carry
    // the same UUID. The second should drop the resume hint and pick the
    // next-newest UUID from history.
    const folder = "C:/proj/m2";
    setupInvokeMock({
      [folder]: [
        { session_id: "uuid-A", started_at: "2026-01-02T10:00:00Z" },
        { session_id: "uuid-B", started_at: "2026-01-01T10:00:00Z" },
      ],
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder, title: "m2", shell: "powershell", claudeSessionId: "uuid-A" },
          { folder, title: "m2", shell: "powershell", claudeSessionId: "uuid-A" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    const restoredIds = useSessionStore.getState().sessions.map((s) => s.claudeSessionId);
    // First entry uses uuid-A (its persisted hint). Second entry drops the
    // duplicate hint, scans, and picks uuid-B (next-newest unclaimed).
    expect(restoredIds).toEqual(["uuid-A", "uuid-B"]);
  });

  it("falls back to fresh-spawn (undefined claudeSessionId) when scan is exhausted", async () => {
    // 3 entries to restore, but only 2 UUIDs in history. The 3rd must spawn
    // fresh (claudeSessionId = undefined) instead of recycling history[0].
    const folder = "C:/proj/m2";
    setupInvokeMock({
      [folder]: [
        { session_id: "uuid-1", started_at: "2026-01-02T10:00:00Z" },
        { session_id: "uuid-2", started_at: "2026-01-01T10:00:00Z" },
      ],
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder, title: "m2", shell: "powershell" },
          { folder, title: "m2", shell: "powershell" },
          { folder, title: "m2", shell: "powershell" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });

    const restoredIds = useSessionStore.getState().sessions.map((s) => s.claudeSessionId);
    // Array.sort() places undefined last per spec — that's how we line them up.
    expect(restoredIds.sort()).toEqual(["uuid-1", "uuid-2", undefined]);
  });

  it("preserves persisted claudeSessionIds when they are already distinct", async () => {
    // Sanity check for the happy path: post-Fix-1 state. All entries carry
    // distinct UUIDs, no scan needed, claim-set never blocks anything.
    const folder = "C:/proj/m2";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder, title: "m2", shell: "powershell", claudeSessionId: "uuid-1" },
          { folder, title: "m2", shell: "powershell", claudeSessionId: "uuid-2" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    const restoredIds = useSessionStore.getState().sessions.map((s) => s.claudeSessionId);
    expect(restoredIds).toEqual(["uuid-1", "uuid-2"]);
    // scan_claude_sessions is the expensive Tauri call — it should NOT have
    // been invoked when both entries had a usable claudeSessionId.
    const scanCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "scan_claude_sessions");
    expect(scanCalls).toHaveLength(0);
  });
});

describe("useSessionRestore — guard conditions", () => {
  it("does nothing when sessionRestore is disabled", async () => {
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: false,
        sessions: [{ folder: "C:/proj/a", title: "a", shell: "powershell" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    // Give any pending microtasks a chance to flush.
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it("does nothing when there are no persisted sessions", async () => {
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  it("runs the restore effect only once even across re-renders", async () => {
    const folder = "C:/proj/once";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder, title: "once", shell: "powershell", claudeSessionId: "u1" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    const { rerender } = renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });

    rerender();
    rerender();
    await Promise.resolve();

    // Only one create_session call — didRun guard blocks repeat restores.
    const createCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "create_session");
    expect(createCalls).toHaveLength(1);
  });
});

describe("useSessionRestore — MAX_SESSIONS cap", () => {
  it("restores at most 8 sessions even when more are persisted", async () => {
    setupInvokeMock();
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      folder: `C:/proj/cap-${i}`,
      title: `cap-${i}`,
      shell: "powershell" as const,
      claudeSessionId: `uuid-${i}`,
    }));
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions,
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(8);
    });
    // The 9th..12th entries are sliced off and never reach the backend.
    const createCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "create_session");
    expect(createCalls).toHaveLength(8);
  });
});

describe("useSessionRestore — error handling + toasts", () => {
  it("skips a session whose create_session fails and toasts the partial result", async () => {
    const okFolder = "C:/proj/ok";
    const badFolder = "C:/proj/bad";
    mockInvoke.mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === "scan_claude_sessions") return Promise.resolve([]);
      if (cmd === "create_session") {
        if (a.folder === badFolder) return Promise.reject(new Error("spawn failed"));
        return Promise.resolve({
          id: a.id as string,
          title: a.title as string,
          folder: a.folder as string,
          shell: a.shell as string,
        });
      }
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: okFolder, title: "ok", shell: "powershell" },
          { folder: badFolder, title: "bad", shell: "powershell" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    await waitFor(() => {
      expect(useUIStore.getState().toasts).toHaveLength(1);
    });

    const toast = useUIStore.getState().toasts[0];
    expect(toast.type).toBe("info");
    expect(toast.title).toBe("1 von 2 Sessions wiederhergestellt");
    expect(toast.message).toContain("bad");
  });

  it("emits a success toast (singular) when exactly one session restores", async () => {
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder: "C:/proj/solo", title: "solo", shell: "powershell", claudeSessionId: "u" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toHaveLength(1);
    });
    const toast = useUIStore.getState().toasts[0];
    expect(toast.type).toBe("success");
    expect(toast.title).toBe("1 Session wiederhergestellt");
  });

  it("emits a success toast (plural) when multiple sessions restore", async () => {
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/proj/p1", title: "p1", shell: "powershell", claudeSessionId: "u1" },
          { folder: "C:/proj/p2", title: "p2", shell: "powershell", claudeSessionId: "u2" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toHaveLength(1);
    });
    expect(useUIStore.getState().toasts[0].title).toBe("2 Sessions wiederhergestellt");
  });

  it("does not toast when every session fails to restore", async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([]);
      if (cmd === "create_session") return Promise.reject(new Error("all dead"));
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder: "C:/proj/x", title: "x", shell: "powershell" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    // Wait for the create attempt to settle.
    await waitFor(() => {
      const calls = mockInvoke.mock.calls.filter(([cmd]) => cmd === "create_session");
      expect(calls).toHaveLength(1);
    });
    await Promise.resolve();
    // createdIds is empty → early return before any toast.
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("continues restoring when scan_claude_sessions throws (non-critical)", async () => {
    const folder = "C:/proj/scanfail";
    mockInvoke.mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === "scan_claude_sessions") return Promise.reject(new Error("disk error"));
      if (cmd === "create_session") {
        return Promise.resolve({
          id: a.id as string,
          title: a.title as string,
          folder: a.folder as string,
          shell: a.shell as string,
        });
      }
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder, title: "scanfail", shell: "powershell" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    // Scan failed → fresh spawn, claudeSessionId stays undefined.
    expect(useSessionStore.getState().sessions[0].claudeSessionId).toBeUndefined();
  });
});

describe("useSessionRestore — layout + active restoration", () => {
  it("restores grid layout mode and adds grid folders", async () => {
    const f1 = "C:/proj/g1";
    const f2 = "C:/proj/g2";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: f1, title: "g1", shell: "powershell", claudeSessionId: "u1" },
          { folder: f2, title: "g2", shell: "powershell", claudeSessionId: "u2" },
        ],
        activeFolder: null,
        layoutMode: "grid",
        gridFolders: [f1, f2],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });
    await waitFor(() => {
      expect(useSessionStore.getState().layoutMode).toBe("grid");
    });
    expect(useSessionStore.getState().gridSessionIds).toHaveLength(2);
  });

  it("stays in single layout when layoutMode is grid but gridFolders is empty", async () => {
    const f1 = "C:/proj/sg1";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder: f1, title: "sg1", shell: "powershell", claudeSessionId: "u1" }],
        activeFolder: null,
        layoutMode: "grid",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    await Promise.resolve();
    // grid branch is guarded by gridFolders.length > 0 → no switch.
    expect(useSessionStore.getState().layoutMode).toBe("single");
  });

  it("restores the active session from activeFolder", async () => {
    const f1 = "C:/proj/a1";
    const f2 = "C:/proj/a2";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: f1, title: "a1", shell: "powershell", claudeSessionId: "u1" },
          { folder: f2, title: "a2", shell: "powershell", claudeSessionId: "u2" },
        ],
        activeFolder: f2,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().activeSessionId).not.toBeNull();
    });
    const activeId = useSessionStore.getState().activeSessionId;
    const activeSession = useSessionStore.getState().sessions.find((s) => s.id === activeId);
    expect(activeSession?.folder).toBe(f2);
  });

  it("ignores an activeFolder that maps to no restored session", async () => {
    const f1 = "C:/proj/known";
    const f2 = "C:/proj/also-known";
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: f1, title: "known", shell: "powershell", claudeSessionId: "u1" },
          { folder: f2, title: "also-known", shell: "powershell", claudeSessionId: "u2" },
        ],
        activeFolder: "C:/proj/never-restored",
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });
    await Promise.resolve();
    // activeFolder maps to nothing → setActiveSession is never called by the
    // restore logic. The active id therefore stays whatever addSession left
    // it (the last-added session), never the missing folder's session.
    const activeId = useSessionStore.getState().activeSessionId;
    const activeSession = useSessionStore.getState().sessions.find((s) => s.id === activeId);
    expect(activeSession?.folder).not.toBe("C:/proj/never-restored");
    expect(activeSession?.folder).toBe(f2);
  });
});

describe("useSessionRestore — session field mapping", () => {
  it("persisted title wins over the backend response title", async () => {
    const folder = "C:/proj/rename";
    mockInvoke.mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === "scan_claude_sessions") return Promise.resolve([]);
      if (cmd === "create_session") {
        // Backend returns a different title than the persisted one.
        return Promise.resolve({
          id: a.id as string,
          title: "Backend Title",
          folder: a.folder as string,
          shell: a.shell as string,
        });
      }
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder, title: "Mein Umbenannter Titel", shell: "powershell", claudeSessionId: "u1" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    expect(useSessionStore.getState().sessions[0].title).toBe("Mein Umbenannter Titel");
  });

  it("assigns a unique displayId to each restored session", async () => {
    setupInvokeMock();
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "C:/proj/d1", title: "d1", shell: "powershell", claudeSessionId: "u1" },
          { folder: "C:/proj/d2", title: "d2", shell: "powershell", claudeSessionId: "u2" },
          { folder: "C:/proj/d3", title: "d3", shell: "powershell", claudeSessionId: "u3" },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });
    const displayIds = useSessionStore.getState().sessions.map((s) => s.displayId);
    expect(new Set(displayIds).size).toBe(3);
  });

  it("falls back to the generated id when create_session result lacks an id", async () => {
    const folder = "C:/proj/noid";
    mockInvoke.mockImplementation((cmd, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (cmd === "scan_claude_sessions") return Promise.resolve([]);
      if (cmd === "create_session") {
        // Result with no id field → hook falls back to the locally generated id.
        return Promise.resolve({
          title: a.title as string,
          folder: a.folder as string,
          shell: a.shell as string,
        });
      }
      return Promise.resolve(undefined);
    });
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [{ folder, title: "noid", shell: "powershell", claudeSessionId: "u1" }],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });
    // A non-empty id was still assigned (the locally generated session-* id).
    expect(useSessionStore.getState().sessions[0].id).toMatch(/^session-/);
  });
});
