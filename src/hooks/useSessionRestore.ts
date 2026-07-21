import { useEffect, useRef } from "react";
import { wrapInvoke } from "../utils/perfLogger";
import {
  useSessionStore,
  generateUniqueDisplayId,
  generateSessionId,
} from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUIStore } from "../store/uiStore";
import { logWarn } from "../utils/errorLogger";
import { classifyPrerequisiteError } from "../utils/adpError";
import type { SessionShell, CreateSessionResult } from "../store/sessionStore";
import {
  pickBestHistoryMatch,
  type ClaudeHistoryEntry,
} from "../components/sessions/hooks/claudeIdDiscovery";

const MAX_SESSIONS = 8;

/**
 * Restores previously open sessions on app startup.
 * Runs once on mount — reads the persisted snapshot from settingsStore,
 * recreates sessions via Tauri, and restores layout state.
 */
export function useSessionRestore(): void {
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    // Dev-mode gate: skip auto-resume so `npm run tauri dev` starts with an
    // empty hub. Avoids accumulating PowerShell PTYs across HMR full-reloads.
    // Pair with the matching gate in initSessionRestoreSync (sessionRestoreSync.ts):
    // both must be DEV-gated, otherwise a manual test-session in dev would
    // overwrite the persisted prod snapshot.
    // Use MODE check (not import.meta.env.DEV) so vitest (MODE='test') is excluded —
    // integration tests in useSessionRestore.integration.test.ts must run the body.
    if (import.meta.env.MODE === "development") return;

    const { sessionRestore } = useSettingsStore.getState();
    if (!sessionRestore.enabled || sessionRestore.sessions.length === 0) return;

    restoreSessions(sessionRestore);
  }, []);
}

async function restoreSessions(
  restore: ReturnType<typeof useSettingsStore.getState>["sessionRestore"],
): Promise<void> {
  const sessionsToRestore = restore.sessions.slice(0, MAX_SESSIONS);
  const createdIds: string[] = [];
  const errors: string[] = [];
  // Keep the first raw error object around so an all-failed run can classify
  // it — `errors` above only holds display titles, which drops the structured
  // `details` discriminator the prerequisite classifier keys off.
  let firstError: unknown;

  // Track Claude session UUIDs claimed across this restore run.
  // Prevents two cards from latching onto the same backend session when:
  //  (a) persisted state still carries duplicates from a pre-fix install, or
  //  (b) several entries fall back to scan_claude_sessions and would otherwise
  //      all pick history[0].
  const claimedClaudeIds = new Set<string>();

  for (const entry of sessionsToRestore) {
    const id = generateSessionId();
    try {
      // Use persisted Claude CLI session ID if available, otherwise scan for most recent
      let resumeSessionId: string | undefined = entry.claudeSessionId;

      // If the persisted UUID was already claimed by an earlier iteration,
      // drop the resume hint — fall through to scan or fresh-spawn.
      if (resumeSessionId && claimedClaudeIds.has(resumeSessionId)) {
        logWarn(
          "sessionRestore",
          `Duplikat claudeSessionId "${resumeSessionId}" in persistierten Sessions — ignoriere Resume für "${entry.title}"`,
        );
        resumeSessionId = undefined;
      }

      if (!resumeSessionId) {
        try {
          const history = await wrapInvoke<ClaudeHistoryEntry[]>(
            "scan_claude_sessions",
            { folder: entry.folder },
          );
          if (history && history.length > 0) {
            if (entry.createdAt) {
              // Time-anchored pick: resume the entry whose started_at is
              // CLOSEST to the card's original creation time — same heuristic
              // as live discovery. "Newest unclaimed" resumed the wrong
              // session whenever the folder held more than one. No match
              // within tolerance → fresh spawn instead of guessing.
              const match = pickBestHistoryMatch(
                history,
                entry.createdAt,
                (sid) => claimedClaudeIds.has(sid),
              );
              if (match) {
                resumeSessionId = match.session_id;
              }
            } else {
              // Legacy snapshot without createdAt (written before the anchor
              // existed): keep the old newest-unclaimed pick. Self-extinguishes
              // after the first post-update persist.
              const candidate = history.find(
                (h) => !claimedClaudeIds.has(h.session_id),
              );
              if (candidate) {
                resumeSessionId = candidate.session_id;
              }
            }
          }
        } catch {
          // Non-critical: if scan fails, just start a fresh session
          logWarn("sessionRestore", `Claude-History für "${entry.folder}" nicht lesbar, starte frisch`);
        }
      }

      if (resumeSessionId) {
        claimedClaudeIds.add(resumeSessionId);
      }

      // Session-eigener Modus aus dem Snapshot gewinnt — nur Legacy-Einträge
      // ohne Feld fallen auf den aktuellen Settings-Default zurück. Vorher
      // stempelte Restore pauschal den Default und maskierte damit den
      // Legacy-Fallback des Neustarts (Review-Finding PR #44).
      const permissionMode =
        entry.permissionMode ??
        useSettingsStore.getState().defaultPermissionMode;

      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id,
        folder: entry.folder,
        title: entry.title,
        shell: entry.shell,
        permissionMode,
        resumeSessionId,
      });

      const sessionId = result?.id ?? id;
      const sessions = useSessionStore.getState().sessions;
      useSessionStore.getState().addSession({
        id: sessionId,
        // Persisted title (may be user-renamed) always wins over backend response
        title: entry.title ?? result?.title ?? entry.folder,
        // Restore creates a fresh runtime session — generate a fresh displayId for visual disambiguation,
        // since the previous instance's displayId is not part of the resume contract.
        displayId: generateUniqueDisplayId(sessions),
        folder: result?.folder ?? entry.folder,
        shell: (result?.shell ?? entry.shell) as SessionShell,
        claudeSessionId: resumeSessionId,
        permissionMode,
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });

      // Persist the (possibly user-renamed) snapshot title into the History
      // override map under the resolved UUID. Restore sets claudeSessionId
      // directly, which suppresses discovery's self-heal seed (it only runs for
      // sessions without a UUID) — without this a session renamed before its
      // UUID was ever discovered would show its default title in History after
      // restart. Fills a gap only; never clobbers a newer existing override.
      if (resumeSessionId && entry.title) {
        const { sessionTitleOverrides } = useSettingsStore.getState();
        if (!sessionTitleOverrides[resumeSessionId]) {
          useSettingsStore
            .getState()
            .setSessionTitleOverride(resumeSessionId, entry.title);
        }
      }
      createdIds.push(sessionId);
    } catch (err) {
      logWarn("sessionRestore", `Session für "${entry.folder}" übersprungen: ${err}`);
      errors.push(entry.title || entry.folder);
      firstError ??= err;
    }
  }

  if (createdIds.length === 0) {
    // Every restore failed. The layout/toast block below is skipped by the
    // early return, so a missing Claude CLI would leave the user with an empty
    // hub and NO explanation. Surface the actionable claude-missing hint (same
    // structured classifier the live session-start path uses); other error
    // kinds keep the prior silent behavior — narrowing this to the one case
    // Issue #10 is about, not a blanket toast on every restore failure.
    const info = classifyPrerequisiteError(firstError);
    if (info.kind === "claude_missing") {
      useUIStore.getState().addToast({
        type: "error",
        title: info.title,
        message: info.hint,
      });
    }
    return;
  }

  // Build folder→sessionId lookup from successfully created sessions
  const folderToId = new Map<string, string>();
  const createdSessions = useSessionStore.getState().sessions;
  for (const id of createdIds) {
    const session = createdSessions.find((s) => s.id === id);
    if (session) {
      folderToId.set(session.folder, session.id);
    }
  }

  // Restore layout using stable folder-keys
  const store = useSessionStore.getState();

  if (restore.layoutMode === "grid" && restore.gridFolders.length > 0) {
    store.setLayoutMode("grid");
    for (const folder of restore.gridFolders) {
      const sessionId = folderToId.get(folder);
      if (sessionId) {
        useSessionStore.getState().addToGrid(sessionId);
      }
    }
  }

  if (restore.activeFolder) {
    const activeId = folderToId.get(restore.activeFolder);
    if (activeId) {
      useSessionStore.getState().setActiveSession(activeId);
    }
  }

  // Toast feedback
  const addToast = useUIStore.getState().addToast;
  if (errors.length > 0) {
    addToast({
      type: "info",
      title: `${createdIds.length} von ${sessionsToRestore.length} Sessions wiederhergestellt`,
      message: `Übersprungen: ${errors.join(", ")}`,
      duration: 6000,
    });
  } else {
    addToast({
      type: "success",
      title: `${createdIds.length} Session${createdIds.length > 1 ? "s" : ""} wiederhergestellt`,
      duration: 4000,
    });
  }
}
