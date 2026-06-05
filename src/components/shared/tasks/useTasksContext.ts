import { useState, useEffect, useMemo, useRef } from "react";
import {
  useTasksStore,
  selectOpenTasksForProject,
  type AddTaskInput,
  type TasksState,
  type UpdateTaskFields,
} from "../../../store/tasksStore";
import { useSettingsStore, normalizeProjectKey } from "../../../store/settingsStore";
import {
  useSessionStore,
  selectEffectiveSession,
} from "../../../store/sessionStore";
import { folderLabel } from "../../../utils/pathUtils";

// ── Exported types ─────────────────────────────────────────────────────────

export type TasksTab = "project" | "global";
export type TaskFilter = "all" | "open" | "done";
export type TaskGrouping = "project" | "deadline";

export interface ProjectOption {
  key: string | null;
  label: string;
}

export interface TasksContext {
  activeTab: TasksTab;
  setActiveTab: (t: TasksTab) => void;
  effectiveProjectKey: string | null;
  projectTabLabel: string;
  hasProjectContext: boolean;
  availableProjects: ProjectOption[];
  addTask: (input: AddTaskInput) => string;
  updateTask: (id: string, fields: UpdateTaskFields) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  archiveTask: (id: string) => void;
  openCountForProject: (key: string | null) => number;
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * Derives the effective project context from the active session, builds the
 * list of available projects (favorites ∪ distinct task project keys ∪ Global),
 * pre-binds store actions, and owns the default-tab effect on the open transition.
 *
 * Mirror of `useProjectNotesContext` — same wasOpenRef guard so rapid
 * session-output spreads never override the user's manual tab choice.
 *
 * @param open whether the window/panel is currently open — drives the
 *   one-shot default-tab selection on the closed→open transition.
 */
export function useTasksContext(open?: boolean): TasksContext {
  const [activeTab, setActiveTab] = useState<TasksTab>("project");

  // ── Session context ────────────────────────────────────────────────────
  const activeSession = useSessionStore(selectEffectiveSession);
  const effectiveProjectKey = activeSession?.folder
    ? normalizeProjectKey(activeSession.folder)
    : null;

  // ── Store slices ───────────────────────────────────────────────────────
  const favorites = useSettingsStore((s) => s.favorites);
  const tasks = useTasksStore((s) => s.tasks);
  const addTask = useTasksStore((s) => s.addTask);
  const updateTask = useTasksStore((s) => s.updateTask);
  const completeTask = useTasksStore((s) => s.completeTask);
  const reopenTask = useTasksStore((s) => s.reopenTask);
  const archiveTask = useTasksStore((s) => s.archiveTask);

  // ── availableProjects ──────────────────────────────────────────────────
  // Build: favorites ∪ distinct non-null task.projectKey, sorted by label,
  // prepended with the Global sentinel (key: null).
  const availableProjects = useMemo<ProjectOption[]>(() => {
    const projectMap = new Map<string, string>(); // key → label

    // Add favorites (provides label from fav.label or folder name)
    for (const fav of favorites) {
      const key = normalizeProjectKey(fav.path);
      projectMap.set(key, fav.label || folderLabel(fav.path));
    }

    // Add distinct non-null project keys from tasks that aren't already covered
    for (const task of tasks) {
      if (task.projectKey !== null && !projectMap.has(task.projectKey)) {
        projectMap.set(task.projectKey, folderLabel(task.projectKey));
      }
    }

    const named: ProjectOption[] = Array.from(projectMap.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // Global sentinel always first
    return [{ key: null, label: "Global" }, ...named];
  }, [favorites, tasks]);

  // ── Derived labels / flags ─────────────────────────────────────────────
  const projectTabLabel = effectiveProjectKey
    ? folderLabel(effectiveProjectKey)
    : "Projekt";

  const hasProjectContext = effectiveProjectKey !== null;

  // ── openCountForProject ────────────────────────────────────────────────
  // Returns the open-task count for a given projectKey without an extra store
  // subscription per call — the `tasks` array is already subscribed above.
  // selectOpenTasksForProject only reads `state.tasks`, so we cast the minimal
  // slice to the full TasksState type it expects.
  function openCountForProject(key: string | null): number {
    const stateSlice = { tasks } as TasksState;
    return selectOpenTasksForProject(key)(stateSlice).length;
  }

  // ── Default-tab effect ─────────────────────────────────────────────────
  // Only fires on the closed→open transition (wasOpenRef guard).
  // Without the guard, every session-output event would re-run this effect
  // because updateLastOutput spreads the session object → new ref → dep change.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const isOpen = open ?? false;
    if (isOpen && !wasOpenRef.current) {
      if (hasProjectContext) {
        setActiveTab("project");
      } else {
        setActiveTab("global");
      }
    }
    wasOpenRef.current = isOpen;
  }, [open, hasProjectContext]);

  return {
    activeTab,
    setActiveTab,
    effectiveProjectKey,
    projectTabLabel,
    hasProjectContext,
    availableProjects,
    addTask,
    updateTask,
    completeTask,
    reopenTask,
    archiveTask,
    openCountForProject,
  };
}
