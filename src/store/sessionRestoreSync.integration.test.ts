/**
 * Layer-B integration tests for sessionRestoreSync (Test ID B3.1).
 *
 * Uses REAL useSessionStore + useSettingsStore — no `vi.mock()` of any
 * production module. The persist-side subscriber `initSessionRestoreSync()`
 * observes sessionStore mutations and writes a normalized snapshot into
 * settingsStore. These tests exercise that wiring end-to-end.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 3)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initSessionRestoreSync } from "./sessionRestoreSync";
import { useSessionStore } from "./sessionStore";
import { useSettingsStore } from "./settingsStore";
import { resetAllStores } from "../test/storeReset";

describe("sessionRestoreSync — Layer-B integration", () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    resetAllStores();
    unsubscribe = initSessionRestoreSync();
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  // -------------------------------------------------------------------------
  // GREEN today — dedup, persisted shape, dead-session filtering
  // -------------------------------------------------------------------------

  it("dedup: 3 alive sessions sharing claudeSessionId — only 1 in persisted snapshot", () => {
    const sharedClaudeId = "11111111-1111-4111-8111-111111111111";
    const session = useSessionStore.getState();

    session.addSession({
      id: "card-1",
      title: "First",
      folder: "C:\\proj\\a",
      shell: "powershell",
      claudeSessionId: sharedClaudeId,
    });
    session.addSession({
      id: "card-2",
      title: "Second",
      folder: "C:\\proj\\b",
      shell: "powershell",
      claudeSessionId: sharedClaudeId,
    });
    session.addSession({
      id: "card-3",
      title: "Third",
      folder: "C:\\proj\\c",
      shell: "powershell",
      claudeSessionId: sharedClaudeId,
    });

    const persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].claudeSessionId).toBe(sharedClaudeId);
    // First card with the UUID wins — title "First" must be the survivor.
    expect(persisted[0].title).toBe("First");
    expect(persisted[0].folder).toBe("C:\\proj\\a");
  });

  it("dedup: alive sessions WITHOUT claudeSessionId are kept (legitimate parallel sessions)", () => {
    const session = useSessionStore.getState();

    session.addSession({
      id: "card-1",
      title: "Untracked A",
      folder: "C:\\proj\\a",
      shell: "powershell",
    });
    session.addSession({
      id: "card-2",
      title: "Untracked B",
      folder: "C:\\proj\\a", // same folder + shell, no claudeSessionId
      shell: "powershell",
    });
    session.addSession({
      id: "card-3",
      title: "Untracked C",
      folder: "C:\\proj\\b",
      shell: "cmd",
    });

    const persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(3);
    expect(persisted.map((s) => s.title)).toEqual([
      "Untracked A",
      "Untracked B",
      "Untracked C",
    ]);
    // None of them have claudeSessionId set yet — discovery race not done.
    for (const s of persisted) {
      expect(s.claudeSessionId).toBeUndefined();
    }
  });

  // createdAt moved from "forbidden" to "allowed": it is the time anchor the
  // restore-side scan fallback needs to resume the RIGHT session when no
  // claudeSessionId was persisted (wrong-session-restore fix). It is a plain
  // epoch timestamp — no content leak, unlike lastOutputSnippet.
  it("persisted shape ONLY has folder, title, shell, claudeSessionId, createdAt — never lastOutputSnippet etc.", () => {
    const session = useSessionStore.getState();

    session.addSession({
      id: "card-1",
      title: "Shape Test",
      folder: "C:\\proj\\shape",
      shell: "gitbash",
      claudeSessionId: "22222222-2222-4222-8222-222222222222",
    });

    // Force a mutation that touches volatile fields — must NOT leak.
    session.updateLastOutput("card-1", "secret snippet that must not persist");

    const persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(1);

    const allowedKeys = new Set([
      "folder",
      "title",
      "shell",
      "claudeSessionId",
      "createdAt",
    ]);
    const actualKeys = Object.keys(persisted[0]);
    for (const key of actualKeys) {
      expect(allowedKeys.has(key)).toBe(true);
    }

    // Spot-check that the volatile / forbidden fields are absent.
    const recordView = persisted[0] as unknown as Record<string, unknown>;
    expect(recordView.lastOutputSnippet).toBeUndefined();
    expect(recordView.lastOutputAt).toBeUndefined();
    expect(recordView.finishedAt).toBeUndefined();
    expect(recordView.exitCode).toBeUndefined();
    expect(recordView.status).toBeUndefined();
    expect(recordView.id).toBeUndefined();
  });

  it("dead sessions (status: \"done\" or \"error\") are filtered out before persist", () => {
    const session = useSessionStore.getState();

    session.addSession({
      id: "alive-1",
      title: "Alive",
      folder: "C:\\proj\\alive",
      shell: "powershell",
    });
    session.addSession({
      id: "dead-done",
      title: "Done Session",
      folder: "C:\\proj\\done",
      shell: "powershell",
    });
    session.addSession({
      id: "dead-error",
      title: "Error Session",
      folder: "C:\\proj\\error",
      shell: "powershell",
    });

    // Transition two of them to terminal states.
    useSessionStore.getState().updateStatus("dead-done", "running");
    useSessionStore.getState().updateStatus("dead-done", "done");
    useSessionStore.getState().updateStatus("dead-error", "running");
    useSessionStore.getState().updateStatus("dead-error", "error");

    const persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].folder).toBe("C:\\proj\\alive");
    expect(persisted.find((s) => s.title === "Done Session")).toBeUndefined();
    expect(persisted.find((s) => s.title === "Error Session")).toBeUndefined();
  });

  it("persist triggers when sessions array changes (e.g. addSession)", () => {
    expect(useSettingsStore.getState().sessionRestore.sessions).toEqual([]);

    useSessionStore.getState().addSession({
      id: "card-1",
      title: "First Add",
      folder: "C:\\proj\\one",
      shell: "powershell",
    });

    let persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].title).toBe("First Add");

    useSessionStore.getState().addSession({
      id: "card-2",
      title: "Second Add",
      folder: "C:\\proj\\two",
      shell: "cmd",
    });

    persisted = useSettingsStore.getState().sessionRestore.sessions;
    expect(persisted).toHaveLength(2);
    expect(persisted.map((s) => s.title)).toEqual(["First Add", "Second Add"]);
  });

  // -------------------------------------------------------------------------
  // RED today — failing until Wave 4 fixes the lastJson comparator to also
  // hash layoutMode + gridFolders. Currently sessionRestoreSync.ts only
  // stringifies `sessions` for change detection (line 79), so layoutMode-only
  // and gridFolders-only mutations skip the persist write.
  // -------------------------------------------------------------------------

  it("persist triggers when layoutMode changes from \"single\" to \"grid\"", () => {
    const session = useSessionStore.getState();

    // Seed one session so the subscriber has something to persist; this
    // also primes lastJson to the current sessions snapshot.
    session.addSession({
      id: "card-1",
      title: "Layout Card",
      folder: "C:\\proj\\layout",
      shell: "powershell",
    });

    // Sanity: snapshot starts in "single" mode.
    expect(useSettingsStore.getState().sessionRestore.layoutMode).toBe("single");

    // Mutate ONLY layoutMode. Sessions array is unchanged, so the
    // current implementation skips the write. The fix must hash layoutMode
    // (and gridFolders) into the change detector.
    useSessionStore.getState().setLayoutMode("grid");

    expect(useSettingsStore.getState().sessionRestore.layoutMode).toBe("grid");
  });

  it("persist triggers when gridFolders array changes (addToGrid)", () => {
    const session = useSessionStore.getState();

    session.addSession({
      id: "card-1",
      title: "Grid Card",
      folder: "C:\\proj\\grid",
      shell: "powershell",
    });

    // Initial snapshot: empty gridFolders.
    expect(useSettingsStore.getState().sessionRestore.gridFolders).toEqual([]);

    // Add to grid — sessions array is unchanged, so today's stringify-on-
    // sessions-only comparator skips the write. Fix must include gridFolders
    // (and/or gridSessionIds resolution) in the change detector.
    useSessionStore.getState().addToGrid("card-1");

    const persistedGrid = useSettingsStore.getState().sessionRestore.gridFolders;
    expect(persistedGrid).toEqual(["C:\\proj\\grid"]);
  });
});
