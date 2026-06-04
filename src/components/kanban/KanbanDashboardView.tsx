import { useState, useEffect } from "react";
import { Columns3 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { KanbanBoard } from "./KanbanBoard";
import { useSessionStore, selectEffectiveSession } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";

type BoardMode = "global" | "folder";

/**
 * Dashboard-level Kanban view (SideNav tab).
 *
 * Two modes:
 * - "global" (default) — shows the user's GitHub Projects v2 board without
 *   requiring a folder. Works even with no active session or favorites.
 * - "folder" — the existing folder-scoped board. Requires an active session
 *   or at least one favorite.
 */
export function KanbanDashboardView() {
  const [boardMode, setBoardMode] = useState<BoardMode>("global");
  const activeSession = useSessionStore(selectEffectiveSession);
  const favorites = useSettingsStore((s) => s.favorites);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [validGitFolders, setValidGitFolders] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function checkFolders() {
      const foldersToCheck = new Set<string>();
      if (activeSession?.folder) foldersToCheck.add(activeSession.folder);
      favorites.forEach((f) => foldersToCheck.add(f.path));

      const valid = new Set<string>();
      for (const folder of Array.from(foldersToCheck)) {
        if (cancelled) return;
        try {
          await invoke("get_git_info", { folder });
          valid.add(folder);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (err) {
          // not a git repo
        }
      }
      if (cancelled) return;
      setValidGitFolders(valid);
    }
    checkFolders();
    return () => { cancelled = true; };
  }, [activeSession?.folder, favorites]);

  // Compute available git folders
  const isSessionValid = activeSession && validGitFolders.has(activeSession.folder);
  const validFavorites = favorites.filter(f => f.path !== activeSession?.folder && validGitFolders.has(f.path));

  const availableOptions = [
    ...(isSessionValid ? [activeSession.folder] : []),
    ...validFavorites.map(f => f.path)
  ];

  let folderModeFolder = selectedFolder;
  if (!folderModeFolder || !availableOptions.includes(folderModeFolder)) {
    folderModeFolder = availableOptions.length > 0 ? availableOptions[0] : null;
  }


  // ── Mode toggle ───────────────────────────────────────────────────────

  const modeToggle = (
    <div className="flex items-center gap-0.5 rounded-md shadow-hairline p-0.5 bg-surface-raised">
      {(["global", "folder"] as BoardMode[]).map((m) => (
        <button
          key={m}
          onClick={() => setBoardMode(m)}
          className={`px-2.5 py-0.5 text-xs rounded-sm transition-colors ${
            boardMode === m
              ? "bg-accent-a10 text-accent"
              : "text-neutral-500 hover:text-neutral-300 hover:bg-hover-overlay"
          }`}
        >
          {m === "global" ? "Global" : "Projekt"}
        </button>
      ))}
    </div>
  );

  // ── Global mode ───────────────────────────────────────────────────────

  if (boardMode === "global") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
          <Columns3 className="w-3.5 h-3.5 text-neutral-500" />
          <span className="text-sm font-semibold text-neutral-300 mr-auto">Globales Board</span>
          {modeToggle}
        </div>
        <div className="flex-1 min-h-0">
          <KanbanBoard folder={null} />
        </div>
      </div>
    );
  }

  // ── Folder mode ───────────────────────────────────────────────────────

  if (!folderModeFolder && availableOptions.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
          {modeToggle}
        </div>
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-neutral-500">
          <Columns3 className="w-10 h-10 text-neutral-600" />
          <span className="text-sm">Kein Projekt verfügbar</span>
          <span className="text-xs text-neutral-600">
            Erstelle eine Session oder füge einen Favoriten hinzu.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: folder picker + mode toggle */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800 shrink-0">
        <span className="text-xs text-neutral-500">Projekt:</span>
        <select
          value={folderModeFolder ?? ""}
          onChange={(e) => setSelectedFolder(e.target.value || null)}
          className="text-xs rounded-md bg-surface-raised shadow-hairline text-neutral-300 px-2 py-1 outline-none focus:ring-1 focus:ring-accent focus:ring-inset transition-shadow duration-150 max-w-xs"
        >
          {isSessionValid && (
            <option value={activeSession.folder}>
              {activeSession.title} (aktive Session)
            </option>
          )}
          {validFavorites.map((fav) => (
              <option key={fav.id} value={fav.path}>
                {fav.label}
              </option>
            ))}
        </select>
        <div className="ml-auto">{modeToggle}</div>
      </div>

      {/* Board */}
      {folderModeFolder ? (
        <div className="flex-1 min-h-0">
          <KanbanBoard folder={folderModeFolder} />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-neutral-500">
          <Columns3 className="w-10 h-10 text-neutral-600" />
          <span className="text-sm">Projekt auswählen</span>
        </div>
      )}
    </div>
  );
}
