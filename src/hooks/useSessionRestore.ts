import { useEffect, useRef } from "react";
import { wrapInvoke } from "../utils/perfLogger";
import { useSessionStore, generateUniqueDisplayId } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";
import { useUIStore } from "../store/uiStore";
import { logWarn } from "../utils/errorLogger";
import type { SessionShell } from "../store/sessionStore";

interface ClaudeSessionSummary {
  session_id: string;
  started_at: string;
}

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
          const history = await wrapInvoke<ClaudeSessionSummary[]>(
            "scan_claude_sessions",
            { folder: entry.folder },
          );
          if (history && history.length > 0) {
            // Sessions are sorted by date desc — pick the newest UUID that
            // hasn't already been claimed by an earlier restore iteration.
            const candidate = history.find((h) => !claimedClaudeIds.has(h.session_id));
            if (candidate) {
              resumeSessionId = candidate.session_id;
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

      const result = await wrapInvoke<{
        id: string;
        title: string;
        folder: string;
        shell: string;
        isGitRepo?: boolean;
        snapshotCommit?: string;
      }>("create_session", {
        id,
        folder: entry.folder,
        title: entry.title,
        shell: entry.shell,
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
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });
      createdIds.push(sessionId);
    } catch (err) {
      logWarn("sessionRestore", `Session für "${entry.folder}" übersprungen: ${err}`);
      errors.push(entry.title || entry.folder);
    }
  }

  if (createdIds.length === 0) return;

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
