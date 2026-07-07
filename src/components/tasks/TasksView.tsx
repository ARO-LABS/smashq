/**
 * TasksView — the global "Aufgaben" window (Layout B).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │ TasksToolbar (title·scope·search·chips·view) │
 *   ├──────────────┬───────────────────────────────┤
 *   │ Master list  │ Detail pane                    │
 *   │ (w-[312px])  │  <TaskDetail mode="pane">      │
 *   │ · sub-bar    │                                │
 *   │ · add row    │                                │
 *   │ · groups     │                                │
 *   │ · Erledigt N │                                │
 *   └──────────────┴───────────────────────────────┘
 *
 * Data: store selectors (selectActiveTasks) + useTasksContext for project
 * options and pre-bound actions. Selection (`selectedId`) is local:
 * - default-select the first open task once tasks exist,
 * - reselect when the current selection leaves the visible set
 *   (deleted, filtered out, or search-excluded),
 * - empty pane "Aufgabe wählen" when nothing is selectable.
 *
 * This file stays an orchestrator: the header/sub-bar live in TasksToolbar,
 * the grouped list lives in TaskMasterList.
 */

import type { JSX } from "react";
import { useState, useMemo, useEffect } from "react";
import { useTasksStore, selectActiveTasks } from "../../store/tasksStore";
import type { UpdateTaskFields } from "../../store/tasksStore";
import { useTasksContext } from "../shared/tasks/useTasksContext";
import type { TaskFilter, TaskGrouping, TaskSort } from "../shared/tasks/useTasksContext";
import { filterTasks } from "../shared/tasks/taskGrouping";
import { TaskDetail } from "../shared/tasks/TaskDetail";
import { TasksToolbar } from "./TasksToolbar";
import { ALL_SCOPE } from "./ProjectScopeDropdown";
import { TaskMasterList } from "./TaskMasterList";
import { exportTaskIcs } from "../../utils/exportTaskIcs";

// ── Component ──────────────────────────────────────────────────────────────

export function TasksView(): JSX.Element {
  // ── Store + context ────────────────────────────────────────────────────
  const tasks = useTasksStore(selectActiveTasks);
  const ctx = useTasksContext(true);

  // ── Local UI state ─────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<TaskGrouping>("project");
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [projectScope, setProjectScope] = useState<string | null>(ALL_SCOPE);
  const [sort, setSort] = useState<TaskSort>("manual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Id of a just-created task whose title should be auto-focused in the pane.
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  // ── Derived task partitions ──────────────────────────────────────────────
  // filterTasks applies the search query; status split drives the open groups
  // vs. the collapsed "Erledigt" section.
  const matched = useMemo(
    () => filterTasks(tasks, "all", query),
    [tasks, query],
  );
  // Project-scope filter: ALL_SCOPE shows everything; otherwise keep only tasks
  // whose projectKey matches (null === the Global bucket).
  const scoped = useMemo(
    () =>
      projectScope === ALL_SCOPE
        ? matched
        : matched.filter((t) => t.projectKey === projectScope),
    [matched, projectScope],
  );
  // Sort: "recent" = newest first (createdAt desc); "manual" keeps the store's
  // sortIndex order. Reorders within groups; grouping stays orthogonal.
  const ordered = useMemo(
    () =>
      sort === "recent"
        ? [...scoped].sort((a, b) => b.createdAt - a.createdAt)
        : scoped,
    [scoped, sort],
  );
  const openTasks = useMemo(
    () => ordered.filter((t) => t.status !== "done"),
    [ordered],
  );
  const doneTasks = useMemo(
    () => ordered.filter((t) => t.status === "done"),
    [ordered],
  );

  // ── Selectable set (respects the active filter) ──────────────────────────
  // A task is reachable in the current view if it survives search AND the
  // status filter. We reselect whenever the current selection drops out.
  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    if (filter !== "done") for (const t of openTasks) ids.add(t.id);
    if (filter !== "open") for (const t of doneTasks) ids.add(t.id);
    return ids;
  }, [openTasks, doneTasks, filter]);

  // First fallback candidate: first open task, else first done task.
  const fallbackId = useMemo<string | null>(() => {
    if (filter !== "done" && openTasks[0]) return openTasks[0].id;
    if (filter !== "open" && doneTasks[0]) return doneTasks[0].id;
    return null;
  }, [openTasks, doneTasks, filter]);

  // Default-select + reselect on drop-out.
  useEffect(() => {
    if (selectedId !== null && visibleIds.has(selectedId)) return;
    setSelectedId(fallbackId);
  }, [selectedId, visibleIds, fallbackId]);

  // ── Selected task lookup ─────────────────────────────────────────────────
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleNewTask = (): void => {
    // One-step create: make the task with a default title, select it, and flag
    // its title for auto-focus in the detail pane so the user types straight
    // over "Neue Aufgabe". New tasks are open — leave the "done" filter so the
    // freshly-created row stays visible (and selected) instead of dropping out.
    if (filter === "done") setFilter("open");
    const id = ctx.addTask({
      title: "Neue Aufgabe",
      projectKey: ctx.effectiveProjectKey,
      source: "manual",
    });
    setSelectedId(id);
    setPendingFocusId(id);
  };

  const handleUpdate = (fields: UpdateTaskFields): void => {
    if (selectedId === null) return;
    ctx.updateTask(selectedId, fields);
  };

  const handleComplete = (): void => {
    if (selectedId !== null) ctx.completeTask(selectedId);
  };

  const handleReopen = (): void => {
    if (selectedId !== null) ctx.reopenTask(selectedId);
  };

  const handleDelete = (): void => {
    if (selectedId !== null) ctx.deleteTask(selectedId);
    // Selection drop-out is handled by the reselect effect on the next render.
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-surface-base text-neutral-200">
      <TasksToolbar
        query={query}
        onQueryChange={setQuery}
        projectScope={projectScope}
        onScopeChange={setProjectScope}
        availableProjects={ctx.availableProjects}
        openCountForProject={ctx.openCountForProject}
        filter={filter}
        onFilterChange={setFilter}
        grouping={grouping}
        onGroupingChange={setGrouping}
        sort={sort}
        onSortChange={setSort}
        onNewTask={handleNewTask}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── Master list ──────────────────────────────────────────── */}
        <div className="w-[312px] shrink-0 border-r border-neutral-700 flex flex-col overflow-hidden">
          <TaskMasterList
            openTasks={openTasks}
            doneTasks={doneTasks}
            hasAnyTasks={tasks.length > 0}
            grouping={grouping}
            filter={filter}
            query={query}
            availableProjects={ctx.availableProjects}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* ── Detail pane ──────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col bg-surface-raised overflow-hidden min-w-0">
          {selectedTask ? (
            <TaskDetail
              task={selectedTask}
              mode="pane"
              availableProjects={ctx.availableProjects}
              onUpdate={handleUpdate}
              onComplete={handleComplete}
              onReopen={handleReopen}
              onDelete={handleDelete}
              onExportIcs={() => void exportTaskIcs(selectedTask)}
              autoFocusTitle={pendingFocusId === selectedTask.id}
              onTitleAutoFocused={() => setPendingFocusId(null)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-neutral-500">
              Aufgabe wählen
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
