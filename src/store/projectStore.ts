import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────────────

interface BoardRef {
  projectNumber: number;
  projectId: string;
  title: string;
  /**
   * Owner login the board belongs to — a user login or an organization login.
   * Optional: the board is LOADED by its global `projectId` (`node(id:)`), so
   * legacy entries persisted before org support (no `owner`) still resolve.
   * The owner is used to re-list an owner's boards in the picker and for display.
   */
  owner?: string;
}

interface ProjectState {
  /** The single, globally-selected Kanban board (null until one is chosen). */
  globalProject: BoardRef | null;
  setGlobalProject: (project: BoardRef | null) => void;
  getGlobalProject: () => BoardRef | undefined;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validates a persisted board selection. Returns a cleaned [`BoardRef`] or
 * `null` when the value is unusable (would otherwise produce failing
 * `get_project_board` calls or broken rendering). A `projectNumber` must be a
 * positive integer and `projectId` a non-empty string; `title` defaults to ""
 * and `owner` is carried through only when it is a non-empty string.
 *
 * Exported so the same guard backs both the store default and the persist
 * recovery hooks (and is unit-testable in isolation).
 */
export function sanitizeBoardRef(value: unknown): BoardRef | null {
  if (value == null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  const num = o.projectNumber;
  if (typeof num !== "number" || !Number.isInteger(num) || num <= 0) return null;

  if (typeof o.projectId !== "string" || o.projectId.length === 0) return null;

  const result: BoardRef = {
    projectNumber: num,
    projectId: o.projectId,
    title: typeof o.title === "string" ? o.title : "",
  };
  if (typeof o.owner === "string" && o.owner.length > 0) {
    result.owner = o.owner;
  }
  return result;
}

/**
 * Sanitizes a raw persisted blob into a clean `globalProject`. A corrupt or
 * stale payload can never hand the UI a board reference it cannot load. Shared
 * by both `migrate` (schema bump) and `merge` (same-version corruption recovery).
 */
function sanitizePersistedState(
  raw: unknown,
): Pick<ProjectState, "globalProject"> {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return { globalProject: sanitizeBoardRef(obj.globalProject) };
}

// ── Store ─────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      globalProject: null,
      setGlobalProject: (project) => set({ globalProject: project }),
      getGlobalProject: () => get().globalProject ?? undefined,
    }),
    {
      name: "agentic-project-store",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      // Schema-bump path (incl. v1→v2 which dropped per-folder boards): keep ONLY
      // the validated `globalProject`. A pre-v2 `projectByFolder` is intentionally
      // not carried over (it is not spread back in).
      migrate: (persisted) => sanitizePersistedState(persisted),
      // Same-version corruption recovery. `merge` runs synchronously on EVERY
      // rehydrate and returns the cleaned state directly — unlike a
      // setState-based `onRehydrateStorage`, it carries no TDZ footgun (see
      // tasks/lessons.md 2026-06-07) yet still covers the Issue-#209 class that
      // `migrate` alone (version-bump only) would miss.
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedState(persisted),
      }),
    },
  ),
);
