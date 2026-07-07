/**
 * Layer-B integration tests for useSessionRestore (Test ID B3.4).
 *
 * Locks the m2-ghost dedup contract at the RESTORE side. Fix #256
 * (commit e8f5eea) introduced a `claimedClaudeIds` Set inside
 * `restoreSessions()` so duplicate persisted UUIDs and scan-fallback
 * collisions cannot mirror two cards onto the same backend session.
 *
 * These tests use REAL Zustand stores and the real `useSessionRestore`
 * hook — only the Tauri IPC boundary is intercepted via `installRealIPC`.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 3)
 */

import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useSessionRestore } from "./useSessionRestore";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUIStore } from "../store/uiStore";
import { resetAllStores } from "../test/storeReset";
import {
  buildCreateSessionHandler,
  installRealIPC,
} from "../test/mockTauriIPC";

const SHARED_UUID = "11111111-1111-4111-8111-111111111111";

describe("useSessionRestore — Layer-B integration (m2-ghost dedup contract)", () => {
  beforeEach(() => {
    resetAllStores();
  });

  // -------------------------------------------------------------------------
  // 1. Pre-fix stale data: same persisted UUID must NOT mirror onto the same
  //    backend session — the claim-set forces fall-through to history scan.
  // -------------------------------------------------------------------------

  it("pre-fix stale data: 3 entries with same claudeSessionId → 3 distinct sessions restored", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "m2-1", shell: "powershell", claudeSessionId: SHARED_UUID },
        { folder: "C:\\test\\a", title: "m2-2", shell: "powershell", claudeSessionId: SHARED_UUID },
        { folder: "C:\\test\\a", title: "m2-3", shell: "powershell", claudeSessionId: SHARED_UUID },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      // History returns 3 distinct UUIDs; the 2nd + 3rd entries fall through
      // to scan because their persisted UUID was already claimed by entry 1.
      scan_claude_sessions: async () => [
        { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", started_at: "2026-05-08T10:00:00Z" },
        { session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", started_at: "2026-05-08T09:00:00Z" },
        { session_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", started_at: "2026-05-08T08:00:00Z" },
      ],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });

    const uuids = useSessionStore.getState().sessions.map((s) => s.claudeSessionId);
    // Entry 1 keeps SHARED_UUID; entries 2+3 must each pick a DIFFERENT UUID
    // from history (or undefined if the scan cannot supply one).
    expect(uuids[0]).toBe(SHARED_UUID);
    // All three claudeSessionIds must be distinct — no two cards mirror.
    expect(new Set(uuids).size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 2. Claim-set fallback path: persisted-UUID collision triggers a
  //    scan_claude_sessions call for the duplicate entry.
  // -------------------------------------------------------------------------

  it("claim-set fallback: duplicate persisted UUID triggers scan_claude_sessions for the 2nd entry", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "first", shell: "powershell", claudeSessionId: SHARED_UUID },
        { folder: "C:\\test\\a", title: "second", shell: "powershell", claudeSessionId: SHARED_UUID },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    const scanCalls: Array<Record<string, unknown>> = [];
    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      scan_claude_sessions: async (args) => {
        scanCalls.push(args);
        return [
          { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", started_at: "2026-05-08T10:00:00Z" },
        ];
      },
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    // Scan was invoked at least once (for the duplicate entry).
    expect(scanCalls.length).toBeGreaterThanOrEqual(1);
    // The duplicate entry's resolved claudeSessionId must differ from the
    // first entry's (or be undefined if no fresh history candidate existed).
    const sessions = useSessionStore.getState().sessions;
    expect(sessions[0].claudeSessionId).toBe(SHARED_UUID);
    expect(sessions[1].claudeSessionId).not.toBe(SHARED_UUID);
    // With history of length 1, the candidate "aaa…" was claimed by the
    // fall-through; second entry should land on it.
    expect(sessions[1].claudeSessionId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  // -------------------------------------------------------------------------
  // 3. Empty scan → fresh-spawn (claudeSessionId === undefined).
  // -------------------------------------------------------------------------

  it("scan returns empty → entries without persisted UUID get fresh-spawn (claudeSessionId === undefined)", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "one", shell: "powershell" },
        { folder: "C:\\test\\b", title: "two", shell: "powershell" },
        { folder: "C:\\test\\c", title: "three", shell: "powershell" },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      scan_claude_sessions: async () => [],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });

    for (const session of useSessionStore.getState().sessions) {
      expect(session.claudeSessionId).toBeUndefined();
    }
  });

  // -------------------------------------------------------------------------
  // 4. MAX_SESSIONS = 8 hard limit.
  // -------------------------------------------------------------------------

  it("MAX_SESSIONS = 8 limit: 10 entries in restore → only 8 sessions added", async () => {
    const sessions = Array.from({ length: 10 }, (_, i) => ({
      folder: `C:\\test\\folder-${i}`,
      title: `Session ${i}`,
      shell: "powershell" as const,
    }));

    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions,
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      scan_claude_sessions: async () => [],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(8);
    });

    // Sanity: store stayed at 8 even after waitFor settled.
    expect(useSessionStore.getState().sessions).toHaveLength(8);
  });

  // -------------------------------------------------------------------------
  // 5. Success toast shows count.
  // -------------------------------------------------------------------------

  it("success toast appears with restored count", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "one", shell: "powershell" },
        { folder: "C:\\test\\b", title: "two", shell: "powershell" },
        { folder: "C:\\test\\c", title: "three", shell: "powershell" },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      scan_claude_sessions: async () => [],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(3);
    });

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts.length).toBeGreaterThan(0);
      expect(toasts.some((t) => t.type === "success" && /wiederhergestellt/i.test(t.title))).toBe(true);
    });

    const successToast = useUIStore
      .getState()
      .toasts.find((t) => t.type === "success");
    expect(successToast?.title).toContain("3");
  });

  // -------------------------------------------------------------------------
  // 6. Partial failure: create_session rejects for the 2nd entry only.
  //    Result: 2 sessions in store + info toast naming the failure.
  // -------------------------------------------------------------------------

  it("partial-failure toast: when create_session rejects for one entry, info toast lists it", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "alpha", shell: "powershell" },
        { folder: "C:\\test\\b", title: "bravo", shell: "powershell" },
        { folder: "C:\\test\\c", title: "charlie", shell: "powershell" },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    installRealIPC({
      create_session: async (args) => {
        // Reject for the 2nd entry (bravo) only.
        if (args.title === "bravo") {
          throw new Error("simulated create_session failure for bravo");
        }
        return {
          id: typeof args.id === "string" ? args.id : "mock-id",
          title: typeof args.title === "string" ? args.title : "untitled",
          folder: typeof args.folder === "string" ? args.folder : "",
          shell: typeof args.shell === "string" ? args.shell : "powershell",
        };
      },
      scan_claude_sessions: async () => [],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts.some((t) => t.type === "info")).toBe(true);
    });

    const infoToast = useUIStore.getState().toasts.find((t) => t.type === "info");
    expect(infoToast?.title).toMatch(/2 von 3/);
    expect(infoToast?.message).toContain("bravo");

    // Successful sessions are alpha + charlie — bravo is missing.
    const titles = useSessionStore.getState().sessions.map((s) => s.title);
    expect(titles).toEqual(expect.arrayContaining(["alpha", "charlie"]));
    expect(titles).not.toContain("bravo");
  });

  // -------------------------------------------------------------------------
  // 7. Layout restore: gridFolders + activeFolder map back to session ids.
  // -------------------------------------------------------------------------

  it("layout restore: gridFolders + activeFolder map back to session ids", async () => {
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "alpha", shell: "powershell" },
        { folder: "C:\\test\\b", title: "bravo", shell: "powershell" },
      ],
      activeFolder: "C:\\test\\a",
      layoutMode: "grid",
      gridFolders: ["C:\\test\\a", "C:\\test\\b"],
    });

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      scan_claude_sessions: async () => [],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(2);
    });

    await waitFor(() => {
      expect(useSessionStore.getState().layoutMode).toBe("grid");
    });

    const store = useSessionStore.getState();
    expect(store.layoutMode).toBe("grid");

    // gridSessionIds must contain the IDs for both folders, in order.
    const folderToId = new Map(store.sessions.map((s) => [s.folder, s.id]));
    const idA = folderToId.get("C:\\test\\a");
    const idB = folderToId.get("C:\\test\\b");
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(store.gridSessionIds).toContain(idA);
    expect(store.gridSessionIds).toContain(idB);
    expect(store.gridSessionIds).toHaveLength(2);

    // activeSessionId points to the session for activeFolder ("C:\\test\\a").
    expect(store.activeSessionId).toBe(idA);
  });
});

describe("useSessionRestore — renamed-title persistence into History", () => {
  beforeEach(() => {
    resetAllStores();
  });

  // -------------------------------------------------------------------------
  // Root-cause repro (Option-1 failing test).
  //
  // The History viewer resolves each row's label via
  // `sessionTitleOverrides[session_id] || jsonlDefaultTitle`
  // (SessionHistoryViewer.tsx:233-234). The ONLY channel a user rename reaches
  // History is that override map.
  //
  // A session renamed BEFORE its Claude UUID was discovered never writes an
  // override (SessionCard.tsx:80 gates the write on `session.claudeSessionId`,
  // which is still undefined pre-discovery). The renamed title survives only in
  // the ephemeral bar + the persisted `sessionRestore` snapshot title.
  //
  // On restart, restore resumes the session under a scan-picked UUID
  // (useSessionRestore.ts:87-89,128) and shows the snapshot title in the bar —
  // but it NEVER calls setSessionTitleOverride, and because addSession sets the
  // claudeSessionId directly, discovery's self-heal seed is skipped
  // (claudeIdDiscovery.ts:194 only runs for sessions without a UUID).
  //
  // Result: bar shows "Mein Name", History shows the jsonl default. This test
  // asserts the desired end-state (override carries the rename) and MUST fail
  // against current code.
  // -------------------------------------------------------------------------

  it("restoring a renamed session (UUID unknown at rename time) persists the rename into the override map", async () => {
    const RESUME_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    // Persisted snapshot carries the user rename as the title but NO
    // claudeSessionId — mirrors "renamed before discovery resolved the UUID".
    useSettingsStore.getState().setSessionRestore({
      enabled: true,
      sessions: [
        { folder: "C:\\test\\a", title: "Mein Name", shell: "powershell" },
      ],
      activeFolder: null,
      layoutMode: "single",
      gridFolders: [],
    });

    // Pre-condition: the rename never wrote an override (pre-discovery skip).
    expect(useSettingsStore.getState().sessionTitleOverrides).toEqual({});

    installRealIPC({
      create_session: buildCreateSessionHandler().handler,
      // On resume, the scan finds the real jsonl this session belongs to.
      scan_claude_sessions: async () => [
        { session_id: RESUME_UUID, started_at: "2026-05-08T10:00:00Z" },
      ],
    });

    renderHook(() => useSessionRestore());

    await waitFor(() => {
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });

    const session = useSessionStore.getState().sessions[0];
    // The bar correctly shows the renamed title (restored from the snapshot)
    // and the session is resumed under the scan-picked UUID.
    expect(session.title).toBe("Mein Name");
    expect(session.claudeSessionId).toBe(RESUME_UUID);

    // The History row for RESUME_UUID reads sessionTitleOverrides[RESUME_UUID].
    // For the rename to be visible in History, restore must persist it there.
    expect(
      useSettingsStore.getState().sessionTitleOverrides[RESUME_UUID],
    ).toBe("Mein Name");
  });
});
