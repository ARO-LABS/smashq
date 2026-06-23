import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import { getErrorMessage } from "../utils/adpError";
import { wrapInvoke } from "../utils/perfLogger";
import { logError } from "../utils/errorLogger";
import { useUIStore } from "./uiStore";

export interface EditorFile {
  folder: string;
  relativePath: string;
  content: string;
  savedContent: string;
}

export interface RecentFile {
  folder: string;
  relativePath: string;
  label: string;
}

interface EditorState {
  openFile: EditorFile | null;
  isPreviewVisible: boolean;
  isSaving: boolean;
  recentFiles: RecentFile[];

  openFileFromProject: (folder: string, relativePath: string) => Promise<void>;
  openFileFromDialog: () => Promise<void>;
  openFileByPath: (absolutePath: string) => Promise<void>;
  updateContent: (content: string) => void;
  saveFile: () => Promise<boolean>;
  closeFile: () => void;
  togglePreview: () => void;
}

function isDirty(file: EditorFile | null): boolean {
  return file != null && file.content !== file.savedContent;
}

/**
 * Split an absolute path into `folder` (parent dir) + `relativePath` (filename).
 * Reused by the dialog flow, the path-input, and the editor empty-state. The
 * "folder = own parent" split lets `read_project_file` accept any absolute path
 * (the filename is trivially inside its parent) without subtree confinement.
 */
export function splitAbsolutePath(absolutePath: string): {
  folder: string;
  relativePath: string;
} {
  const normalized = absolutePath.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  const folder = lastSlash >= 0 ? normalized.slice(0, lastSlash) : "";
  const relativePath = normalized.slice(lastSlash + 1);
  return { folder, relativePath };
}

function addToRecent(
  recentFiles: RecentFile[],
  folder: string,
  relativePath: string,
): RecentFile[] {
  const label = relativePath.split("/").pop() ?? relativePath;
  const filtered = recentFiles.filter(
    (r) => !(r.folder === folder && r.relativePath === relativePath),
  );
  return [{ folder, relativePath, label }, ...filtered].slice(0, 10);
}

export const useEditorStore = create<EditorState>((set, get) => ({
  openFile: null,
  isPreviewVisible: true,
  isSaving: false,
  recentFiles: [],

  openFileFromProject: async (folder: string, relativePath: string) => {
    try {
      const content = await wrapInvoke<string>("read_project_file", {
        folder,
        relativePath,
      });
      set((state) => ({
        openFile: { folder, relativePath, content, savedContent: content },
        recentFiles: addToRecent(state.recentFiles, folder, relativePath),
      }));
    } catch (err) {
      logError("editorStore.openFileFromProject", err);
      useUIStore.getState().addToast({
        type: "error",
        title: "Fehler beim Öffnen",
        message: getErrorMessage(err),
      });
    }
  },

  openFileFromDialog: async () => {
    try {
      const filePath = await open({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        multiple: false,
      });
      if (!filePath || typeof filePath !== "string") return;

      // Derive folder (parent) and relativePath (filename) from absolute path
      const { folder, relativePath } = splitAbsolutePath(filePath);

      await get().openFileFromProject(folder, relativePath);
    } catch (err) {
      logError("editorStore.openFileFromDialog", err);
      useUIStore.getState().addToast({
        type: "error",
        title: "Fehler beim Öffnen",
        message: getErrorMessage(err),
      });
    }
  },

  openFileByPath: async (absolutePath: string) => {
    const trimmed = absolutePath.trim();
    if (!trimmed) return;
    const { folder, relativePath } = splitAbsolutePath(trimmed);
    await get().openFileFromProject(folder, relativePath);
  },

  updateContent: (content: string) => {
    set((state) => {
      if (!state.openFile) return state;
      return { openFile: { ...state.openFile, content } };
    });
  },

  saveFile: async () => {
    const { openFile } = get();
    if (!openFile || !isDirty(openFile)) return false;

    set({ isSaving: true });
    try {
      await wrapInvoke("write_project_file", {
        folder: openFile.folder,
        relativePath: openFile.relativePath,
        content: openFile.content,
      });
      set((state) => ({
        isSaving: false,
        openFile: state.openFile
          ? { ...state.openFile, savedContent: state.openFile.content }
          : null,
      }));
      useUIStore.getState().addToast({
        type: "success",
        title: "Gespeichert",
        message: openFile.relativePath,
        duration: 2000,
      });
      return true;
    } catch (err) {
      set({ isSaving: false });
      logError("editorStore.saveFile", err);
      useUIStore.getState().addToast({
        type: "error",
        title: "Fehler beim Speichern",
        message: getErrorMessage(err),
      });
      return false;
    }
  },

  closeFile: () => {
    set({ openFile: null });
  },

  togglePreview: () => {
    set((state) => ({ isPreviewVisible: !state.isPreviewVisible }));
  },
}));

// Granular selectors — prevent unnecessary re-renders
export const selectIsDirty = (state: EditorState): boolean =>
  isDirty(state.openFile);
export const selectOpenFile = (state: EditorState) => state.openFile;
export const selectIsSaving = (state: EditorState) => state.isSaving;
export const selectIsPreviewVisible = (state: EditorState) =>
  state.isPreviewVisible;
export const selectSaveFile = (state: EditorState) => state.saveFile;
export const selectTogglePreview = (state: EditorState) => state.togglePreview;
export const selectOpenFileFromDialog = (state: EditorState) =>
  state.openFileFromDialog;
export const selectCloseFile = (state: EditorState) => state.closeFile;
export const selectUpdateContent = (state: EditorState) => state.updateContent;
export const selectOpenFileByPath = (state: EditorState) => state.openFileByPath;
