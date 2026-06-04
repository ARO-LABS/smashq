import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { wrapInvoke } from "../../../utils/perfLogger";
import { useSessionStore, generateUniqueDisplayId } from "../../../store/sessionStore";
import { useSettingsStore } from "../../../store/settingsStore";
import { useUIStore } from "../../../store/uiStore";
import { logError } from "../../../utils/errorLogger";
import type { FavoriteFolder, SettingsState } from "../../../store/settingsStore";
import type { SessionShell } from "../../../store/sessionStore";

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function extractFolderName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "session";
}

/**
 * Resolves the user's `defaultShell` preference into a concrete shell that the
 * Rust session backend understands. "auto" picks PowerShell on Windows (the
 * primary supported platform); "bash" maps to gitbash since that is the actual
 * Windows-side bash shell available to the PTY backend.
 */
function resolveDefaultShell(pref: SettingsState["defaultShell"]): SessionShell {
  if (pref === "powershell" || pref === "cmd") return pref;
  if (pref === "bash" || pref === "zsh") return "gitbash";
  return "powershell"; // "auto" → safe Windows default
}

export interface UseSessionCreationReturn {
  handleResumeSession: (resumeSessionId: string, cwd: string, title?: string) => Promise<void>;
  handleQuickStart: (favorite: FavoriteFolder) => Promise<void>;
  handleNewSessionFromDefaults: () => Promise<void>;
}

/**
 * Shape returned by the Rust `create_session` command — mirrors `SessionInfo`
 * with the snapshot fields renamed for camelCase consumption.
 *
 * The diff-window feature relies on `isGitRepo`/`snapshotCommit` to decide
 * whether to render the Diff-Button + whether the future diff-call has a
 * baseline to compare against. Both fields are optional because the Rust
 * struct hides them via `skip_serializing_if = "Option::is_none"`.
 */
interface CreateSessionResult {
  id: string;
  title: string;
  folder: string;
  shell: string;
  isGitRepo?: boolean;
  snapshotCommit?: string;
}

export function useSessionCreation(): UseSessionCreationReturn {
  const handleResumeSession = useCallback(
    async (resumeSessionId: string, cwd: string, resumeTitle?: string) => {
      const id = generateSessionId();
      const title = resumeTitle ?? "Resume Session";
      const shell = "powershell";

      try {
        const result = await wrapInvoke<CreateSessionResult>("create_session", {
          id,
          folder: cwd,
          title,
          shell,
          resumeSessionId,
        });

        const sessionId = result?.id ?? id;
        const sessions = useSessionStore.getState().sessions;
        useSessionStore.getState().addSession({
          id: sessionId,
          title: result?.title ?? title,
          displayId: generateUniqueDisplayId(sessions),
          folder: result?.folder ?? cwd,
          shell: (result?.shell ?? shell) as SessionShell,
          claudeSessionId: resumeSessionId,
          isGitRepo: result?.isGitRepo,
          snapshotCommit: result?.snapshotCommit,
        });
      } catch (err) {
        logError("useSessionCreation.resumeSession", err);
      }
    },
    [],
  );

  const handleQuickStart = useCallback(async (favorite: FavoriteFolder) => {
    const id = generateSessionId();
    const title = favorite.label;
    const folder = favorite.path;
    const shell = favorite.shell;

    try {
      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id,
        folder,
        title,
        shell,
      });

      const sessionId = result?.id ?? id;
      const sessions = useSessionStore.getState().sessions;
      useSessionStore.getState().addSession({
        id: sessionId,
        title: result?.title ?? title,
        displayId: generateUniqueDisplayId(sessions),
        folder: result?.folder ?? folder,
        shell: (result?.shell ?? shell) as SessionShell,
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });
      useSettingsStore.getState().updateFavoriteLastUsed(favorite.id);
      useUIStore.getState().closePreview();
    } catch (err) {
      logError("useSessionCreation.quickStart", err);
    }
  }, []);

  /**
   * Ein-Klick: starts a session using the persisted defaults. Falls back to a
   * folder picker when no default project path is set, then nudges the user
   * to save it via a toast action so the next click is truly one-tap.
   */
  const handleNewSessionFromDefaults = useCallback(async () => {
    const settings = useSettingsStore.getState();
    let folder = settings.defaultProjectPath;
    let pickedFolder: string | null = null;

    if (!folder) {
      try {
        const picked = await open({
          directory: true,
          multiple: false,
          title: "Arbeitsordner wählen",
        });
        if (!picked || typeof picked !== "string") return;
        folder = picked;
        pickedFolder = picked;
      } catch (err) {
        logError("useSessionCreation.newSession.pickFolder", err);
        return;
      }
    }

    const id = generateSessionId();
    const shell = resolveDefaultShell(settings.defaultShell);
    const title = extractFolderName(folder);

    try {
      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id,
        folder,
        title,
        shell,
      });

      const sessionId = result?.id ?? id;
      const sessions = useSessionStore.getState().sessions;
      useSessionStore.getState().addSession({
        id: sessionId,
        title: result?.title ?? title,
        displayId: generateUniqueDisplayId(sessions),
        folder: result?.folder ?? folder,
        shell: (result?.shell ?? shell) as SessionShell,
        isGitRepo: result?.isGitRepo,
        snapshotCommit: result?.snapshotCommit,
      });
      useUIStore.getState().closePreview();

      // Only nudge the user to bookmark this folder once the session
      // actually started — inviting a save for a path that just failed
      // would be misleading.
      if (pickedFolder) {
        const folderToSave = pickedFolder;
        useUIStore.getState().addToast({
          type: "info",
          title: "Default speichern?",
          message: "Setze diesen Ordner in Einstellungen, dann startet der Klick sofort.",
          duration: 8000,
          action: {
            label: "Speichern",
            onClick: () => useSettingsStore.getState().setDefaultProjectPath(folderToSave),
          },
        });
      }
    } catch (err) {
      logError("useSessionCreation.newSession.create", err);
      useUIStore.getState().addToast({
        type: "error",
        title: "Session-Start fehlgeschlagen",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  return { handleResumeSession, handleQuickStart, handleNewSessionFromDefaults };
}
