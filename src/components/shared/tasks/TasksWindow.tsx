/**
 * TasksWindow — floating portal window for per-scope task management.
 *
 * Chrome mirrors NotesWindow 1:1 (createPortal, fixed-position root, segmented
 * tabs, close button, drag handle, resize handle). The body replaces the notes
 * textarea with a compact task list + inline accordion expansion. The footer
 * hosts a quick-add input row.
 *
 * Architecture note — why read tasks inside this component and not through ctx?
 * The spec asks for a scoped task list that reacts live to store changes.
 * ctx provides the scopeKey (via activeTab + effectiveProjectKey) and the
 * action callbacks; the actual task array is read via useTasksStore to avoid
 * piping large arrays through the context object on every change.
 *
 * Accordion behaviour: one `expandedId` at a time. Expanding a row scrolls the
 * detail into view automatically (the list already overflows). Clicking the
 * same row a second time collapses it.
 */

import type { JSX } from "react";
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { ICONS } from "../../../utils/icons";
import type {
  WindowPos,
  WindowSize,
  PointerDragHandlers,
} from "../../../hooks/useDraggableWindow";
import type { TasksContext } from "./useTasksContext";
import {
  useTasksStore,
  selectTasksForProject,
} from "../../../store/tasksStore";
import type { TaskItem } from "../../../store/tasksStore";
import { TaskRow } from "./TaskRow";
import { TaskDetail } from "./TaskDetail";
import { exportTaskIcs } from "../../../utils/exportTaskIcs";

// ── Props ──────────────────────────────────────────────────────────────

export interface TasksWindowProps {
  ctx: TasksContext;
  pos: WindowPos | null;
  size: WindowSize;
  dragHandlers: PointerDragHandlers;
  resizeHandlers: PointerDragHandlers;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Partition tasks into open/active first, then done.
 * Within each group, original sort order (sortIndex, already sorted by selector)
 * is preserved.
 */
function partitionTasks(tasks: TaskItem[]): {
  openActive: TaskItem[];
  done: TaskItem[];
} {
  const openActive: TaskItem[] = [];
  const done: TaskItem[] = [];
  for (const t of tasks) {
    if (t.status === "done") {
      done.push(t);
    } else {
      openActive.push(t);
    }
  }
  return { openActive, done };
}

// ── Footer add-row ─────────────────────────────────────────────────────

interface AddTaskRowProps {
  onAdd: (title: string) => void;
}

function AddTaskRow({ onAdd }: AddTaskRowProps): JSX.Element {
  const [value, setValue] = useState("");
  const PlusIcon = ICONS.action.newSession;

  const commit = (): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue("");
  };

  return (
    <div className="flex items-center gap-1.5 bg-surface-base shadow-hairline rounded-md px-2 py-1.5">
      <PlusIcon className="w-3 h-3 text-accent shrink-0" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Aufgabe hinzufügen — Enter"
        className="flex-1 bg-transparent text-[11.5px] text-neutral-300 placeholder:text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent focus-visible:ring-inset rounded-sm"
        aria-label="Aufgabe hinzufügen"
      />
    </div>
  );
}

// ── Task list body ─────────────────────────────────────────────────────

interface TaskListBodyProps {
  tasks: TaskItem[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  ctx: TasksContext;
  scopeKey: string | null;
}

function TaskListBody({
  tasks,
  expandedId,
  onToggleExpand,
  ctx,
}: TaskListBodyProps): JSX.Element {
  const { openActive, done } = partitionTasks(tasks);
  const allSorted = [...openActive, ...done];

  if (allSorted.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-neutral-600 px-3 text-center">
        Noch keine Aufgaben — neue Aufgabe anlegen
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-1.5 min-h-0 flex flex-col gap-0.5">
      {allSorted.map((task) => {
        const isExpanded = expandedId === task.id;
        return (
          <div key={task.id}>
            {/* Row — expanded variant has accent left border */}
            <div
              className={
                isExpanded
                  ? "rounded-md border-l-2 border-accent bg-accent-a05"
                  : ""
              }
            >
              <TaskRow
                task={task}
                selected={isExpanded}
                showSource={false}
                density="compact"
                onSelect={onToggleExpand}
              />
            </div>

            {/* Inline accordion body */}
            {isExpanded && (
              <TaskDetail
                task={task}
                mode="accordion"
                availableProjects={ctx.availableProjects}
                onUpdate={(fields) => ctx.updateTask(task.id, fields)}
                onComplete={() => ctx.completeTask(task.id)}
                onReopen={() => ctx.reopenTask(task.id)}
                onArchive={() => ctx.deleteTask(task.id)}
                onExportIcs={() => void exportTaskIcs(task)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── TasksWindow ────────────────────────────────────────────────────────

export function TasksWindow({
  ctx,
  pos,
  size,
  dragHandlers,
  resizeHandlers,
  onClose,
}: TasksWindowProps): JSX.Element {
  const { activeTab, setActiveTab, projectTabLabel, openCountForProject, effectiveProjectKey, hasProjectContext } = ctx;

  // Derive scope key: project tab uses the effective project, global tab uses null
  const scopeKey = activeTab === "project" ? effectiveProjectKey : null;

  // Read tasks for the current scope directly from the store
  const tasks = useTasksStore(selectTasksForProject(scopeKey));

  // One expanded row at a time
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleToggleExpand = (id: string): void => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // Close expanded row when scope changes (tab switch or session change)
  const prevScopeRef = useRef(scopeKey);
  if (prevScopeRef.current !== scopeKey) {
    prevScopeRef.current = scopeKey;
    // Synchronously reset during render when scope changes — safe because this
    // only calls setState (not a store write) and React re-renders immediately.
    if (expandedId !== null) setExpandedId(null);
  }

  const projectOpenCount = openCountForProject(effectiveProjectKey);
  const globalOpenCount = openCountForProject(null);

  // Footer add-task handler
  const handleAddTask = (title: string): void => {
    ctx.addTask({
      title,
      projectKey: scopeKey,
      source: scopeKey ? "session" : "manual",
    });
  };

  const CloseIcon = ICONS.action.close;

  return createPortal(
    <div
      role="dialog"
      aria-label="Aufgaben"
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        width: size.w,
        height: size.h,
      }}
      className="z-50 bg-surface-raised rounded-md shadow-modal flex flex-col"
    >
      {/* Header: segmented tabs + close button */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-neutral-800">
        <div className="inline-flex p-0.5 rounded-md bg-surface-base gap-0.5 min-w-0">
          <button
            onClick={() => setActiveTab("project")}
            aria-label="Projekt-Aufgaben"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors truncate min-w-0 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
              activeTab === "project"
                ? "bg-accent-a10 text-accent"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
            }`}
          >
            <span className="truncate">{projectTabLabel}</span>
            {projectOpenCount > 0 && (
              <span
                className="w-1.5 h-1.5 bg-accent rounded-full shrink-0"
                aria-hidden="true"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab("global")}
            aria-label="Globale Aufgaben"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors shrink-0 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
              activeTab === "global"
                ? "bg-accent-a10 text-accent"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
            }`}
          >
            Global
            {globalOpenCount > 0 && (
              <span
                className="w-1.5 h-1.5 bg-accent rounded-full shrink-0"
                aria-hidden="true"
              />
            )}
          </button>
        </div>

        {/* Close button — outside segmented control */}
        <button
          onClick={onClose}
          className="p-1 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-hover-overlay transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          aria-label="Aufgaben schliessen"
          title="Schliessen"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      {activeTab === "project" && !hasProjectContext ? (
        <div className="flex-1 flex items-center justify-center text-[11px] text-neutral-600 px-3 text-center min-h-0">
          Keine Session aktiv — Aufgabe global anlegen
        </div>
      ) : (
        <TaskListBody
          tasks={tasks}
          expandedId={expandedId}
          onToggleExpand={handleToggleExpand}
          ctx={ctx}
          scopeKey={scopeKey}
        />
      )}

      {/* Footer: quick-add row */}
      <div className="border-t border-neutral-800 px-2 py-1.5 relative">
        <AddTaskRow onAdd={handleAddTask} />
      </div>

      {/* Drag handle (bottom-left) — 4-direction move arrows */}
      <span
        {...dragHandlers}
        role="button"
        aria-label="Aufgaben-Fenster verschieben"
        className="absolute left-0.5 bottom-0.5 p-0.5 cursor-move text-neutral-600 hover:text-neutral-300 transition-colors"
        style={{ touchAction: "none" }}
      >
        <ICONS.action.move className="w-3 h-3" aria-hidden="true" />
      </span>

      {/* Resize handle (bottom-right) — diagonal strokes */}
      <span
        {...resizeHandlers}
        role="button"
        aria-label="Aufgaben-Fenster vergroessern"
        className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize text-neutral-600 hover:text-neutral-300 transition-colors"
        style={{ touchAction: "none" }}
      >
        <svg viewBox="0 0 12 12" className="w-full h-full" aria-hidden="true">
          <path
            d="M11 5 L5 11 M11 9 L9 11"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
          />
        </svg>
      </span>
    </div>,
    document.body,
  );
}
