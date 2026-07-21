import { describe, it, expect, beforeEach, vi } from "vitest";
import { dedupRestorableSessions, initSessionRestoreSync } from "./sessionRestoreSync";
import { useSessionStore, type ClaudeSession } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";

function makeSession(overrides: Partial<ClaudeSession>): ClaudeSession {
  return {
    id: "s-default",
    title: "Test",
    folder: "C:/projects/x",
    shell: "powershell",
    status: "running",
    createdAt: 0,
    finishedAt: null,
    exitCode: null,
    lastOutputAt: 0,
    lastOutputSnippet: "",
    ...overrides,
  };
}

describe("dedupRestorableSessions", () => {
  it("returns empty array for empty input", () => {
    expect(dedupRestorableSessions([])).toEqual([]);
  });

  it("preserves all sessions when claudeSessionIds are unique", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", claudeSessionId: "uuid-1" }),
      makeSession({ id: "s2", title: "m2", claudeSessionId: "uuid-2" }),
      makeSession({ id: "s3", title: "m2", claudeSessionId: "uuid-3" }),
    ]);

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.claudeSessionId)).toEqual(["uuid-1", "uuid-2", "uuid-3"]);
  });

  it("collapses cards that share the same claudeSessionId — first card wins", () => {
    // The exact bug-state: 3 frontend cards latched onto the same backend
    // session via the discovery race. Only one should be persisted.
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
      makeSession({ id: "s2", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
      makeSession({ id: "s3", title: "m2", folder: "C:/proj/m2", claudeSessionId: "uuid-shared" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].claudeSessionId).toBe("uuid-shared");
    expect(result[0].folder).toBe("C:/proj/m2");
  });

  it("keeps the first occurrence and drops later duplicates", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "first", claudeSessionId: "uuid-A" }),
      makeSession({ id: "s2", title: "second", claudeSessionId: "uuid-B" }),
      makeSession({ id: "s3", title: "duplicate-of-first", claudeSessionId: "uuid-A" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("first");
    expect(result[1].title).toBe("second");
  });

  it("carries createdAt into the persisted snapshot (restore-scan time anchor)", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", createdAt: 1_751_364_000_000 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBe(1_751_364_000_000);
  });

  it("carries permissionMode into the persisted snapshot (Restart-Treue über App-Neustarts)", () => {
    // Ohne dieses Feld überlebte der Session-eigene Permission-Mode keinen
    // App-Neustart — Restore stempelte still den aktuellen Settings-Default.
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", permissionMode: "plan" }),
      makeSession({ id: "s2", title: "legacy", folder: "C:/proj/legacy" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].permissionMode).toBe("plan");
    expect(result[1].permissionMode).toBeUndefined();
  });

  it("never deduplicates sessions without a claudeSessionId — even if folder matches", () => {
    // Two fresh sessions in the same folder before discovery has run are
    // legitimately distinct. The restore-side claim set assigns distinct
    // UUIDs on the next start.
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "m2", folder: "C:/proj/m2", claudeSessionId: undefined }),
      makeSession({ id: "s2", title: "m2", folder: "C:/proj/m2", claudeSessionId: undefined }),
    ]);

    expect(result).toHaveLength(2);
  });

  it("mixes deduped (with id) and preserved (without id) entries correctly", () => {
    const result = dedupRestorableSessions([
      makeSession({ id: "s1", title: "discovered", claudeSessionId: "uuid-X" }),
      makeSession({ id: "s2", title: "fresh-1", claudeSessionId: undefined }),
      makeSession({ id: "s3", title: "discovered-dup", claudeSessionId: "uuid-X" }),
      makeSession({ id: "s4", title: "fresh-2", claudeSessionId: undefined }),
    ]);

    // s3 dropped (duplicate of s1); s2 and s4 both kept.
    expect(result.map((r) => r.title)).toEqual(["discovered", "fresh-1", "fresh-2"]);
  });

  it("strips frontend-only fields (id, status, lastOutput*) from persisted shape", () => {
    const result = dedupRestorableSessions([
      makeSession({
        id: "s-frontend-only",
        title: "m2",
        folder: "C:/proj/m2",
        shell: "powershell",
        claudeSessionId: "uuid-1",
        permissionMode: "plan",
        status: "running",
        lastOutputAt: 12345,
        lastOutputSnippet: "secret content",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]).sort()).toEqual(
      ["claudeSessionId", "createdAt", "folder", "permissionMode", "shell", "title"].sort(),
    );
  });
});

describe("initSessionRestoreSync activeFolder change detection", () => {
  beforeEach(() => {
    vi.stubEnv("MODE", "test");
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s1", folder: "C:/proj/a", claudeSessionId: "uuid-1" }),
        makeSession({ id: "s2", folder: "C:/proj/b", claudeSessionId: "uuid-2" }),
      ],
      activeSessionId: "s1",
      gridSessionIds: [],
      layoutMode: "single",
    });
  });

  it("persists the new activeFolder when only the active session switches", () => {
    const unsub = initSessionRestoreSync();
    // Switching active session changes nothing in sessions/layoutMode/gridFolders
    // — the activeFolder MUST still be written (was the bug: identical json guard).
    useSessionStore.setState({ activeSessionId: "s2" });
    expect(useSettingsStore.getState().sessionRestore.activeFolder).toBe("C:/proj/b");
    unsub();
  });

  it("does not re-persist when nothing relevant changes (no-op guard holds)", () => {
    const unsub = initSessionRestoreSync();
    // The first subscriber fire after init always writes (lastJson starts "").
    // Establish that baseline, THEN spy, so we measure only the no-op re-set.
    useSessionStore.setState({ activeSessionId: "s1" });
    const setSpy = vi.spyOn(useSettingsStore.getState(), "setSessionRestore");
    // Re-set the SAME active session id — no relevant field changes.
    useSessionStore.setState({ activeSessionId: "s1" });
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
    unsub();
  });
});
