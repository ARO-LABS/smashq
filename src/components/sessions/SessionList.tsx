import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../store/settingsStore";
import { DndContext, closestCenter } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { useSidebarSensors } from "./hooks/useSidebarDnd";
import { CSS } from "@dnd-kit/utilities";
import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";
import { SessionCard } from "./SessionCard";
import { FavoritesList } from "./FavoritesList";
import { SessionPanelDock } from "./SessionPanelDock";
import { OpenMdPathInput } from "../shared/OpenMdPathInput";
import { splitAbsolutePath } from "../../store/editorStore";
import { logError } from "../../utils/errorLogger";
import type { ClaudeSession } from "../../store/sessionStore";
import type { FavoriteFolder } from "../../store/settingsStore";

interface SessionListProps {
  onNewSession: () => void;
  onQuickStart: (favorite: FavoriteFolder) => void;
}

// ── SortableSessionRow ────────────────────────────────────────────────────────

interface SortableSessionRowProps {
  session: ClaudeSession;
  isActive: boolean;
  gridSlot?: { index: number; count: number };
  onClick: (id: string) => void;
  onClose: (id: string) => void;
}

function SortableSessionRow({
  session,
  isActive,
  gridSlot,
  onClick,
  onClose,
}: SortableSessionRowProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: session.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    // Whole row is the drag surface. The SmartPointerSensor spares the
    // card's action buttons; the 6px activation distance spares plain
    // clicks (activate session) and double-clicks (rename).
    <div
      ref={setNodeRef}
      style={style}
      className={`relative group select-none ${isDragging ? "cursor-grabbing" : ""}`}
      {...attributes}
      {...listeners}
    >
      <SessionCard
        session={session}
        isActive={isActive}
        gridSlot={gridSlot}
        onClick={onClick}
        onClose={onClose}
      />
    </div>
  );
}

// ── SessionList ───────────────────────────────────────────────────────────────

export function SessionList({ onNewSession, onQuickStart }: SessionListProps): JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const layoutMode = useSessionStore((s) => s.layoutMode);
  const gridSessionIds = useSessionStore((s) => s.gridSessionIds);
  const focusedGridSessionId = useSessionStore((s) => s.focusedGridSessionId);
  const reorderSessions = useSessionStore((s) => s.reorderSessions);
  const addFavorite = useSettingsStore((s) => s.addFavorite);

  const handleAddFavorite = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "Ordner als Favorit hinzufügen" });
      if (selected && typeof selected === "string") addFavorite(selected);
    } catch (err) {
      logError("SessionList.folderPicker", err);
    }
  }, [addFavorite]);

  const sensors = useSidebarSensors();

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      // Index into the stored order — the same order the list renders and
      // reorderSessions persists. Deriving indices from a re-sorted copy would
      // desync the arrayMove from what the user sees.
      const ids = sessions.map((s) => s.id);
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      reorderSessions(arrayMove(ids, from, to));
    },
    [sessions, reorderSessions],
  );

  const handleClick = useCallback((sessionId: string) => {
    const store = useSessionStore.getState();
    if (store.layoutMode === "grid") {
      if (store.gridSessionIds.includes(sessionId)) {
        store.setFocusedGridSession(sessionId);
      } else if (store.gridSessionIds.length < 4) {
        store.addToGrid(sessionId);
      } else {
        store.maximizeGridSession(sessionId);
        // Maximieren = "zeig mir diese Session" → einen offenen Grid-Preview
        // abraeumen, sonst legt sich FavoritePreview im Single-Mode drueber.
        useUIStore.getState().closePreview();
      }
    } else {
      store.setActiveSession(sessionId);
      useUIStore.getState().closePreview();
    }
  }, []);

  const handleClose = useCallback((sessionId: string) => {
    invoke("close_session", { id: sessionId }).catch((err) =>
      logError("SessionList.closeSession", err)
    );
    useSessionStore.getState().removeSession(sessionId);
  }, []);

  const handleOpenMd = useCallback((p: string) => {
    const { folder, relativePath } = splitAbsolutePath(p);
    if (!folder || !relativePath) return;
    invoke("open_md_in_editor", { folder, relativePath }).catch((err: unknown) =>
      logError("SessionList.openMdInEditor", err),
    );
  }, []);

  return (
    <div className="relative flex flex-col h-full bg-surface-base">
      {/* Scrollable content: Favorites + Sessions */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Favorites section */}
        <FavoritesList onQuickStart={onQuickStart} />

        {/* Divider between favorites and sessions — no section label */}
        <div className="h-px bg-neutral-800 mx-3 my-1.5" />

        {/* Session rows — flat, no box */}
        <div className="flex flex-col gap-0.5 pl-2 pr-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sessions.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sessions.map((session) => {
                // Grid slot drives the position-aware mini-map. index+count
                // mirror what SessionManagerView feeds getGridStyle, so the
                // indicator matches the actual terminal layout.
                const gridIndex = gridSessionIds.indexOf(session.id);
                const gridSlot =
                  gridIndex >= 0
                    ? { index: gridIndex, count: Math.min(Math.max(gridSessionIds.length, 1), 4) }
                    : undefined;
                return (
                  <SortableSessionRow
                    key={session.id}
                    session={session}
                    isActive={
                      layoutMode === "grid"
                        ? session.id === focusedGridSessionId
                        : session.id === activeSessionId
                    }
                    gridSlot={gridSlot}
                    onClick={handleClick}
                    onClose={handleClose}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          {sessions.length === 0 && (
            <div className="p-3 text-center text-neutral-500 text-xs">Keine Sessions vorhanden</div>
          )}
        </div>
      </div>

      {/* Quick-open: paste a .md path → editor opens it (one step, no dialog) */}
      <div className="shrink-0 border-t border-neutral-800">
        <OpenMdPathInput variant="panel" onOpen={handleOpenMd} />
      </div>

      {/* Bottom dock — global launchers + theme + notes + version + session actions */}
      <SessionPanelDock onNewSession={onNewSession} onAddFavorite={handleAddFavorite} />
    </div>
  );
}
