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
  /** Appointment start, epoch ms; null = kein Termin (pair invariant with endsAt). */
  startsAt: number | null;
  /** Appointment end, epoch ms (>= startsAt); null = kein Termin. Both are null or both set. */
  endsAt: number | null;
  note?: string;
  subtasks: Subtask[];
  source: TaskSource;
  /** Manual ordering, 1000-step gaps. "nächste" = lowest sortIndex open task. */
  sortIndex: number;
  createdAt: number;
  completedAt: number | null;
}

// ── Slot helpers ──────────────────────────────────────────────────────

/** Default appointment length: 30 minutes. */
export const SLOT_MS = 30 * 60_000;

/** Next half-hour boundary from `now`, plus a 30-min default window. */
export function defaultSlot(now: number = Date.now()): { startsAt: number; endsAt: number } {
  const startsAt = Math.ceil(now / SLOT_MS) * SLOT_MS;
  return { startsAt, endsAt: startsAt + SLOT_MS };
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

  // Legacy migration: a task that was "archived" in the pre-delete model carried
  // an archivedAt timestamp and was hidden from every list. With no restore UI,
  // the user treated that as deletion — so drop it under the new hard-delete
  // model instead of resurrecting it as an active task.
  if (typeof v.archivedAt === "number" && Number.isFinite(v.archivedAt)) return null;

  const status: TaskStatus = VALID_STATUS.has(v.status as string)
    ? (v.status as TaskStatus)
    : "open";
  const source: TaskSource = v.source === "session" ? "session" : "manual";
  const subtasks = Array.isArray(v.subtasks)
    ? v.subtasks.map(sanitizeSubtask).filter((s): s is Subtask => s !== null)
    : [];

  const startsRaw =
    typeof v.startsAt === "number" && Number.isFinite(v.startsAt) ? v.startsAt : null;
  const endsRaw =
    typeof v.endsAt === "number" && Number.isFinite(v.endsAt) ? v.endsAt : null;
  const legacy =
    typeof v.deadline === "number" && Number.isFinite(v.deadline) ? v.deadline : null;

  // Pair invariant: both null ("kein Termin") or both set. A lone endsAt
  // (startsRaw null) is a half state and collapses to "kein Termin".
  let slot: { startsAt: number | null; endsAt: number | null };
  if (startsRaw !== null) {
    slot = { startsAt: startsRaw, endsAt: endsRaw !== null && endsRaw >= startsRaw ? endsRaw : startsRaw + SLOT_MS };
  } else if (legacy !== null) {
    slot = { startsAt: legacy, endsAt: legacy + SLOT_MS };
  } else {
    slot = { startsAt: null, endsAt: null };
  }

  const result: TaskItem = {
    id: v.id,
    projectKey: typeof v.projectKey === "string" ? v.projectKey : null,
    title: v.title,
    status,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    subtasks,
    source,
    sortIndex: toFiniteNumber(v.sortIndex, 0),
    createdAt: toFiniteNumber(v.createdAt, 0),
    completedAt: toNullableTimestamp(v.completedAt),
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
  startsAt?: number;
  endsAt?: number;
  note?: string;
  source?: TaskSource;
}

export type UpdateTaskFields = Partial<
  Pick<
    TaskItem,
    "title" | "projectKey" | "status" | "startsAt" | "endsAt" | "note" | "subtasks"
  >
>;

export interface TasksState {
  tasks: TaskItem[];
  addTask: (input: AddTaskInput) => string;
  updateTask: (id: string, fields: UpdateTaskFields) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  deleteTask: (id: string) => void;
  reorderTask: (id: string, sortIndex: number) => void;
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Selectors ─────────────────────────────────────────────────────────
// Curried selectors (project-scoped) return a (state) => T function so they
// compose with useTasksStore(selectX(key)) without re-creating arrays inline.

/** All tasks, sorted by sortIndex. */
export const selectActiveTasks = (state: TasksState): TaskItem[] =>
  state.tasks.slice().sort((a, b) => a.sortIndex - b.sortIndex);

/** Tasks for one projectKey (null = global tasks), sorted by sortIndex. */
export const selectTasksForProject =
  (projectKey: string | null) =>
  (state: TasksState): TaskItem[] =>
    state.tasks
      .filter((t) => t.projectKey === projectKey)
      .sort((a, b) => a.sortIndex - b.sortIndex);

/** Open (not done) tasks for one projectKey, sorted by sortIndex. */
export const selectOpenTasksForProject =
  (projectKey: string | null) =>
  (state: TasksState): TaskItem[] =>
    state.tasks
      .filter((t) => t.status !== "done" && t.projectKey === projectKey)
      .sort((a, b) => a.sortIndex - b.sortIndex);

/** Anzahl offener (nicht-done) Aufgaben eines Projekts — primitive-safe für Badge-Subscriptions. */
export const selectOpenTaskCountForProject =
  (projectKey: string | null) =>
  (state: TasksState): number =>
    state.tasks.filter((t) => t.status !== "done" && t.projectKey === projectKey).length;

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
        // Honor an explicit startsAt even without endsAt (default +30 min), and
        // clamp an inverted slot — keeps addTask's write path consistent with
        // updateTask/sanitizeTask so no code path can persist endsAt < startsAt.
        // No input date → no Termin (both null): a Termin exists only on request.
        const slot: { startsAt: number | null; endsAt: number | null } =
          input.startsAt != null
            ? {
                startsAt: input.startsAt,
                endsAt:
                  input.endsAt != null && input.endsAt >= input.startsAt
                    ? input.endsAt
                    : input.startsAt + SLOT_MS,
              }
            : { startsAt: null, endsAt: null };
        const task: TaskItem = {
          id,
          projectKey: input.projectKey ?? null,
          title: input.title.trim(),
          status: "open",
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          subtasks: [],
          source: input.source ?? "manual",
          sortIndex: maxSort + 1000,
          createdAt: now,
          completedAt: null,
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
            // Live mutations bypass the hydration sanitizer; coerce fields
            // a UI form can realistically corrupt so we never persist values
            // sanitizeTask would reject on the next load.
            if ("startsAt" in fields || "endsAt" in fields) {
              // Explicit `startsAt: null` removes the Termin; a garbage value
              // falls back to the previous startsAt (which may itself be null).
              // Either way the pair invariant (both null or both set) is
              // enforced here so no half state can ever persist.
              const rawStart = fields.startsAt === null ? null : next.startsAt;
              const s =
                typeof rawStart === "number" && Number.isFinite(rawStart)
                  ? rawStart
                  : fields.startsAt === null
                    ? null
                    : t.startsAt;
              if (s === null) {
                next.startsAt = null;
                next.endsAt = null;
              } else {
                let e =
                  typeof next.endsAt === "number" && Number.isFinite(next.endsAt)
                    ? next.endsAt
                    : s + SLOT_MS;
                if (e < s) e = s + SLOT_MS;
                next.startsAt = s;
                next.endsAt = e;
              }
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

      deleteTask: (id) =>
        set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),

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
      version: 3,
      migrate: (persisted: unknown, fromVersion: number): { tasks: TaskItem[] } => {
        const p = persisted as { tasks?: unknown } | null;
        const tasks = sanitizeTasks(p?.tasks);
        // v3 "Termin optional": one-time cut (deliberate user decision) — all
        // pre-v3 Termine were auto-stamped default slots, not chosen dates, so
        // they are nulled once. merge below must NOT do this: it runs on every
        // rehydrate and would wipe deliberately set dates.
        if (fromVersion < 3) {
          return { tasks: tasks.map((t) => ({ ...t, startsAt: null, endsAt: null })) };
        }
        return { tasks };
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
