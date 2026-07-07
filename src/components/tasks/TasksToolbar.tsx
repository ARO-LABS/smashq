/**
 * TasksToolbar — the single consolidated header bar for the global TasksView
 * (design "Option B"). One row holds, left→right:
 *   title · project-scope dropdown · search · status chips · [spacer] ·
 *   "Ansicht" popover (grouping+sort) · "Neu".
 *
 * Why one bar instead of the former header + sub-bar?
 * The two stacked border-b bars ate ~78px of chrome before the first task.
 * Consolidating reclaims a full bar AND makes room for the new project-scope
 * + sort controls: frequent controls stay visible, set-once controls (grouping,
 * sort) move into the "Ansicht" popover. See ProjectScopeDropdown /
 * ViewOptionsPopover for those two focused sub-components.
 */

import type { JSX } from "react";
import { ICONS } from "../../utils/icons";
import type {
  ProjectOption,
  TaskFilter,
  TaskGrouping,
  TaskSort,
} from "../shared/tasks/useTasksContext";
import { ProjectScopeDropdown } from "./ProjectScopeDropdown";
import { ViewOptionsPopover } from "./ViewOptionsPopover";

// ── Props ───────────────────────────────────────────────────────────────────

export interface TasksToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  projectScope: string | null;
  onScopeChange: (scope: string | null) => void;
  availableProjects: ProjectOption[];
  openCountForProject: (key: string | null) => number;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
  grouping: TaskGrouping;
  onGroupingChange: (g: TaskGrouping) => void;
  sort: TaskSort;
  onSortChange: (s: TaskSort) => void;
  onNewTask: () => void;
}

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "open", label: "Offen" },
  { value: "done", label: "Erledigt" },
];

// ── Component ────────────────────────────────────────────────────────────────

export function TasksToolbar({
  query,
  onQueryChange,
  projectScope,
  onScopeChange,
  availableProjects,
  openCountForProject,
  filter,
  onFilterChange,
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
  onNewTask,
}: TasksToolbarProps): JSX.Element {
  const SearchIcon = ICONS.action.search;
  const PlusIcon = ICONS.action.newSession;

  return (
    <header className="flex items-center gap-2 px-3 py-2 border-b border-neutral-700">
      <h1 className="text-xs tracking-widest uppercase text-neutral-300 font-semibold shrink-0">
        Aufgaben
      </h1>

      <ProjectScopeDropdown
        scope={projectScope}
        onScopeChange={onScopeChange}
        availableProjects={availableProjects}
        openCountForProject={openCountForProject}
      />

      {/* Search */}
      <div className="flex items-center gap-1.5 bg-surface-raised shadow-hairline rounded-md px-2.5 py-1.5 w-[150px] shrink-0">
        <SearchIcon className="w-3 h-3 text-neutral-500 shrink-0" aria-hidden="true" />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Suchen…"
          className="flex-1 min-w-0 bg-transparent text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset rounded-sm"
          aria-label="Aufgaben durchsuchen"
        />
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-1 shrink-0">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilterChange(f.value)}
              aria-pressed={active}
              className={[
                "text-[10.5px] px-2 py-0.5 rounded-full transition-colors",
                "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
                active
                  ? "bg-accent-a10 text-accent"
                  : "text-neutral-400 hover:bg-hover-overlay",
              ].join(" ")}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      <ViewOptionsPopover
        grouping={grouping}
        onGroupingChange={onGroupingChange}
        sort={sort}
        onSortChange={onSortChange}
      />

      {/* Neue Aufgabe — one-step create (see TasksView.handleNewTask) */}
      <button
        type="button"
        onClick={onNewTask}
        aria-label="Neue Aufgabe"
        className="inline-flex items-center gap-1.5 bg-accent text-surface-base text-xs font-medium px-3 py-1.5 rounded-md shadow-hairline hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 shrink-0"
      >
        <PlusIcon className="w-3 h-3" aria-hidden="true" />
        Neu
      </button>
    </header>
  );
}
