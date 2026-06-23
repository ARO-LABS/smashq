import { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore } from "../../store/settingsStore";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
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
import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { ClaudeSession } from "../../store/sessionStore";
import type { FavoriteFolder } from "../../store/settingsStore";

interface SessionListProps {
  onNewSession: () => void;
  onQuickStart: (favorite: FavoriteFolder) => void;
}

/** Active/waiting sessions first, then done/error. Within each group: by createdAt. */
function sortSessions(sessions: ClaudeSession[]): ClaudeSession[] {
  const activeStatuses = new Set(["starting", "running", "waiting"]);
  return [...sessions].sort((a, b) => {
    const aActive = activeStatuses.has(a.status) ? 0 : 1;
    const bActive = activeStatuses.has(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return a.createdAt - b.createdAt;
  });
}

// ── SortableSessionRow ────────────────────────────────────────────────────────

interface SortableSessionRowProps {
  session: ClaudeSession;
  isActive: boolean;
  isInGrid: boolean;
  onClick: (id: string) => void;
  onClose: (id: string) => void;
}

function SortableSessionRow({
  session,
  isActive,
  isInGrid,
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

  const DragHandle = ICONS.action.dragHandle;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group"
    >
      {/* Drag handle — visible only on row hover (Card-Action-Chrome pattern) */}
      <button
        {...attributes}
        {...listeners}
        aria-label="Session-Drag-Handle"
        className="absolute top-1/2 left-0 -translate-y-1/2 z-10
                   opacity-0 group-hover:opacity-60 hover:opacity-100
                   cursor-grab active:cursor-grabbing
                   text-neutral-400 hover:text-neutral-200
                   p-0.5 focus-visible:outline-none"
        tabIndex={0}
      >
        <DragHandle className={ICON_SIZE.inline} aria-hidden="true" />
      </button>

      <SessionCard
        session={session}
        isActive={isActive}
        isInGrid={isInGrid}
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

  const sorted = sortSessions(sessions);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const ids = sorted.map((s) => s.id);
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      reorderSessions(arrayMove(ids, from, to));
    },
    [sorted, reorderSessions],
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
            <SortableContext items={sorted.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              {sorted.map((session) => {
                const isInGrid = gridSessionIds.includes(session.id);
                return (
                  <SortableSessionRow
                    key={session.id}
                    session={session}
                    isActive={
                      layoutMode === "grid"
                        ? session.id === focusedGridSessionId
                        : session.id === activeSessionId
                    }
                    isInGrid={isInGrid}
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
        <OpenMdPathInput
          variant="panel"
          onOpen={(p) => {
            const { folder, relativePath } = splitAbsolutePath(p);
            if (!folder || !relativePath) return;
            invoke("open_md_in_editor", { folder, relativePath }).catch((err: unknown) =>
              logError("SessionList.openMdInEditor", err),
            );
          }}
        />
      </div>

      {/* Bottom dock — global launchers + theme + notes + version + session actions */}
      <SessionPanelDock onNewSession={onNewSession} onAddFavorite={handleAddFavorite} />
    </div>
  );
}
