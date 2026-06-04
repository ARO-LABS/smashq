import { useState, useEffect, useMemo, useRef } from "react";
import { useSettingsStore } from "../../../store/settingsStore";
import {
  useSessionStore,
  selectEffectiveSession,
} from "../../../store/sessionStore";
import { folderLabel } from "../../../utils/pathUtils";

export type NotesTab = "project" | "global";

/** A folder that can be picked as the project-notes context. */
export interface AvailableFolder {
  key: string;
  originalPath: string;
  label: string;
  hasNotes: boolean;
}

/** Everything the notes window needs to render its tabs, picker and textareas. */
export interface ProjectNotesContext {
  activeTab: NotesTab;
  setActiveTab: (tab: NotesTab) => void;
  folderPickerOpen: boolean;
  setFolderPickerOpen: (open: boolean) => void;
  selectedFolder: string | null;
  setSelectedFolder: (folder: string | null) => void;
  effectiveFolderKey: string;
  currentProjectNotes: string;
  setProjectNotes: (folderKey: string, value: string) => void;
  globalNotes: string;
  setGlobalNotes: (value: string) => void;
  availableFolders: AvailableFolder[];
  hasAnyProjectNotes: boolean;
  hasAnyNotes: boolean;
  projectTabLabel: string;
  showFolderPicker: boolean;
  hasProjectContext: boolean;
}

/** Normalize folder path for consistent lookup */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Folder derivation + tab state machine + which-notes-active logic for the
 * notes window. Owns the open-tab default effect (keyed off `open` so a
 * session-output ref churn never overrides the user's manual tab choice).
 *
 * @param open whether the notes window is currently open — drives the
 *   one-shot default-tab selection on the to→open transition.
 */
export function useProjectNotesContext(open: boolean): ProjectNotesContext {
  const [activeTab, setActiveTab] = useState<NotesTab>("project");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);

  const globalNotes = useSettingsStore((s) => s.globalNotes);
  const setGlobalNotes = useSettingsStore((s) => s.setGlobalNotes);
  const projectNotes = useSettingsStore((s) => s.projectNotes);
  const setProjectNotes = useSettingsStore((s) => s.setProjectNotes);
  const favorites = useSettingsStore((s) => s.favorites);
  const activeSession = useSessionStore(selectEffectiveSession);

  // Determine effective folder: session folder takes priority, then manual selection
  const sessionFolderKey = activeSession?.folder
    ? normalizePath(activeSession.folder)
    : "";
  const effectiveFolderKey = sessionFolderKey || selectedFolder || "";
  const currentProjectNotes = effectiveFolderKey
    ? (projectNotes[effectiveFolderKey] ?? "")
    : "";

  // Build list of available folders (favorites + folders with existing notes)
  const availableFolders = useMemo<AvailableFolder[]>(() => {
    const folderMap = new Map<string, AvailableFolder>();

    // Add favorites
    for (const fav of favorites) {
      const key = normalizePath(fav.path);
      folderMap.set(key, {
        key,
        originalPath: fav.path,
        label: fav.label || folderLabel(fav.path),
        hasNotes: key in projectNotes && !!projectNotes[key],
      });
    }

    // Add folders that have notes but aren't in favorites
    for (const noteKey of Object.keys(projectNotes)) {
      if (!folderMap.has(noteKey) && projectNotes[noteKey]) {
        folderMap.set(noteKey, {
          key: noteKey,
          originalPath: noteKey,
          label: folderLabel(noteKey),
          hasNotes: true,
        });
      }
    }

    return Array.from(folderMap.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [favorites, projectNotes]);

  const hasAnyProjectNotes = Object.values(projectNotes).some((v) => !!v);
  const hasAnyNotes = !!globalNotes || hasAnyProjectNotes;

  // Tab-Label: shows the active project's short name (e.g. "agentic-dashboard")
  // when a folder is bound, fallback to the generic "Projekt-Notizen" so the
  // tab still reads sensibly when no project context exists yet.
  const projectTabLabel = effectiveFolderKey
    ? folderLabel(effectiveFolderKey)
    : "Projekt-Notizen";

  // Default-Tab nur beim Übergang von zu→geöffnet setzen.
  // Ohne diesen Guard würde der Effekt bei jedem session-output-Event neu feuern
  // (updateLastOutput spreaded das Session-Objekt → neue Ref → activeSession-Dep
  // ändert sich) und den vom User gewählten Tab überschreiben.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      if (activeSession) {
        setActiveTab("project");
      } else if (availableFolders.length > 0) {
        setActiveTab("project");
        // Auto-select first folder with notes, or first folder
        if (!selectedFolder) {
          const withNotes = availableFolders.find((f) => f.hasNotes);
          setSelectedFolder((withNotes ?? availableFolders[0])?.key ?? null);
        }
      } else {
        setActiveTab("global");
      }
    }
    wasOpenRef.current = open;
  }, [open, activeSession, availableFolders, selectedFolder]);

  const showFolderPicker = activeTab === "project" && !activeSession;
  const hasProjectContext = !!effectiveFolderKey;

  return {
    activeTab,
    setActiveTab,
    folderPickerOpen,
    setFolderPickerOpen,
    selectedFolder,
    setSelectedFolder,
    effectiveFolderKey,
    currentProjectNotes,
    setProjectNotes,
    globalNotes,
    setGlobalNotes,
    availableFolders,
    hasAnyProjectNotes,
    hasAnyNotes,
    projectTabLabel,
    showFolderPicker,
    hasProjectContext,
  };
}
