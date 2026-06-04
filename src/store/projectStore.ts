import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// ── Types ────────────────────────────────────────────────────────────

interface FolderProject {
  projectNumber: number;
  projectId: string;
  title: string;
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
      storage: createJSONStorage(() => localStorage),
    }
  )
);
