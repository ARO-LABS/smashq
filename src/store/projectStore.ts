import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────────────

interface FolderProject {
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
  /** Maps folder path → selected project. Persisted across sessions. */
  projectByFolder: Record<string, FolderProject>;
  /** Selected project for the folder-independent global board mode. */
  globalProject: FolderProject | null;
  setFolderProject: (folder: string, project: FolderProject) => void;
  getProjectForFolder: (folder: string) => FolderProject | undefined;
  setGlobalProject: (project: FolderProject | null) => void;
  getGlobalProject: () => FolderProject | undefined;
}

// ── Validation ───────────────────────────────────────────────────────

/**
 * Validates one persisted board selection. Returns a cleaned [`FolderProject`]
 * or `null` when the value is unusable (would otherwise produce failing
 * `get_project_board` calls or broken rendering). A `projectNumber` must be a
 * positive integer and `projectId` a non-empty string; `title` defaults to ""
 * and `owner` is carried through only when it is a non-empty string.
 *
 * Exported so the same guard backs both the store default and the persist
 * recovery hooks (and is unit-testable in isolation).
 */
export function sanitizeFolderProject(value: unknown): FolderProject | null {
  if (value == null || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;

  const num = o.projectNumber;
  if (typeof num !== "number" || !Number.isInteger(num) || num <= 0) return null;

  if (typeof o.projectId !== "string" || o.projectId.length === 0) return null;

  const result: FolderProject = {
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
 * Sanitizes a raw persisted blob into clean `projectByFolder` + `globalProject`.
 * Drops every entry that fails [`sanitizeFolderProject`] so a corrupt or stale
 * payload can never hand the UI a board reference it cannot load. Shared by
 * both `migrate` (schema bump) and `merge` (same-version corruption recovery).
 */
function sanitizePersistedState(
  raw: unknown,
): Pick<ProjectState, "projectByFolder" | "globalProject"> {
  const obj = (raw ?? {}) as Record<string, unknown>;

  const projectByFolder: Record<string, FolderProject> = {};
  const rawMap = obj.projectByFolder;
  if (rawMap != null && typeof rawMap === "object") {
    for (const [folder, proj] of Object.entries(rawMap as Record<string, unknown>)) {
      const clean = sanitizeFolderProject(proj);
      if (clean) projectByFolder[folder] = clean;
    }
  }

  return {
    projectByFolder,
    globalProject: sanitizeFolderProject(obj.globalProject),
  };
}

// ── Store ─────────────────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projectByFolder: {},
      globalProject: null,

      setFolderProject: (folder, project) =>
        set((state) => ({
          projectByFolder: { ...state.projectByFolder, [folder]: project },
        })),

      getProjectForFolder: (folder) => get().projectByFolder[folder],

      setGlobalProject: (project) => set({ globalProject: project }),

      getGlobalProject: () => get().globalProject ?? undefined,
    }),
    {
      name: "agentic-project-store",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Schema-bump path: validate the old payload while migrating it forward.
      migrate: (persisted) => ({
        ...(persisted as object),
        ...sanitizePersistedState(persisted),
      }),
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
