import { useSessionStore, type ClaudeSession } from "./sessionStore";
import { useSettingsStore, type RestorableSession } from "./settingsStore";
import { logWarn } from "../utils/errorLogger";

/**
 * De-duplicate alive sessions before persisting.
 *
 * Background: A discovery race (useSessionEvents.ts) can map several
 * frontend cards onto the same Claude CLI session UUID. Without dedup
 * we would persist the corrupt state, then the restore loop would
 * recreate N cards all pointing at the same backend session.
 *
 * Dedup rule: if a `claudeSessionId` is set, it must be unique across
 * the persisted snapshot. The first card carrying a given UUID wins,
 * subsequent duplicates are dropped (with a warning log).
 *
 * Sessions without a `claudeSessionId` (discovery not yet complete) are
 * never deduped — they may legitimately share folder + title. The
 * restore-side claim set in `useSessionRestore` ensures distinct UUIDs
 * are assigned on the next start.
 */
export function dedupRestorableSessions(
  alive: readonly ClaudeSession[],
): RestorableSession[] {
  const result: RestorableSession[] = [];
  const seenClaudeIds = new Set<string>();

  for (const s of alive) {
    if (s.claudeSessionId) {
      if (seenClaudeIds.has(s.claudeSessionId)) {
        logWarn(
          "sessionRestoreSync",
          `Doppelte claudeSessionId "${s.claudeSessionId}" — Card "${s.title}" (${s.folder}) wird nicht persistiert`,
        );
        continue;
      }
      seenClaudeIds.add(s.claudeSessionId);
    }
    result.push({
      folder: s.folder,
      title: s.title,
      shell: s.shell,
      claudeSessionId: s.claudeSessionId,
    });
  }

  return result;
}

/**
 * Subscribes to sessionStore changes and continuously syncs
 * a restore snapshot into settingsStore (persisted).
 * Returns an unsubscribe function.
 *
 * Dev-mode: returns a no-op unsubscriber. We must NOT write into
 * settingsStore.sessionRestore in dev — otherwise a manually-created
 * test session would overwrite the user's real prod-snapshot, and the
 * next `npm run tauri build` would start with the wrong session list.
 * Pair with the matching gate in useSessionRestore.ts.
 */
export function initSessionRestoreSync(): () => void {
  // MODE check (not import.meta.env.DEV) so vitest (MODE='test') is excluded —
  // sessionRestoreSync.integration.test.ts must run the real subscriber.
  if (import.meta.env.MODE === "development") {
    return () => {};
  }

  let lastJson = "";

  return useSessionStore.subscribe((state) => {
    const settings = useSettingsStore.getState();
    if (!settings.sessionRestore.enabled) return;

    // Only include sessions that are still alive (not done/error)
    const alive = state.sessions.filter(
      (s) => s.status !== "done" && s.status !== "error",
    );

    const sessions = dedupRestorableSessions(alive);

    // Resolve active/grid sessions by folder (stable across restore failures)
    const activeSession = state.activeSessionId
      ? alive.find((s) => s.id === state.activeSessionId)
      : undefined;

    const gridFolders = state.gridSessionIds
      .map((gid) => alive.find((s) => s.id === gid)?.folder)
      .filter((f): f is string => !!f);

    // Shallow comparison to avoid redundant writes. MUST include layoutMode
    // and gridFolders so layout-only mutations (single→grid switch, addToGrid)
    // also trigger a persist write — without these, the layout change rides
    // along the next sessions-array mutation and is otherwise lost on restart.
    const json = JSON.stringify({
      sessions,
      layoutMode: state.layoutMode,
      gridFolders,
    });
    if (json === lastJson) return;
    lastJson = json;

    settings.setSessionRestore({
      enabled: true,
      sessions,
      activeFolder: activeSession?.folder ?? null,
      layoutMode: state.layoutMode,
      gridFolders,
    });
  });
}
