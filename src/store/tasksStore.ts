import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { logError } from "../utils/errorLogger";
import { tasksStorage } from "./tasksStorage";

// ── Types ─────────────────────────────────────────────────────────────

export type TaskStatus = "open" | "active" | "done";
export type TaskSource = "manual" | "session";

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskItem {
  id: string;
  /** Normalized folder path (see normalizeProjectKey); null = global-only. */
  projectKey: string | null;
  title: string;
  status: TaskStatus;
  /** epoch ms; null = no deadline. */
  deadline: number | null;
  /** all-day vs. timed — drives .ics export later. */
  deadlineHasTime: boolean;
  note?: string;
  subtasks: Subtask[];
  source: TaskSource;
  /** Manual ordering, 1000-step gaps. "nächste" = lowest sortIndex open task. */
  sortIndex: number;
  createdAt: number;
  completedAt: number | null;
  /** Soft-delete timestamp; null = active. No hard delete. */
  archivedAt: number | null;
}

// ── Sanitize (corruption recovery) ────────────────────────────────────

const VALID_STATUS: ReadonlySet<string> = new Set(["open", "active", "done"]);

function toFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNullableTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeSubtask(value: unknown): Subtask | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.title !== "string") return null;
  return { id: v.id, title: v.title, done: v.done === true };
}

/** Validate + coerce one persisted entry. Returns null if unrecoverable. */
export function sanitizeTask(value: unknown): TaskItem | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.title !== "string") return null;

  const status: TaskStatus = VALID_STATUS.has(v.status as string)
    ? (v.status as TaskStatus)
    : "open";
  const source: TaskSource = v.source === "session" ? "session" : "manual";
  const subtasks = Array.isArray(v.subtasks)
    ? v.subtasks.map(sanitizeSubtask).filter((s): s is Subtask => s !== null)
    : [];

  const result: TaskItem = {
    id: v.id,
    projectKey: typeof v.projectKey === "string" ? v.projectKey : null,
    title: v.title,
    status,
    deadline: toNullableTimestamp(v.deadline),
    deadlineHasTime: v.deadlineHasTime === true,
    subtasks,
    source,
    sortIndex: toFiniteNumber(v.sortIndex, 0),
    createdAt: toFiniteNumber(v.createdAt, 0),
    completedAt: toNullableTimestamp(v.completedAt),
    archivedAt: toNullableTimestamp(v.archivedAt),
  };
  if (typeof v.note === "string") result.note = v.note;
  return result;
}

/** Validate an array of persisted entries, dropping unrecoverable ones. */
export function sanitizeTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTask).filter((t): t is TaskItem => t !== null);
}

// ── Store ─────────────────────────────────────────────────────────────

export interface AddTaskInput {
  title: string;
  projectKey?: string | null;
  deadline?: number | null;
  deadlineHasTime?: boolean;
  note?: string;
  source?: TaskSource;
}

export type UpdateTaskFields = Partial<
  Pick<
    TaskItem,
    "title" | "projectKey" | "status" | "deadline" | "deadlineHasTime" | "note" | "subtasks"
  >
>;

export interface TasksState {
  tasks: TaskItem[];
  addTask: (input: AddTaskInput) => string;
  updateTask: (id: string, fields: UpdateTaskFields) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  archiveTask: (id: string) => void;
  reorderTask: (id: string, sortIndex: number) => void;
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Selectors ─────────────────────────────────────────────────────────
// Curried selectors (project-scoped) return a (state) => T function so they
// compose with useTasksStore(selectX(key)) without re-creating arrays inline.

/** All non-archived tasks, sorted by sortIndex. */
export const selectActiveTasks = (state: TasksState): TaskItem[] =>
  state.tasks
    .filter((t) => t.archivedAt === null)
    .sort((a, b) => a.sortIndex - b.sortIndex);

/** Non-archived tasks for one projectKey (null = global tasks), sorted by sortIndex. */
export const selectTasksForProject =
  (projectKey: string | null) =>
  (state: TasksState): TaskItem[] =>
    state.tasks
      .filter((t) => t.archivedAt === null && t.projectKey === projectKey)
      .sort((a, b) => a.sortIndex - b.sortIndex);

/** Open (not done) non-archived tasks for one projectKey, sorted by sortIndex. */
export const selectOpenTasksForProject =
  (projectKey: string | null) =>
  (state: TasksState): TaskItem[] =>
    state.tasks
      .filter(
        (t) =>
          t.archivedAt === null && t.status !== "done" && t.projectKey === projectKey,
      )
      .sort((a, b) => a.sortIndex - b.sortIndex);

/** The derived "nächste" task: lowest-sortIndex open task of a project. */
export const selectNextTask =
  (projectKey: string | null) =>
  (state: TasksState): TaskItem | undefined =>
    selectOpenTasksForProject(projectKey)(state)[0];

// ── Store ─────────────────────────────────────────────────────────────

export const useTasksStore = create<TasksState>()(
  persist(
    (set, get) => ({
      tasks: [],

      addTask: (input: AddTaskInput): string => {
        const id = createTaskId();
        const now = Date.now();
        const tasks = get().tasks;
        const maxSort = tasks.reduce((m, t) => Math.max(m, t.sortIndex), 0);
        const task: TaskItem = {
          id,
          projectKey: input.projectKey ?? null,
          title: input.title.trim(),
          status: "open",
          deadline: input.deadline ?? null,
          deadlineHasTime: input.deadlineHasTime ?? false,
          subtasks: [],
          source: input.source ?? "manual",
          sortIndex: maxSort + 1000,
          createdAt: now,
          completedAt: null,
          archivedAt: null,
        };
        if (typeof input.note === "string") task.note = input.note;
        set({ tasks: [...tasks, task] });
        return id;
      },

      updateTask: (id, fields) =>
        set((state) => ({
          tasks: state.tasks.map((t) => {
            if (t.id !== id) return t;
            const next: TaskItem = { ...t, ...fields };
            // Live mutations bypass the hydration sanitizer; coerce the two
            // fields a UI form can realistically corrupt so we never persist
            // values sanitizeTask would reject on the next load.
            if ("deadline" in fields) {
              next.deadline = toNullableTimestamp(fields.deadline);
            }
            if ("subtasks" in fields) {
              next.subtasks = Array.isArray(fields.subtasks)
                ? fields.subtasks
                    .map(sanitizeSubtask)
                    .filter((s): s is Subtask => s !== null)
                : t.subtasks;
            }
            return next;
          }),
        })),

      completeTask: (id) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, status: "done" as const, completedAt: Date.now() } : t,
          ),
        })),

      reopenTask: (id) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, status: "open" as const, completedAt: null } : t,
          ),
        })),

      archiveTask: (id) =>
        set((state) => ({
          tasks: state.tasks.map((t) =>
            t.id === id ? { ...t, archivedAt: Date.now() } : t,
          ),
        })),

      reorderTask: (id, sortIndex) => {
        if (!Number.isFinite(sortIndex)) return;
        set((state) => ({
          tasks: state.tasks.map((t) => (t.id === id ? { ...t, sortIndex } : t)),
        }));
      },
    }),
    {
      name: "smashq-tasks",
      storage: createJSONStorage(() => tasksStorage),
      partialize: (state) => ({ tasks: state.tasks }),
      version: 1,
      migrate: (persisted: unknown): { tasks: TaskItem[] } => {
        const p = persisted as { tasks?: unknown } | null;
        return { tasks: sanitizeTasks(p?.tasks) };
      },
      // Heal corruption in the SYNCHRONOUS merge path: it returns the state
      // that feeds the first render, and — critically — it does NOT reference
      // useTasksStore. Eager hydration runs DURING create(persist(...)), before
      // useTasksStore is bound, so calling useTasksStore.setState() from
      // onRehydrateStorage hits a TDZ ReferenceError (caught only at runtime
      // with non-empty persisted data). merge covers the same-version tamper
      // class that migrate (version-bump-only) misses. See lessons #209 /
      // "heal in merge, not onRehydrateStorage".
      merge: (persisted: unknown, current: TasksState): TasksState => {
        const p = persisted as { tasks?: unknown } | null;
        return { ...current, tasks: sanitizeTasks(p?.tasks) };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) logError("tasksStore.hydration", error);
      },
    },
  ),
);
