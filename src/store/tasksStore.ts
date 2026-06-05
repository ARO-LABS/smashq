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

// ── Store placeholder (expanded by later tasks) ───────────────────────

interface TasksState {
  tasks: TaskItem[];
}

export const useTasksStore = create<TasksState>()(
  persist(
    () => ({ tasks: [] as TaskItem[] }),
    {
      name: "tasks-store",
      storage: createJSONStorage(() => tasksStorage),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          logError("tasksStore", error);
        } else if (state) {
          state.tasks = sanitizeTasks(state.tasks);
        }
      },
    },
  ),
);
