/**
 * taskGrouping — pure helper functions for filtering and grouping TaskItem arrays.
 *
 * No store reads here: all inputs are plain data so every function is
 * trivially unit-testable without mocking Zustand.
 *
 * Types consumed:
 *   TaskItem, TaskStatus — from tasksStore (the single state source)
 *
 * Types produced / re-exported:
 *   ProjectOption — used by groupByProject and by useTasksContext
 *   TaskFilter    — filter chip values
 *   DeadlineBucket — bucket keys for groupByDeadline
 */

import type { TaskItem } from "../../../store/tasksStore";

// ── Exported types ─────────────────────────────────────────────────────

export type TaskFilter = "all" | "open" | "done";

export type DeadlineBucket = "overdue" | "today" | "week" | "later";

export interface ProjectOption {
  key: string | null;
  label: string;
}

// ── Bucket label map (German, imperative) ─────────────────────────────

const BUCKET_LABELS: Record<DeadlineBucket, string> = {
  overdue: "Überfällig",
  today: "Heute",
  week: "Diese Woche",
  later: "Später",
};

// ── Internal helpers ──────────────────────────────────────────────────

/** Midnight (00:00:00.000) of the local calendar day that contains `nowMs`. */
function startOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Classify a startsAt epoch into one of the four timed buckets. */
function classifyDeadline(startsAt: number, nowMs: number): DeadlineBucket {
  const todayStart = startOfDay(nowMs);
  const tomorrowStart = todayStart + 86_400_000;
  // "This week" = next 7 calendar days from today (exclusive of today itself)
  const weekEnd = todayStart + 7 * 86_400_000;

  if (startsAt < nowMs) return "overdue";
  if (startsAt < tomorrowStart) return "today";
  if (startsAt < weekEnd) return "week";
  return "later";
}

// ── filterTasks ───────────────────────────────────────────────────────

/**
 * Filter a pre-sorted list of TaskItems by status filter and optional
 * full-text search query.
 *
 * - `filter === "all"` : no status restriction
 * - `filter === "open"`: only status "open" | "active"
 * - `filter === "done"`: only status "done"
 *
 * `query` is matched case-insensitively against `title` (and `note` when
 * present). An empty / whitespace-only query matches everything.
 *
 * The input order is preserved; callers are responsible for sorting first.
 */
export function filterTasks(
  tasks: TaskItem[],
  filter: TaskFilter,
  query: string,
): TaskItem[] {
  const q = query.trim().toLowerCase();

  return tasks.filter((task) => {
    // ── Status filter ─────────────────────────────────────────────────
    if (filter === "open" && task.status === "done") return false;
    if (filter === "done" && task.status !== "done") return false;

    // ── Text search ───────────────────────────────────────────────────
    if (q !== "") {
      const titleMatch = task.title.toLowerCase().includes(q);
      const noteMatch =
        typeof task.note === "string" && task.note.toLowerCase().includes(q);
      if (!titleMatch && !noteMatch) return false;
    }

    return true;
  });
}

// ── nextTaskId ────────────────────────────────────────────────────────

/**
 * The "nächste" task id: lowest-sortIndex open (non-done) task from an
 * already-sorted open-task list.
 *
 * Callers typically pass `selectOpenTasksForProject(key)(state)` which is
 * already sorted by sortIndex ascending.
 *
 * Returns `undefined` when the list is empty.
 */
export function nextTaskId(openSorted: TaskItem[]): string | undefined {
  return openSorted[0]?.id;
}

// ── groupByProject ────────────────────────────────────────────────────

/**
 * Group a flat list of tasks by projectKey.
 *
 * The output order mirrors `projects`: each `ProjectOption` that has at
 * least one matching task produces one group entry. Tasks whose projectKey
 * doesn't appear in `projects` are silently dropped (callers pass a
 * complete project list from useTasksContext).
 *
 * Within each group tasks are returned in their input order (callers pass
 * a sortIndex-sorted list).
 *
 * `nextId` = the id of the lowest-sortIndex open (non-done) task in the
 * group, matching the "nächste" semantics from selectNextTask.
 * `undefined` when the group has no open tasks.
 */
export function groupByProject(
  tasks: TaskItem[],
  projects: ProjectOption[],
): { key: string | null; label: string; tasks: TaskItem[]; nextId: string | undefined }[] {
  // Build a lookup: projectKey → ProjectOption
  // null is a valid key; use a sentinel string only internally.
  const GLOBAL_SENTINEL = "\0global";

  const optionByKey = new Map<string, ProjectOption>();
  for (const p of projects) {
    optionByKey.set(p.key ?? GLOBAL_SENTINEL, p);
  }

  // Bucket tasks by key
  const buckets = new Map<string, TaskItem[]>();
  for (const task of tasks) {
    const bucketKey = task.projectKey ?? GLOBAL_SENTINEL;
    if (!optionByKey.has(bucketKey)) continue; // not in provided projects list
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
    }
    bucket.push(task);
  }

  // Emit groups in the projects order, skipping empty groups
  const result: {
    key: string | null;
    label: string;
    tasks: TaskItem[];
    nextId: string | undefined;
  }[] = [];

  for (const option of projects) {
    const sentinel = option.key ?? GLOBAL_SENTINEL;
    const groupTasks = buckets.get(sentinel);
    if (!groupTasks || groupTasks.length === 0) continue;

    // Lowest-sortIndex open task within this group
    const openSorted = groupTasks
      .filter((t) => t.status !== "done")
      .sort((a, b) => a.sortIndex - b.sortIndex);

    result.push({
      key: option.key,
      label: option.label,
      tasks: groupTasks,
      nextId: nextTaskId(openSorted),
    });
  }

  return result;
}

// ── groupByDeadline ───────────────────────────────────────────────────

/**
 * Group a flat list of tasks into four slot buckets, evaluated against
 * `Date.now()` at call time (pure w.r.t. inputs, but reads the clock).
 *
 * Bucket order: overdue → today → week → later.
 * Empty buckets are omitted from the result.
 * Task order within each bucket mirrors the input order.
 */
export function groupByDeadline(tasks: TaskItem[]): {
  bucket: DeadlineBucket;
  label: string;
  tasks: TaskItem[];
}[] {
  const nowMs = Date.now();

  const buckets: Record<DeadlineBucket, TaskItem[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
  };

  for (const task of tasks) {
    buckets[classifyDeadline(task.startsAt, nowMs)].push(task);
  }

  const ORDER: DeadlineBucket[] = ["overdue", "today", "week", "later"];

  return ORDER.filter((b) => buckets[b].length > 0).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    tasks: buckets[b],
  }));
}
