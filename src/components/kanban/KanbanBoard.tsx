import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ICONS } from "../../utils/icons";
import {
  getErrorMessage,
  classifyGithubError,
  type GithubErrorInfo,
} from "../../utils/adpError";
import { wrapInvoke } from "../../utils/perfLogger";
import { KanbanCard, type KanbanIssue } from "./KanbanCard";
import { KanbanDetailModal } from "./KanbanDetailModal";
import { useProjectStore } from "../../store/projectStore";
import { logError } from "../../utils/errorLogger";

const RefreshCw = ICONS.action.refresh;
const Columns3 = ICONS.nav.kanban;
const AlertCircle = ICONS.update.error;
const ChevronDown = ICONS.action.collapse;
const X = ICONS.action.close;

// ── Types from backend ────────────────────────────────────────────────

interface ProjectSummary {
  id: string;
  number: number;
  title: string;
  items_total: number;
}

/** An owner whose boards can be listed — the viewer (`user`) or an org. */
interface ProjectOwner {
  login: string;
  kind: string;
}

/** Sentinel owner login for the authenticated user (`gh ... --owner @me`). */
const SELF_OWNER = "@me";

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

/** Test-only: clears the module-level board + project-list caches so unit tests
 *  don't serve each other stale data (cache keys are process-global). No-op
 *  cost in production; never called outside tests. */
// eslint-disable-next-line react-refresh/only-export-components
export function __resetKanbanCachesForTest(): void {
  cache.clear();
  projectListCache.clear();
}

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

// ── Component ─────────────────────────────────────────────────────────

/**
 * The Kanban board. Shows ONE globally-selected GitHub Projects v2 board,
 * switchable via the header picker (account dropdown → board). There is no
 * folder/project mode — board selection is a single global preference.
 */
export function KanbanBoard() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [board, setBoard] = useState<ProjectBoard | null>(null);
  const [loading, setLoading] = useState(true);
  /** Classified load error (null = no error). Drives honest, kind-specific UI. */
  const [errorInfo, setErrorInfo] = useState<GithubErrorInfo | null>(null);
  /** Owners (viewer + orgs) for the picker dropdown; lazily loaded on first open. */
  const [owners, setOwners] = useState<ProjectOwner[]>([]);
  /** Currently browsed owner login in the picker; null until the picker loads it. */
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  /** Tracks the clicked card — stores number + repository for cross-repo modal. */
  const [selectedIssue, setSelectedIssue] = useState<{
    number: number;
    repository: string | null;
  } | null>(null);
  const [dragOverOptionId, setDragOverOptionId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null); // item_id being moved
  const [moveError, setMoveError] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);

  const { setGlobalProject, getGlobalProject } = useProjectStore();

  /** Resolves the globally-selected board (undefined until one is chosen). */
  const resolveProject = useCallback(
    () => getGlobalProject(),
    [getGlobalProject]
  );

  /** Builds the board cache key from the GLOBALLY UNIQUE project id.
   *  Projects v2 numbers are owner-relative (a user board #1 and an org board #1
   *  collide), so keying on the number would serve the wrong board. The id
   *  (`PVT_…`) is unique across owners. */
  const cacheKeyFor = useCallback((projectId: string) => `global:${projectId}`, []);

  /** Drops the cached board for the active project so the next load re-fetches. */
  const invalidateBoardCache = useCallback(() => {
    const proj = resolveProject();
    if (proj) cache.delete(cacheKeyFor(proj.projectId));
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
    async (
      signal: AbortSignal,
      owner: string = SELF_OWNER,
      opts: { silent?: boolean } = {},
    ) => {
      const listKey = `global:${owner}`;
      const cached = projectListCache.get(listKey);
      if (cached && Date.now() - cached.timestamp < PROJECT_LIST_TTL) {
        if (!signal.aborted) setProjects(cached.projects);
        return cached.projects;
      }

      try {
        const result = await wrapInvoke<ProjectSummary[]>("list_user_projects", {
          // `@me` is the backend default; send a concrete login only for orgs.
          owner: owner === SELF_OWNER ? undefined : owner,
        });
        if (signal.aborted) return result;
        projectListCache.set(listKey, { projects: result, timestamp: Date.now() });
        setProjects(result);
        return result;
      } catch (err) {
        if (!signal.aborted) {
          // `silent` (owner switch inside the picker): keep the chooser visible
          // with an empty list instead of replacing it with a full-screen error.
          if (opts.silent) {
            setProjects([]);
          } else {
            setErrorInfo(classifyGithubError(err));
            setLoading(false);
          }
        }
        return [];
      }
    },
    []
  );

  /** Lazily loads the owner list (viewer + orgs) for the picker dropdown.
   *  Attempted at most once; a failure is non-fatal (the picker degrades to
   *  "@me" only). Owner discovery is what makes org boards selectable. */
  const ownersAttemptedRef = useRef(false);
  const loadOwners = useCallback(async () => {
    if (ownersAttemptedRef.current) return;
    ownersAttemptedRef.current = true;
    try {
      const result = await invoke<ProjectOwner[]>("list_project_owners", {});
      const list = Array.isArray(result) ? result : [];
      setOwners(list);
      setSelectedOwner((prev) => {
        if (prev) return prev;
        const current = resolveProject();
        // Guard list[0] via the sanitized `list`, never the raw (maybe
        // undefined) invoke result.
        return current?.owner ?? list[0]?.login ?? SELF_OWNER;
      });
    } catch (err) {
      // Non-fatal: the board itself may still load; just log and keep @me.
      logError("KanbanBoard.loadOwners", err);
    }
  }, [resolveProject]);

  /** Aborts the in-flight owner-switch list call so rapid A→B→A switches can't
   *  let a stale resolve clobber the currently-selected owner's board list. */
  const ownerSwitchAbortRef = useRef<AbortController | null>(null);

  /** Switches the browsed owner in the picker and re-lists that owner's boards.
   *  Runs `silent` so a failing org list keeps the chooser open (empty list)
   *  instead of ejecting the user to the full-screen error card. */
  const handleOwnerChange = useCallback(
    (login: string) => {
      setSelectedOwner(login);
      ownerSwitchAbortRef.current?.abort();
      const controller = new AbortController();
      ownerSwitchAbortRef.current = controller;
      void loadProjects(controller.signal, login, { silent: true });
    },
    [loadProjects]
  );

  const loadBoard = useCallback(
    async (signal: AbortSignal, forceRefresh = false) => {
      const proj = resolveProject();
      if (!proj) return;

      const cacheKey = cacheKeyFor(proj.projectId);

      if (!forceRefresh) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          if (!signal.aborted) {
            setBoard(cached.board);
            setErrorInfo(null);
            setLoading(false);
          }
          return;
        }
      }

      if (!signal.aborted) {
        setLoading(true);
        setErrorInfo(null);
      }

      try {
        const result = await wrapInvoke<ProjectBoard>("get_project_board", {
          projectNumber: proj.projectNumber,
          projectId: proj.projectId,
        });
        if (signal.aborted) return;
        const cacheEntry: CacheEntry = { board: result, timestamp: Date.now() };
        cache.set(cacheKey, cacheEntry);
        setBoard(result);
        setLoading(false);
      } catch (err) {
        if (signal.aborted) return;
        // Classify into an honest, kind-specific error. A board_not_found is
        // NOT auto-cleared here: doing so would re-trigger the load effect and
        // silently auto-select a *different* board. Instead the render shows the
        // chooser from errorInfo (selection preserved) so the user picks.
        setErrorInfo(classifyGithubError(err));
        setLoading(false);
      }
    },
    [resolveProject, cacheKeyFor]
  );

  // Load effect keyed on the selected project id. AbortController prevents
  // stale async callbacks from updating state after unmount or re-fire.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setLoading(true);
    setErrorInfo(null);
    setBoard(null);

    const proj = resolveProject();

    if (proj) {
      // Project already known (e.g. user switched via picker) — load board directly.
      void loadBoard(signal);
    } else {
      // First visit: load project list, auto-select first, then board.
      void loadProjects(signal).then((list) => {
        if (signal.aborted) return;
        // No boards for this owner → stop loading and let the chooser render
        // (previously `loading` stayed true here, hanging the spinner forever).
        if (list.length === 0) {
          setLoading(false);
          return;
        }
        const auto = { projectNumber: list[0].number, projectId: list[0].id, title: list[0].title };
        // Selecting the board changes `selectedProject.projectId`, which re-runs
        // this effect and loads it via the `proj` branch above. Loading inline
        // here too would fire `get_project_board` twice for the same board.
        setGlobalProject(auto);
      });
    }

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.projectId]);

  // When there is no board to show (no selection, empty owner, or a not-found
  // board), the chooser screen is rendered — make sure the owner list is loaded
  // so the user can switch to an org. Guarded once via ownersAttemptedRef.
  useEffect(() => {
    // Mirror the chooser-render gate: only load owners when the chooser is
    // actually shown (no board, and either no selection or a not-found board).
    const showsChooser =
      !loading &&
      !board &&
      (!selectedProject || errorInfo?.kind === "board_not_found");
    if (showsChooser) void loadOwners();
  }, [loading, board, errorInfo, selectedProject, loadOwners]);

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
    [invalidateBoardCache]
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
    const entry = {
      projectNumber: proj.number,
      projectId: proj.id,
      title: proj.title,
      // Persist the owner only for orgs; `@me`/self boards load fine without it
      // (the board is fetched by its global id), keeping legacy entries valid.
      ...(selectedOwner && selectedOwner !== SELF_OWNER
        ? { owner: selectedOwner }
        : {}),
    };
    setGlobalProject(entry);
    setProjectPickerOpen(false);
    // State update above triggers the load effect via selectedProject?.projectId dep.
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

  // Opens/closes the picker; loads the owner list the first time it opens so
  // org boards become selectable.
  const togglePicker = () => {
    setProjectPickerOpen((open) => {
      if (!open) void loadOwners();
      return !open;
    });
  };

  // Owner dropdown + project list, shared by the header picker dropdown and the
  // full-screen chooser (empty / board-not-found). Single source for the
  // "switch owner → pick a board (incl. org boards)" flow.
  const renderProjectChooser = () => (
    <>
      <label className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 text-[11px] text-neutral-500">
        <span>Konto</span>
        <select
          aria-label="Konto"
          value={selectedOwner ?? SELF_OWNER}
          onChange={(e) => handleOwnerChange(e.target.value)}
          className="flex-1 text-xs rounded-sm bg-surface-base border border-neutral-700 text-neutral-300 px-1.5 py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {owners.length === 0 && <option value={SELF_OWNER}>Eigene Boards</option>}
          {owners.map((o) => (
            <option key={o.login} value={o.login}>
              {o.login}
              {o.kind === "org" ? " (Org)" : ""}
            </option>
          ))}
        </select>
      </label>
      {projects.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-neutral-600 text-center">
          Keine Boards für dieses Konto.
        </div>
      ) : (
        projects.map((p) => (
          <button
            key={p.id}
            onClick={() => handleSelectProject(p)}
            className={`w-full text-left px-3 py-2 text-xs hover:bg-hover-overlay transition-colors ${
              selectedProject?.projectId === p.id
                ? "text-accent"
                : "text-neutral-300"
            }`}
          >
            <span className="block truncate">{p.title}</span>
            <span className="text-[10px] text-neutral-500">{p.items_total} Items</span>
          </button>
        ))
      )}
    </>
  );

  // ── Loading / error / chooser states ─────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade Kanban-Daten...
      </div>
    );
  }

  // Hard errors (scope, login, gh missing, network, rate-limit, unknown) get an
  // honest, kind-specific card. board_not_found is intentionally NOT here — it
  // falls through to the chooser so the user can pick another board.
  if (errorInfo && errorInfo.kind !== "board_not_found") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <AlertCircle className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">{errorInfo.title}</span>
        <span className="text-xs text-neutral-600 max-w-md text-center">
          {errorInfo.hint}
        </span>
        <button
          onClick={() => {
            const controller = new AbortController();
            setErrorInfo(null);
            // After a fixed auth/scope problem the failed call may have been the
            // project-LIST load (no board selected yet). loadBoard no-ops when
            // resolveProject() is undefined, so retry must re-list projects and
            // auto-select the first — mirroring the initial load effect —
            // instead of silently doing nothing.
            if (resolveProject()) {
              void loadBoard(controller.signal, true);
            } else {
              setLoading(true);
              void loadProjects(controller.signal).then((list) => {
                if (controller.signal.aborted) return;
                if (list.length === 0) {
                  setLoading(false);
                  return;
                }
                setGlobalProject({
                  projectNumber: list[0].number,
                  projectId: list[0].id,
                  title: list[0].title,
                });
              });
            }
          }}
          className="mt-2 px-3 py-1.5 text-xs rounded-md bg-surface-raised text-neutral-300 shadow-hairline hover:shadow-lift hover:bg-hover-overlay hover:text-neutral-100 transition-shadow duration-200"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  // No board to show: no selection, the owner has no boards, or the previously
  // selected board was deleted/renamed. Render the chooser so the user can
  // select a board — including an org board via the owner dropdown.
  if (!board && (!selectedProject || errorInfo?.kind === "board_not_found")) {
    const isNotFound = errorInfo?.kind === "board_not_found";
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500 px-4">
        <Columns3 className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">
          {isNotFound ? "Board nicht gefunden" : "Kein Board ausgewählt"}
        </span>
        <span className="text-xs text-neutral-600 max-w-md text-center">
          {isNotFound
            ? errorInfo.hint
            : "Globales Board wählen — eigene Boards oder ein Board einer Organisation."}
        </span>
        <div className="w-[240px] bg-surface-raised rounded-md shadow-hairline overflow-hidden">
          {renderProjectChooser()}
        </div>
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
              onClick={togglePicker}
              className="flex items-center gap-1 text-xs text-neutral-300 hover:text-neutral-100 transition-colors"
            >
              <span className="font-medium">
                {selectedProject?.title ?? "Projekt wählen"}
              </span>
              <ChevronDown className="w-3 h-3 text-neutral-500" />
            </button>
            {projectPickerOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-surface-raised rounded-md shadow-lift min-w-[220px] overflow-hidden">
                {renderProjectChooser()}
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
            className="ml-2 text-error/70 hover:text-error"
            aria-label="Fehler schließen"
          >
            <X className="w-3.5 h-3.5" />
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
          folder={null}
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
