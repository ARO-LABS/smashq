import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, Columns3, AlertCircle, ChevronDown } from "lucide-react";
import { getErrorMessage } from "../../utils/adpError";
import { wrapInvoke } from "../../utils/perfLogger";
import { KanbanCard, type KanbanIssue } from "./KanbanCard";
import { KanbanDetailModal } from "./KanbanDetailModal";
import { useProjectStore } from "../../store/projectStore";
import { logError } from "../../utils/errorLogger";

// ── Types from backend ────────────────────────────────────────────────

interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  items_total: number;
}

interface ProjectLane {
  option_id: string;
  name: string;
  order: number;
}

interface ProjectItem {
  item_id: string;
  issue_number: number;
  title: string;
  assignee: string;
  labels: { name: string; color: string }[];
  url: string;
  state: string;
  current_lane_option_id: string | null;
  /** `"owner/name"` — set for cross-repo items in global board, null for same-repo. */
  repository?: string | null;
}

interface ProjectBoard {
  project_id: string;
  status_field_id: string;
  lanes: ProjectLane[];
  items: ProjectItem[];
}

// ── Cache ─────────────────────────────────────────────────────────────

interface CacheEntry {
  board: ProjectBoard;
  timestamp: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000;

/** Per-project-list cache so reopening the picker doesn't re-invoke. */
interface ProjectListEntry {
  projects: ProjectSummary[];
  timestamp: number;
}
const projectListCache = new Map<string, ProjectListEntry>();
const PROJECT_LIST_TTL = 30_000;

/** Fixed lane width — every Kanban column (incl. the "no status" column) uses this. */
const LANE_WIDTH_CLASS = "w-[260px] min-w-[260px]";

/** Converts a backend ProjectItem to the KanbanIssue shape the card expects. */
function toKanbanIssue(item: ProjectItem): KanbanIssue {
  return {
    itemId: item.item_id,
    number: item.issue_number,
    title: item.title,
    state: item.state,
    labels: item.labels,
    assignee: item.assignee,
    url: item.url,
    repository: item.repository ?? null,
  };
}

// ── Props ─────────────────────────────────────────────────────────────

interface KanbanBoardProps {
  /** Folder path for folder-mode boards; null for the global user board. */
  folder: string | null;
}

// ── Component ─────────────────────────────────────────────────────────

export function KanbanBoard({ folder }: KanbanBoardProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  /** Tracks the clicked card — stores number + repository for cross-repo modal. */
  const [selectedIssue, setSelectedIssue] = useState<{
    number: number;
    repository: string | null;
  } | null>(null);
  const [dragOverOptionId, setDragOverOptionId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null); // item_id being moved
  const [moveError, setMoveError] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const { setFolderProject, getProjectForFolder, setGlobalProject, getGlobalProject } =
    useProjectStore();

  /** True when operating in folder-free global user-board mode. */
  const isGlobal = folder === null;

  /** Resolves the active project — global board or the folder's project. */
  const resolveProject = useCallback(
    () => (isGlobal ? getGlobalProject() : getProjectForFolder(folder ?? "")),
    [folder, isGlobal, getGlobalProject, getProjectForFolder]
  );

  /** Builds the board cache key for a project number. */
  const cacheKeyFor = useCallback(
    (projectNumber: number) =>
      isGlobal ? `global:${projectNumber}` : `${folder}:${projectNumber}`,
    [folder, isGlobal]
  );

  /** Drops the cached board for the active project so the next load re-fetches. */
  const invalidateBoardCache = useCallback(() => {
    const proj = resolveProject();
    if (proj) cache.delete(cacheKeyFor(proj.projectNumber));
  }, [resolveProject, cacheKeyFor]);

  /** Stable ref pointing to the latest board — used in drag-drop callbacks
   * to avoid stale-closure issues without listing `board` in useCallback deps. */
  const boardRef = useRef<ProjectBoard | null>(null);
  const draggedItemRef = useRef<{ itemId: string; issueNumber: number } | null>(
    null
  );
  /** AbortController für die globalen PointerEvent-Listener des aktiven Drags.
   * Wird beim pointerup und beim Unmount der Komponente abgebrochen, damit
   * keine Listener-Leaks entstehen, wenn die Komponente während eines Drags
   * unmountet wird. */
  const dragAbortRef = useRef<AbortController | null>(null);

  const selectedProject = resolveProject();

  // Keep boardRef in sync on every render.
  boardRef.current = board;

  // Group items by lane once — avoids O(lanes × items) re-filtering per render.
  const itemsByLane = useMemo(() => {
    const map = new Map<string | null, ProjectItem[]>();
    for (const item of board?.items ?? []) {
      const existing = map.get(item.current_lane_option_id);
      if (existing) existing.push(item);
      else map.set(item.current_lane_option_id, [item]);
    }
    return map;
  }, [board]);

  // Cleanup globaler Drag-Listener beim Unmount, damit kein Listener-Leak
  // entsteht, wenn die Komponente während eines aktiven Drags unmountet wird.
  useEffect(() => {
    return () => {
      dragAbortRef.current?.abort();
    };
  }, []);

  // ── Data loading ────────────────────────────────────────────────────

  const loadProjects = useCallback(
    async (signal: AbortSignal) => {
      const listKey = isGlobal ? "__global__" : (folder ?? "__null__");
      const cached = projectListCache.get(listKey);
      if (cached && Date.now() - cached.timestamp < PROJECT_LIST_TTL) {
        if (!signal.aborted) setProjects(cached.projects);
        return cached.projects;
      }

      try {
        const result = await wrapInvoke<ProjectSummary[]>("list_user_projects", {
          folder,
        });
        if (signal.aborted) return result;
        projectListCache.set(listKey, { projects: result, timestamp: Date.now() });
        setProjects(result);
        return result;
      } catch (err) {
        if (!signal.aborted) {
          setError(getErrorMessage(err));
          setLoading(false);
        }
        return [];
      }
    },
    [folder, isGlobal]
  );

  const loadBoard = useCallback(
    async (signal: AbortSignal, forceRefresh = false) => {
      const proj = resolveProject();
      if (!proj) return;

      const cacheKey = cacheKeyFor(proj.projectNumber);

      if (!forceRefresh) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          if (!signal.aborted) {
            setBoard(cached.board);
            setError("");
            setLoading(false);
          }
          return;
        }
      }

      if (!signal.aborted) {
        setLoading(true);
        setError("");
      }

      try {
        const result = await wrapInvoke<ProjectBoard>("get_project_board", {
          projectNumber: proj.projectNumber,
          projectId: proj.projectId,
          folder,
        });
        if (signal.aborted) return;
        const cacheEntry: CacheEntry = { board: result, timestamp: Date.now() };
        cache.set(cacheKey, cacheEntry);
        setBoard(result);
        setLoading(false);
      } catch (err) {
        if (!signal.aborted) {
          setError(getErrorMessage(err));
          setLoading(false);
        }
      }
    },
    [folder, resolveProject, cacheKeyFor]
  );

  // Single effect keyed on both folder and selected project number.
  // AbortController prevents stale async callbacks from updating state after
  // unmount or before the next effect fires.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setLoading(true);
    setError("");
    setBoard(null);

    const proj = resolveProject();

    if (proj) {
      // Project already known (e.g. user switched via picker) — load board directly.
      void loadBoard(signal);
    } else {
      // First visit: load project list, auto-select first, then board.
      void loadProjects(signal).then((list) => {
        if (signal.aborted || list.length === 0) return;
        const auto = { projectNumber: list[0].number, projectId: list[0].id, title: list[0].title };
        if (isGlobal) setGlobalProject(auto);
        else setFolderProject(folder ?? "", auto);
        // loadBoard reads store — defer one tick so Zustand state has updated.
        void loadBoard(signal);
      });
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, isGlobal, selectedProject?.projectNumber]);

  // ── Drag & drop ─────────────────────────────────────────────────────

  const handleDropLane = useCallback(
    async (targetOptionId: string) => {
      const dragged = draggedItemRef.current;
      draggedItemRef.current = null;
      setDragOverOptionId(null);

      // Read current board from ref — avoids stale closure, always up-to-date.
      const currentBoard = boardRef.current;
      if (!dragged || !currentBoard) return;

      const item = currentBoard.items.find((i) => i.item_id === dragged.itemId);
      if (!item || item.current_lane_option_id === targetOptionId) return;

      setMoving(dragged.itemId);
      setMoveError(null);

      // Snapshot the item IDs before update so rollback targets the right item.
      const movedItemId = dragged.itemId;
      const previousOptionId = item.current_lane_option_id;

      // Optimistic update via functional updater — no stale board captured.
      setBoard((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((i) =>
            i.item_id === movedItemId
              ? { ...i, current_lane_option_id: targetOptionId }
              : i
          ),
        };
      });

      try {
        await invoke("move_project_item", {
          projectId: currentBoard.project_id,
          itemId: movedItemId,
          fieldId: currentBoard.status_field_id,
          optionId: targetOptionId,
          folder,
        });
        // Invalidate cache so next refresh reflects server state.
        invalidateBoardCache();
      } catch (err) {
        logError("KanbanBoard.moveItem", err);
        setMoveError(
          `Verschieben fehlgeschlagen: ${getErrorMessage(err)}`
        );
        // Rollback via functional updater — restores the specific item only,
        // does not clobber any concurrent board changes.
        setBoard((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map((i) =>
              i.item_id === movedItemId
                ? { ...i, current_lane_option_id: previousOptionId }
                : i
            ),
          };
        });
      } finally {
        setMoving(null);
      }
    },
    [folder, invalidateBoardCache]
  );

  const startGlobalDragListeners = useCallback(() => {
    // Vorherigen AbortController defensiv abbrechen (z.B. bei rapid-fire Drags).
    dragAbortRef.current?.abort();
    dragAbortRef.current = new AbortController();
    const { signal } = dragAbortRef.current;

    const onMove = (e: PointerEvent) => {
      if (!draggedItemRef.current) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const laneEl = els.find((el) => el.hasAttribute("data-lane-id"));
      const next = laneEl?.getAttribute("data-lane-id") ?? null;
      // Change-guard: pointermove fires per pixel; only commit when the
      // resolved lane actually changes. Re-setting state every move would
      // re-render the whole board (all lanes + cards) on every frame.
      setDragOverOptionId((prev) => (prev === next ? prev : next));
    };

    const onUp = (e: PointerEvent) => {
      // Signal abbrechen entfernt beide Listener automatisch.
      dragAbortRef.current?.abort();
      dragAbortRef.current = null;
      if (!draggedItemRef.current) return;
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      const laneEl = els.find((el) => el.hasAttribute("data-lane-id"));
      const optionId = laneEl?.getAttribute("data-lane-id") ?? null;
      if (optionId) void handleDropLane(optionId);
      else {
        draggedItemRef.current = null;
        setDragOverOptionId(null);
      }
    };

    window.addEventListener("pointermove", onMove, { signal });
    window.addEventListener("pointerup", onUp, { signal });
  }, [handleDropLane]);

  // ── Project picker ───────────────────────────────────────────────────

  const handleSelectProject = (proj: ProjectSummary) => {
    const entry = { projectNumber: proj.number, projectId: proj.id, title: proj.title };
    if (isGlobal) setGlobalProject(entry);
    else setFolderProject(folder ?? "", entry);
    setProjectPickerOpen(false);
    // State update above triggers the useEffect via selectedProject?.projectNumber dep.
  };

  /** Renders a draggable KanbanCard for a board item — shared by all columns.
   * useCallback keeps its identity stable across re-renders; combined with the
   * memoized KanbanCard this means a lane re-render does not force every card
   * in it to re-render. */
  const renderCard = useCallback(
    (item: ProjectItem) => (
      <KanbanCard
        key={item.item_id}
        issue={toKanbanIssue(item)}
        onClick={() =>
          setSelectedIssue({
            number: item.issue_number,
            repository: item.repository ?? null,
          })
        }
        onDragStart={() => {
          draggedItemRef.current = {
            itemId: item.item_id,
            issueNumber: item.issue_number,
          };
          startGlobalDragListeners();
        }}
        onDragEnd={() => {
          draggedItemRef.current = null;
          setDragOverOptionId(null);
        }}
      />
    ),
    [startGlobalDragListeners]
  );

  // ── Loading / error states ───────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade Kanban-Daten...
      </div>
    );
  }

  if (error) {
    const isScope = error.toLowerCase().includes("project");
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <AlertCircle className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Fehler beim Laden des Boards</span>
        <span className="text-xs text-neutral-600 max-w-md text-center">
          {isScope
            ? 'GitHub Scope fehlt. Führe aus: gh auth refresh -s project,read:project'
            : error}
        </span>
        <button
          onClick={() => {
            const controller = new AbortController();
            setError("");
            void loadBoard(controller.signal, true);
          }}
          className="mt-2 px-3 py-1.5 text-xs rounded-md bg-surface-raised text-neutral-300 shadow-hairline hover:shadow-lift hover:bg-hover-overlay hover:text-neutral-100 transition-shadow duration-200"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!board) return null;

  const itemCount = board.items.length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-2">
          <Columns3 className="w-4 h-4 text-neutral-400" />
          {/* Project selector */}
          <div className="relative">
            <button
              onClick={() => setProjectPickerOpen((o) => !o)}
              className="flex items-center gap-1 text-xs text-neutral-300 hover:text-neutral-100 transition-colors"
            >
              <span className="font-medium">
                {selectedProject?.title ?? "Projekt wählen"}
              </span>
              <ChevronDown className="w-3 h-3 text-neutral-500" />
            </button>
            {projectPickerOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-surface-raised rounded-md shadow-lift min-w-[200px] overflow-hidden">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectProject(p)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-hover-overlay transition-colors ${
                      selectedProject?.projectNumber === p.number
                        ? "text-accent"
                        : "text-neutral-300"
                    }`}
                  >
                    <span className="block truncate">{p.title}</span>
                    <span className="text-[10px] text-neutral-500">
                      {p.items_total} Items
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-xs text-neutral-600">({itemCount} Issues)</span>
        </div>
        <button
          onClick={() => {
            const controller = new AbortController();
            void loadBoard(controller.signal, true);
          }}
          className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Neu laden"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Move error toast */}
      {moveError && (
        <div className="mx-4 mt-2 px-3 py-2 text-xs text-error bg-error/10 rounded-md flex items-center justify-between">
          <span>{moveError}</span>
          <button
            onClick={() => setMoveError(null)}
            className="ml-2 text-red-400 hover:text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {/* Board — lanes from GitHub Projects v2 Status field */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-3 h-full min-w-min">
          {board.lanes.map((lane) => {
            const laneItems = itemsByLane.get(lane.option_id) ?? [];
            return (
              <div
                key={lane.option_id}
                data-lane-id={lane.option_id}
                className={`flex flex-col ${LANE_WIDTH_CLASS} bg-surface-raised rounded-md transition-all duration-200 ${
                  dragOverOptionId === lane.option_id
                    ? "ring-1 ring-accent shadow-lift"
                    : "shadow-hairline"
                }`}
              >
                {/* Column header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
                  <span className="text-sm font-semibold text-neutral-300">
                    {lane.name}
                  </span>
                  <span className="text-[10px] text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded-sm">
                    {laneItems.length}
                  </span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {laneItems.length === 0 ? (
                    <div className="text-[11px] text-neutral-600 text-center py-4">
                      Keine Issues
                    </div>
                  ) : (
                    laneItems.map((item) => (
                      <div
                        key={item.item_id}
                        className={
                          moving === item.item_id
                            ? "opacity-50 pointer-events-none"
                            : ""
                        }
                      >
                        {renderCard(item)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}

          {/* Items with no status — shown as extra column if any */}
          {(() => {
            const noStatusItems = itemsByLane.get(null) ?? [];
            if (noStatusItems.length === 0) return null;
            return (
              <div
                key="__no_status__"
                data-lane-id="__no_status__"
                className={`flex flex-col ${LANE_WIDTH_CLASS} bg-surface-raised border border-dashed border-neutral-700 rounded-md`}
              >
                <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
                  <span className="text-sm font-semibold text-neutral-500">
                    Kein Status
                  </span>
                  <span className="text-[10px] text-neutral-400 bg-neutral-800 px-1.5 py-0.5 rounded-sm">
                    {noStatusItems.length}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {noStatusItems.map((item) => renderCard(item))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedIssue !== null && (
        <KanbanDetailModal
          open
          folder={folder}
          repository={selectedIssue.repository}
          issueNumber={selectedIssue.number}
          onClose={() => setSelectedIssue(null)}
          onIssueChanged={() => {
            invalidateBoardCache();
            const controller = new AbortController();
            void loadBoard(controller.signal, true);
          }}
        />
      )}
    </div>
  );
}
