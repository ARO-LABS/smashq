import { wrapInvoke } from "../../../utils/perfLogger";
import {
  useSessionStore,
  generateUniqueDisplayId,
  generateSessionId,
} from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUIStore } from "../../../store/uiStore";
import { logError, logWarn } from "../../../utils/errorLogger";
import { classifyPrerequisiteError } from "../../../utils/adpError";
import type { SessionShell, CreateSessionResult } from "../../../store/sessionStore";

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
 * Shell wird konkret aus der Session übernommen (das Backend hat sie beim
 * Erstellen bereits plattformbewusst aufgelöst und zurückgeechot). Der
 * Permission-Mode kommt aus `session.permissionMode`; Legacy-Sessions ohne
 * das Feld fallen auf den aktuellen Settings-Default zurück.
 */
export async function restartSession(sessionId: string): Promise<void> {
  if (restartsInFlight.has(sessionId)) return;

  const session = useSessionStore
    .getState()
    .sessions.find((s) => s.id === sessionId);
  if (!session) return;

  restartsInFlight.add(sessionId);
  try {
    const { folder, title, shell, status } = session;
    const permissionMode =
      session.permissionMode ?? useSettingsStore.getState().defaultPermissionMode;

    // Grid-Zustand VOR dem Entfernen festhalten: removeSession streicht die
    // Session aus `gridSessionIds` und flippt `layoutMode` auf "single", wenn
    // sie das letzte Grid-Mitglied war. Ohne Wiederherstellung verlöre ein
    // Neustart im Grid still den Grid-Platz der Session (Review-Finding PR #44).
    const { gridSessionIds, layoutMode, focusedGridSessionId } =
      useSessionStore.getState();
    const wasInGrid = gridSessionIds.includes(sessionId);
    const wasGridLayout = layoutMode === "grid";

    // Close the old session first so the fresh PTY never competes with the
    // dying one for the same working directory. A failing close is non-fatal:
    // done/error sessions have no live PTY anymore and the backend may reject
    // the call — the restart must still proceed (that is the edge case the
    // restart button exists for).
    try {
      await wrapInvoke("close_session", { id: sessionId });
    } catch (err) {
      // Ehrliche Diagnose statt Vermutung: bei done/error existiert kein
      // lebendes PTY mehr, der Reject ist erwartbar. Lehnt das Backend den
      // Close einer noch LAUFENDEN Session ab, kann der alte Prozess dagegen
      // als Orphan weiterlaufen — das verdient eine deutlichere Warnung.
      if (status === "done" || status === "error") {
        logWarn(
          "sessionRestart",
          `close_session für "${sessionId}" fehlgeschlagen (Session bereits beendet, Status "${status}"): ${err}`,
        );
      } else {
        logWarn(
          "sessionRestart",
          `close_session für "${sessionId}" fehlgeschlagen, obwohl die Session noch "${status}" war — der alte Prozess läuft möglicherweise als Orphan weiter: ${err}`,
        );
      }
    }

    // TOCTOU-Re-Check nach dem await: der User kann die Session währenddessen
    // per X geschlossen haben (SessionList.handleClose lief und hat sie aus dem
    // Store entfernt). Dann ist der Neustart gegenstandslos — ein create würde
    // eine Session erzeugen, die niemand mehr angefordert hat.
    if (!useSessionStore.getState().sessions.some((s) => s.id === sessionId)) {
      return;
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
      const freshId = result?.id ?? newId;
      useSessionStore.getState().addSession({
        id: freshId,
        title: result?.title ?? title,
        // Fresh runtime session → fresh displayId (same contract as restore).
        displayId: generateUniqueDisplayId(sessions),
        folder: result?.folder ?? folder,
        shell: (result?.shell ?? shell) as SessionShell,
        permissionMode,
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });

      // Grid-Platz wiederherstellen — addSession fügt bewusst NICHT ins Grid
      // ein, das muss der Aufrufer tun (wie SessionList/useSessionRestore).
      if (wasInGrid) {
        const store = useSessionStore.getState();
        store.addToGrid(freshId);
        // addToGrid fokussiert die neue Zelle; lag der Fokus vorher auf einer
        // ANDEREN Zelle, gehört er dorthin zurück (kein Fokus-Klau).
        if (focusedGridSessionId && focusedGridSessionId !== sessionId) {
          store.setFocusedGridSession(focusedGridSessionId);
        }
        // War die Session das letzte Grid-Mitglied, hat removeSession den
        // layoutMode auf "single" geflippt — zurück in den Grid-Modus.
        // (addToGrid kennt keinen Slot-Index; die neue Session landet am Ende
        // der Komposition — bewusst akzeptiert statt neuer Store-API.)
        if (wasGridLayout && useSessionStore.getState().layoutMode !== "grid") {
          store.setLayoutMode("grid");
        }
      }

      // Parität mit useSessionCreation: eine offene Favoriten-Preview schließen,
      // damit die frische Session nicht hinter dem Preview-Panel verschwindet.
      useUIStore.getState().closePreview();
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
