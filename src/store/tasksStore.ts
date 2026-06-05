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

interface TasksState {
  tasks: TaskItem[];
  addTask: (input: AddTaskInput) => string;
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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
      // Same-version corruption recovery: migrate only runs on a version
      // bump; a tampered tasks.json at the current version must still be
      // healed before the first render reads it (mirrors settingsStore #209).
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          logError("tasksStore.hydration", error);
          return;
        }
        if (!state) return;
        const clean = sanitizeTasks(state.tasks);
        if (JSON.stringify(clean) !== JSON.stringify(state.tasks)) {
          useTasksStore.setState({ tasks: clean });
        }
      },
    },
  ),
);
