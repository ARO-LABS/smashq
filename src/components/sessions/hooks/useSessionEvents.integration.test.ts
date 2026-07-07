/**
 * Layer-B integration tests for `useSessionEvents` — focuses on the m2-Ghost-
 * Session bug at the FRONTEND layer. Fix shipped in #257 / commit b4dc61b
 * (closest-timestamp match, cross-mount claim guard).
 *
 * These tests REPRODUCE the original failure scenario and assert the FIXED
 * behavior: 3 sessions in the same folder must each receive a DISTINCT
 * Claude session UUID via discovery — not the same UUID three times.
 *
 * Wiring:
 *  - Real Zustand stores (resetAllStores between tests)
 *  - Real @tauri-apps/api invoke/listen via mockIPC (installRealIPC)
 *  - **Canned-data scan_claude_sessions handler** (NOT real fs) — scope is
 *    the discovery LOGIC (closest-timestamp match, claim-set, retry cadence).
 *    The fs-read path is exercised by Layer-A tests in src-tauri/tests/.
 *    Avoiding fs here removes the fake-timer + libuv-I/O collision that
 *    made the first iteration of these tests flaky.
 *  - vi.useFakeTimers() to control the 3000 ms discovery-retry cadence
 *
 * Plan reference:
 *  reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 3, B3.2)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSessionEvents } from "./useSessionEvents";
import { useSessionStore } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { resetAllStores } from "../../../test/storeReset";
import {
  emitTauriEvent,
  installRealIPC,
  type IPCHandler,
} from "../../../test/mockTauriIPC";

// ---------------------------------------------------------------------------
// Test constants — keep in sync with useSessionEvents.ts
// ---------------------------------------------------------------------------

const DISCOVERY_RETRY_DELAY_MS = 3_000;
const DISCOVERY_MAX_RETRIES = 5;
// Pick a fixed fake-now well inside any reasonable date range. JSONL fixture
// timestamps anchor against this so they fall inside the 10s tolerance window.
const FAKE_NOW_MS = new Date("2026-05-08T10:00:00.000Z").getTime();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CannedHistoryEntry {
  session_id: string;
  started_at: string;
}

/**
 * Build a `scan_claude_sessions` handler from canned data. Maps folder →
 * history entries. Folders not in the map return an empty array. Tests
 * use canned data so the handler is purely synchronous resolution — no
 * libuv I/O — which makes fake-timer interaction deterministic.
 */
function cannedScanHandler(
  byFolder: Record<string, CannedHistoryEntry[]>,
): IPCHandler {
  return async (args) => {
    const folder = args.folder as string;
    return byFolder[folder] ?? [];
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionEvents — m2 race + discovery integration (B3.2)", () => {
  beforeEach(() => {
    resetAllStores();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FAKE_NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Drive one discovery round: advance the 3000 ms timer to fire all
   * scheduled discoveries, then drain microtasks so the await invoke()
   * chain settles into setClaudeSessionId. With canned-data handlers
   * (no fs/libuv), the chain is microtask-only — no realSetImmediate
   * gymnastics needed.
   */
  async function flushDiscoveryRound(): Promise<void> {
    await vi.advanceTimersByTimeAsync(DISCOVERY_RETRY_DELAY_MS);
    for (let i = 0; i < 16; i++) {
      await Promise.resolve();
    }
  }

  // -------------------------------------------------------------------------
  // 1) Canonical m2-race regression: 3 distinct UUIDs after discovery.
  // -------------------------------------------------------------------------
  it("m2 race: 3 sessions in same folder receive 3 distinct claudeSessionIds via discovery", async () => {
    const folder = "C:\\test\\m2";
    // Three history entries with distinct UUIDs and staggered started_at.
    // Pre-fix bug signature: all 3 sessions latched onto the newest entry.
    const fixtures: CannedHistoryEntry[] = [
      { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01", started_at: "2026-05-08T10:00:00.100Z" },
      { session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02", started_at: "2026-05-08T10:00:00.200Z" },
      { session_id: "cccccccc-cccc-4ccc-8ccc-cccccccccc03", started_at: "2026-05-08T10:00:00.300Z" },
    ];

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({ [folder]: fixtures }),
    });

    renderHook(() => useSessionEvents());
    // Let useEffect register the listeners before we emit events.
    await Promise.resolve();

    // Seed three sessions, each with createdAt aligned to one fixture's
    // started_at. The "closest timestamp" heuristic should map s-0→aaa,
    // s-1→bbb, s-2→ccc.
    for (let i = 0; i < fixtures.length; i++) {
      vi.setSystemTime(new Date(FAKE_NOW_MS + 100 + i * 100));
      const id = `s-${i}`;
      useSessionStore.getState().addSession({
        id,
        title: "m2",
        folder,
        shell: "powershell",
      });
      await emitTauriEvent("session-status", { id, status: "running" });
    }

    await flushDiscoveryRound();

    const sessions = useSessionStore.getState().sessions;
    const uuids = sessions.map((s) => s.claudeSessionId);

    expect(uuids.every((u) => typeof u === "string" && u.length > 0)).toBe(true);
    expect(new Set(uuids).size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 2) Closest-timestamp match (NOT newest-history-first).
  // -------------------------------------------------------------------------
  it("discovery picks closest-timestamp match, NOT newest-history-first", async () => {
    const folder = "C:\\test\\closest";
    const closestUuid = "11111111-1111-4111-8111-111111111111";
    const newestUuid = "22222222-2222-4222-8222-222222222222";
    // closestUuid is +50ms from createdAt, newestUuid is +500ms.
    // Pre-fix `find()` over DESC-sorted history returns the newest-in-window;
    // post-fix `pickBestHistoryMatch` returns the closest by absolute diff.
    const fixtures: CannedHistoryEntry[] = [
      { session_id: closestUuid, started_at: "2026-05-08T10:00:00.150Z" },
      { session_id: newestUuid, started_at: "2026-05-08T10:00:00.600Z" },
    ];

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({ [folder]: fixtures }),
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    useSessionStore.getState().addSession({
      id: "s-closest",
      title: "closest",
      folder,
      shell: "powershell",
    });
    await emitTauriEvent("session-status", { id: "s-closest", status: "running" });

    await flushDiscoveryRound();

    const session = useSessionStore.getState().sessions.find((s) => s.id === "s-closest");
    expect(session?.claudeSessionId).toBe(closestUuid);
  });

  // -------------------------------------------------------------------------
  // 2b) Rename recorded before the UUID resolves is flushed onto the UUID by
  //     discovery — and takes precedence over the auto-title seed. This is the
  //     same-session half of the rename→History bug: pre-fix, a rename issued
  //     before discovery never reached the override map (SessionCard.tsx gated
  //     the write on claudeSessionId), so History showed the default title.
  // -------------------------------------------------------------------------
  it("discovery flushes a pre-resolution rename onto the UUID (over the auto title)", async () => {
    const folder = "C:\\test\\pending";
    const uuid = "55555555-5555-4555-8555-555555555555";

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({
        [folder]: [{ session_id: uuid, started_at: "2026-05-08T10:00:00.150Z" }],
      }),
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    const id = "s-pending";
    // Session's live title stays the auto default — the user's rename lives ONLY
    // as a pending intent (mirrors renaming before Claude's UUID was discovered).
    useSessionStore.getState().addSession({
      id,
      title: "auto-title",
      folder,
      shell: "powershell",
    });
    useSettingsStore.getState().setPendingTitleOverride(id, "Mein Name");

    await emitTauriEvent("session-status", { id, status: "running" });
    await flushDiscoveryRound();

    // The renamed title — not the auto default — must land under the resolved
    // UUID, and the pending intent must be consumed.
    expect(useSettingsStore.getState().sessionTitleOverrides[uuid]).toBe("Mein Name");
    expect(useSettingsStore.getState().pendingTitleOverrides[id]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3) Cross-mount claim guard: previously-assigned UUIDs are not re-used.
  // -------------------------------------------------------------------------
  it("claimed UUIDs across the store (cross-mount) prevent re-assignment", async () => {
    const folder = "C:\\test\\claim";
    const alreadyClaimedUuid = "33333333-3333-4333-8333-333333333333";
    const freshUuid = "44444444-4444-4444-8444-444444444444";
    // alreadyClaimedUuid is the closest match by timestamp (+10ms vs +50ms),
    // BUT it's already claimed by a pre-existing session in the store. The
    // guard `isClaudeIdClaimed` must skip it and pick freshUuid instead.
    const fixtures: CannedHistoryEntry[] = [
      { session_id: alreadyClaimedUuid, started_at: "2026-05-08T10:00:00.110Z" },
      { session_id: freshUuid, started_at: "2026-05-08T10:00:00.150Z" },
    ];

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({ [folder]: fixtures }),
    });

    // Pre-seed: a session that already holds alreadyClaimedUuid (simulating
    // an earlier discovery wave or a hot-reload remount).
    vi.setSystemTime(new Date(FAKE_NOW_MS + 50));
    useSessionStore.getState().addSession({
      id: "s-pre-existing",
      title: "pre",
      folder,
      shell: "powershell",
      claudeSessionId: alreadyClaimedUuid,
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    useSessionStore.getState().addSession({
      id: "s-new",
      title: "new",
      folder,
      shell: "powershell",
    });
    await emitTauriEvent("session-status", { id: "s-new", status: "running" });

    await flushDiscoveryRound();

    const newSession = useSessionStore.getState().sessions.find((s) => s.id === "s-new");
    expect(newSession?.claudeSessionId).toBe(freshUuid);
    expect(newSession?.claudeSessionId).not.toBe(alreadyClaimedUuid);
  });

  // -------------------------------------------------------------------------
  // 4) Session removed during discovery → no crash, no orphan claim.
  // -------------------------------------------------------------------------
  it("session removed during discovery → no crash, no orphan claim", async () => {
    const folder = "C:\\test\\removed";
    const fixtures: CannedHistoryEntry[] = [
      { session_id: "55555555-5555-4555-8555-555555555555", started_at: "2026-05-08T10:00:00.150Z" },
    ];

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({ [folder]: fixtures }),
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    useSessionStore.getState().addSession({
      id: "s-removed",
      title: "removed",
      folder,
      shell: "powershell",
    });
    await emitTauriEvent("session-status", { id: "s-removed", status: "running" });

    // Remove the session BEFORE discovery fires (within the 3000ms wait).
    useSessionStore.getState().removeSession("s-removed");

    // Discovery should run, find no matching session in store, return early.
    // No throw, no orphan UUID written.
    await flushDiscoveryRound();

    expect(useSessionStore.getState().sessions).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 5) Scan returns empty → discovery retries up to DISCOVERY_MAX_RETRIES.
  // -------------------------------------------------------------------------
  it("scan returns empty → discovery retries up to DISCOVERY_MAX_RETRIES", async () => {
    const folder = "C:\\test\\retry";
    let scanCalls = 0;
    installRealIPC({
      scan_claude_sessions: async () => {
        scanCalls++;
        return []; // always empty → triggers retry
      },
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    useSessionStore.getState().addSession({
      id: "s-retry",
      title: "retry",
      folder,
      shell: "powershell",
    });
    await emitTauriEvent("session-status", { id: "s-retry", status: "running" });

    // Drive DISCOVERY_MAX_RETRIES + 1 rounds — production should stop at MAX.
    for (let i = 0; i < DISCOVERY_MAX_RETRIES + 1; i++) {
      await flushDiscoveryRound();
    }

    // Hook schedules attempt #1 from the status handler (3000ms wait), then
    // retries 2..MAX_RETRIES from inside the discovery callback. Total = MAX_RETRIES.
    expect(scanCalls).toBe(DISCOVERY_MAX_RETRIES);
    // Session never got a UUID (scan was always empty).
    const session = useSessionStore.getState().sessions.find((s) => s.id === "s-retry");
    expect(session?.claudeSessionId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 6) CHARACTERIZATION (Welle 5): two same-folder sessions, near-simultaneous
  //    spawn — one resolves via the DETERMINISTIC `session-claude-id-resolved`
  //    event, the other falls back to the `started_at`-PROXIMITY scan. The
  //    claim guard must ensure the event-claimed UUID is not re-assigned to
  //    the proximity-resolved session, even though it is the closest match by
  //    timestamp. This is the regression proof for the claudeIdDiscovery
  //    factory extraction: it exercises the event path, the proximity path,
  //    AND the cross-path claim dedup in a single scenario.
  // -------------------------------------------------------------------------
  it("two same-folder sessions: event path + proximity fallback, no UUID collision", async () => {
    const folder = "C:\\test\\dual-path";
    // s-event resolves deterministically to eventUuid via the Rust event.
    // s-proximity must resolve via scan. eventUuid is the CLOSEST timestamp
    // match for s-proximity (+10ms) but it's already claimed by the event
    // path, so the claim guard must skip it and pick proxUuid instead.
    const eventUuid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
    const proxUuid = "ffffffff-ffff-4fff-8fff-ffffffffff02";
    const fixtures: CannedHistoryEntry[] = [
      { session_id: eventUuid, started_at: "2026-05-08T10:00:00.110Z" },
      { session_id: proxUuid, started_at: "2026-05-08T10:00:00.160Z" },
    ];

    installRealIPC({
      scan_claude_sessions: cannedScanHandler({ [folder]: fixtures }),
    });

    renderHook(() => useSessionEvents());
    await Promise.resolve();

    // Seed both sessions at the same createdAt so eventUuid (+10ms) would be
    // the closest match for BOTH if the claim guard were absent.
    vi.setSystemTime(new Date(FAKE_NOW_MS + 100));
    useSessionStore.getState().addSession({
      id: "s-event",
      title: "event",
      folder,
      shell: "powershell",
    });
    useSessionStore.getState().addSession({
      id: "s-proximity",
      title: "proximity",
      folder,
      shell: "powershell",
    });

    // DETERMINISTIC path: s-event resolves immediately via the Rust event,
    // claiming eventUuid in the store before proximity discovery runs.
    await emitTauriEvent("session-claude-id-resolved", {
      id: "s-event",
      claudeSessionId: eventUuid,
    });

    // PROXIMITY path: s-proximity goes running → scheduled scan-based discovery.
    await emitTauriEvent("session-status", { id: "s-proximity", status: "running" });
    await flushDiscoveryRound();

    const sEvent = useSessionStore.getState().sessions.find((s) => s.id === "s-event");
    const sProx = useSessionStore.getState().sessions.find((s) => s.id === "s-proximity");

    // Event path assigned its deterministic UUID.
    expect(sEvent?.claudeSessionId).toBe(eventUuid);
    // Proximity path skipped the already-claimed eventUuid (closest match) and
    // picked the next-closest unclaimed UUID — no collision.
    expect(sProx?.claudeSessionId).toBe(proxUuid);
    expect(sProx?.claudeSessionId).not.toBe(eventUuid);
    // Both UUIDs distinct.
    expect(new Set([sEvent?.claudeSessionId, sProx?.claudeSessionId]).size).toBe(2);
  });
});
