/**
 * TasksToolbar — header + master-list sub-bar controls for the global TasksView.
 *
 * Two exported pieces:
 * - TasksHeader  : app header (title + search box + "Neue Aufgabe" primary)
 * - TasksSubBar  : grouping segmented control (Projekt|Deadline) + filter chips
 *
 * Why split from TasksView?
 * Keeps TasksView focused on selection/data orchestration; the toolbar is pure
 * presentation driven by callbacks. Both live in the same folder per the
 * design-system "focused sub-components" rule.
 */

import type { JSX } from "react";
import { ICONS } from "../../utils/icons";
import type { TaskFilter, TaskGrouping } from "../shared/tasks/useTasksContext";

// ── Header ──────────────────────────────────────────────────────────────

export interface TasksHeaderProps {
  query: string;
  onQueryChange: (value: string) => void;
  onNewTask: () => void;
}

export function TasksHeader({
  query,
  onQueryChange,
  onNewTask,
}: TasksHeaderProps): JSX.Element {
  const SearchIcon = ICONS.action.search;
  const PlusIcon = ICONS.action.newSession;

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
      <h1 className="text-xs tracking-widest uppercase text-neutral-300 font-semibold">
        Aufgaben
      </h1>

      <div className="flex items-center gap-2">
        {/* Search box */}
        <div className="flex items-center gap-1.5 bg-surface-raised shadow-hairline rounded-md px-2.5 py-1.5 w-[170px]">
          <SearchIcon className="w-3 h-3 text-neutral-500 shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Suchen…"
            className="flex-1 bg-transparent text-xs text-neutral-200 placeholder:text-neutral-600 focus-visible:outline-none"
            aria-label="Aufgaben durchsuchen"
          />
        </div>

        {/* Neue Aufgabe — opens inline-add row */}
        <button
          type="button"
          onClick={onNewTask}
          className="inline-flex items-center gap-1.5 bg-accent text-surface-base text-xs font-medium px-3 py-1.5 rounded-md shadow-hairline hover:opacity-90 transition-opacity focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <PlusIcon className="w-3 h-3" aria-hidden="true" />
          Neue Aufgabe
        </button>
      </div>
    </header>
  );
}

// ── Sub-bar ─────────────────────────────────────────────────────────────

export interface TasksSubBarProps {
  grouping: TaskGrouping;
  onGroupingChange: (g: TaskGrouping) => void;
  filter: TaskFilter;
  onFilterChange: (f: TaskFilter) => void;
}

const GROUPINGS: { value: TaskGrouping; label: string }[] = [
  { value: "project", label: "Projekt" },
  { value: "deadline", label: "Deadline" },
];

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "open", label: "Offen" },
  { value: "done", label: "Erledigt" },
];

export function TasksSubBar({
  grouping,
  onGroupingChange,
  filter,
  onFilterChange,
}: TasksSubBarProps): JSX.Element {
  return (
    <div className="flex items-center justify-between px-2.5 py-2 border-b border-neutral-800 gap-1.5">
      {/* Grouping segmented control */}
      <div className="inline-flex p-0.5 rounded-md bg-surface-base gap-0.5">
        {GROUPINGS.map((g) => {
          const active = grouping === g.value;
          return (
            <button
              key={g.value}
              type="button"
              onClick={() => onGroupingChange(g.value)}
              aria-pressed={active}
              className={[
                "text-[10.5px] px-2 py-0.5 rounded-md transition-colors",
                "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
                active
                  ? "bg-accent-a10 text-accent"
                  : "text-neutral-400 hover:bg-hover-overlay",
              ].join(" ")}
            >
              {g.label}
            </button>
          );
        })}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1">
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
    </div>
  );
}
