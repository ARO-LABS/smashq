import { wrapInvoke } from "../../../utils/perfLogger";
import { useSessionStore, generateUniqueDisplayId } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUIStore } from "../../../store/uiStore";
import { logError, logWarn } from "../../../utils/errorLogger";
import { classifyPrerequisiteError } from "../../../utils/adpError";
import type { SessionShell } from "../../../store/sessionStore";

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Mirrors the Rust `create_session` response — same shape the creation paths
 * in useSessionCreation.ts consume (snapshot fields optional because the Rust
 * struct hides them via `skip_serializing_if`).
 */
interface CreateSessionResult {
  id: string;
  title: string;
  folder: string;
  shell: string;
  isGitRepo?: boolean;
  snapshotCommit?: string;
}

/**
 * Double-click guard: restart is a two-IPC sequence (close + create). A second
 * click while the first is in flight would spawn a SECOND fresh session for
 * the same card. Module-level (not component state) because the SessionCard
 * unmounts mid-restart when the old session leaves the store — component
 * state could not outlive that unmount.
 */
const restartsInFlight = new Set<string>();

/**
 * Neustart einer Session (Issue #13): beendet die laufende Session und startet
 * eine FRISCHE Session im selben Projektordner mit denselben Einstellungen
 * (Shell, Permission-Mode). Bewusst KEIN `--resume` — Resume existiert als
 * eigener Flow; Neustart bedeutet "sauber neu anfangen".
 *
 * Composition of the existing paths, no new Rust logic:
 * - close: `close_session` + `removeSession` (same as SessionList.handleClose)
 * - create: `create_session` + `addSession` (same as useSessionCreation)
 *
 * Shell wird konkret aus der Session uebernommen (das Backend hat sie beim
 * Erstellen bereits plattformbewusst aufgeloest und zurueckgeechot). Der
 * Permission-Mode kommt aus `session.permissionMode`; Legacy-Sessions ohne
 * das Feld fallen auf den aktuellen Settings-Default zurueck.
 */
export async function restartSession(sessionId: string): Promise<void> {
  if (restartsInFlight.has(sessionId)) return;

  const session = useSessionStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (!session) return;

  restartsInFlight.add(sessionId);
  try {
    const { folder, title, shell } = session;
    const permissionMode =
      session.permissionMode ?? useSettingsStore.getState().defaultPermissionMode;

    // Close the old session first so the fresh PTY never competes with the
    // dying one for the same working directory. A failing close is non-fatal:
    // done/error sessions have no live PTY anymore and the backend may reject
    // the call — the restart must still proceed (that is the edge case the
    // restart button exists for).
    try {
      await wrapInvoke("close_session", { id: sessionId });
    } catch (err) {
      logWarn(
        "sessionRestart",
        `close_session für "${sessionId}" fehlgeschlagen (Session vermutlich bereits beendet): ${err}`,
      );
    }
    useSessionStore.getState().removeSession(sessionId);

    const newId = generateSessionId();
    try {
      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id: newId,
        folder,
        title,
        shell,
        permissionMode,
      });

      const sessions = useSessionStore.getState().sessions;
      useSessionStore.getState().addSession({
        id: result?.id ?? newId,
        title: result?.title ?? title,
        // Fresh runtime session → fresh displayId (same contract as restore).
        displayId: generateUniqueDisplayId(sessions),
        folder: result?.folder ?? folder,
        shell: (result?.shell ?? shell) as SessionShell,
        permissionMode,
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });
    } catch (err) {
      // Surface the failure — the old session is already gone at this point,
      // a silent log would leave the user staring at a vanished card.
      logError("sessionRestart.create", err);
      const info = classifyPrerequisiteError(err);
      useUIStore.getState().addToast({
        type: "error",
        title: info.title,
        message: info.hint,
      });
    }
  } finally {
    restartsInFlight.delete(sessionId);
  }
}
