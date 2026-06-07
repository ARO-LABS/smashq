/**
 * TaskMasterList — the grouped, scrollable task list for the global TasksView.
 *
 * Responsibilities:
 * - Render the inline-add row (when active) — Enter adds, Escape closes, keeps focus.
 * - Group open tasks by project or by deadline bucket (via taskGrouping helpers).
 * - Mark the per-group "nächste" task (lowest sortIndex open task).
 * - Render a collapsed-by-default "Erledigt N" section.
 * - Render the three empty states (none / filter-empty / search-empty).
 *
 * Filter interplay (driven by the parent's `filter`):
 * - "open" → only open groups, no done section.
 * - "done" → only the (auto-expanded) done section.
 * - "all"  → open groups + collapsed done section.
 *
 * The parent owns selection + the source task array; this component is a pure
 * renderer over already-filtered data plus a couple of UI-local toggles.
 */

import type { JSX } from "react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ICONS } from "../../utils/icons";
import { DURATION, EASE } from "../../utils/motion";
import type { TaskItem } from "../../store/tasksStore";
import { TaskRow } from "../shared/tasks/TaskRow";
import {
  groupByProject,
  groupByDeadline,
} from "../shared/tasks/taskGrouping";
import type {
  ProjectOption,
  TaskFilter,
  TaskGrouping,
} from "../shared/tasks/useTasksContext";

// ── Props ───────────────────────────────────────────────────────────────

export interface TaskMasterListProps {
  /** All non-archived tasks (sortIndex-sorted) for the active filter view. */
  openTasks: TaskItem[];
  doneTasks: TaskItem[];
  /** Whether the store holds ANY non-archived task (pre-search). Drives the
   * "none" vs. "search/filter empty" empty-state copy. */
  hasAnyTasks: boolean;
  grouping: TaskGrouping;
  filter: TaskFilter;
  query: string;
  availableProjects: ProjectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

// ── Group label ───────────────────────────────────────────────────────────

function GroupLabel({
  label,
  openCount,
}: {
  label: string;
  openCount?: number;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between px-2 pt-2 pb-0.5 text-[10px] tracking-wide uppercase text-neutral-500">
      <span>{label}</span>
      {typeof openCount === "number" && openCount > 0 && (
        <span className="font-mono">{openCount}</span>
      )}
    </div>
  );
}

// ── Done section (collapsible) ─────────────────────────────────────────────

function DoneSection({
  doneTasks,
  selectedId,
  onSelect,
  forceOpen,
}: {
  doneTasks: TaskItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When true (filter === "done"), render expanded and hide the toggle chevron. */
  forceOpen: boolean;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(true);
  const ChevronIcon = ICONS.action.collapse;
  const expanded = forceOpen || !collapsed;

  return (
    <div>
      <button
        type="button"
        onClick={forceOpen ? undefined : () => setCollapsed((c) => !c)}
        aria-expanded={expanded}
        disabled={forceOpen}
        className="w-full flex items-center gap-1.5 px-2 pt-2 pb-1 text-[10px] tracking-wide uppercase text-neutral-500 hover:text-neutral-400 transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 rounded-md disabled:cursor-default"
      >
        {!forceOpen && (
          <ChevronIcon
            className={[
              "w-3 h-3 transition-transform",
              expanded ? "" : "-rotate-90",
            ].join(" ")}
            aria-hidden="true"
          />
        )}
        <span>Erledigt</span>
        <span className="font-mono">{doneTasks.length}</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE.inOut }}
            className="overflow-hidden flex flex-col gap-0.5"
          >
            {doneTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex-1 flex items-center justify-center px-4 py-8 text-center text-xs text-neutral-500">
      {message}
    </div>
  );
}

// ── Grouped open rows ──────────────────────────────────────────────────────

function OpenGroups({
  openTasks,
  grouping,
  availableProjects,
  selectedId,
  onSelect,
}: {
  openTasks: TaskItem[];
  grouping: TaskGrouping;
  availableProjects: ProjectOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (grouping === "deadline") {
    const groups = groupByDeadline(openTasks);
    return (
      <>
        {groups.map((group) => (
          <div key={group.bucket}>
            <GroupLabel label={group.label} />
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        ))}
      </>
    );
  }

  const groups = groupByProject(openTasks, availableProjects);
  return (
    <>
      {groups.map((group) => {
        const openCount = group.tasks.filter((t) => t.status !== "done").length;
        return (
          <div key={group.key ?? "\0global"}>
            <GroupLabel label={group.label} openCount={openCount} />
            {group.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function TaskMasterList({
  openTasks,
  doneTasks,
  hasAnyTasks,
  grouping,
  filter,
  query,
  availableProjects,
  selectedId,
  onSelect,
}: TaskMasterListProps): JSX.Element {
  const hasQuery = query.trim() !== "";
  const totalVisible =
    (filter === "done" ? 0 : openTasks.length) +
    (filter === "open" ? 0 : doneTasks.length);

  // Empty-state copy precedence: truly-empty store > search > filter/view.
  // "none" wins even under a non-"all" filter — an empty store should never
  // read as if the filter hid existing work.
  let emptyMessage: string | null = null;
  if (totalVisible === 0) {
    if (!hasAnyTasks) {
      emptyMessage = "Noch keine Aufgaben — neue Aufgabe anlegen";
    } else if (hasQuery) {
      emptyMessage = `Keine Treffer für „${query.trim()}“`;
    } else {
      emptyMessage = "Keine Aufgaben in dieser Ansicht";
    }
  }

  const showOpenGroups = filter !== "done" && openTasks.length > 0;
  const showDoneSection = filter !== "open" && doneTasks.length > 0;

  return (
    <>
      {emptyMessage !== null ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <div className="flex-1 overflow-y-auto px-1.5 py-1.5 flex flex-col gap-0.5 min-h-0">
          {showOpenGroups && (
            <OpenGroups
              openTasks={openTasks}
              grouping={grouping}
              availableProjects={availableProjects}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}

          {showDoneSection && (
            <DoneSection
              doneTasks={doneTasks}
              selectedId={selectedId}
              onSelect={onSelect}
              forceOpen={filter === "done"}
            />
          )}
        </div>
      )}
    </>
  );
}
