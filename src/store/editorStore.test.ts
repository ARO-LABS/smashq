import { describe, it, expect, beforeEach, vi } from "vitest";
import { open } from "@tauri-apps/plugin-dialog";
import { wrapInvoke } from "../utils/perfLogger";
import {
  useEditorStore,
  selectIsDirty,
  selectOpenFile,
  selectIsSaving,
  selectIsPreviewVisible,
  selectSaveFile,
  selectTogglePreview,
  selectOpenFileFromDialog,
  selectCloseFile,
  selectUpdateContent,
} from "./editorStore";
import { useUIStore } from "./uiStore";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../utils/perfLogger", () => ({
  wrapInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

const mockInvoke = wrapInvoke as ReturnType<typeof vi.fn>;
const mockOpen = open as ReturnType<typeof vi.fn>;

// ── Helpers ───────────────────────────────────────────────────────────

function resetStore() {
  useEditorStore.setState({
    openFile: null,
    isPreviewVisible: true,
    isSaving: false,
    recentFiles: [],
  });
  useUIStore.setState({ toasts: [] });
}

async function openAndDirty(
  original = "orig",
  modified = "modified",
  folder = "/p",
  relativePath = "t.md",
) {
  mockInvoke.mockResolvedValueOnce(original);
  await useEditorStore.getState().openFileFromProject(folder, relativePath);
  useEditorStore.getState().updateContent(modified);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("editorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe("openFileFromProject", () => {
    it("loads file content and sets state", async () => {
      mockInvoke.mockResolvedValueOnce("# Hello World");

      await useEditorStore.getState().openFileFromProject("/project", "README.md");

      const state = useEditorStore.getState();
      expect(mockInvoke).toHaveBeenCalledWith("read_project_file", {
        folder: "/project",
        relativePath: "README.md",
      });
      expect(state.openFile).toEqual({
        folder: "/project",
        relativePath: "README.md",
        content: "# Hello World",
        savedContent: "# Hello World",
      });
    });

    it("adds to recent files", async () => {
      mockInvoke.mockResolvedValueOnce("content1");
      await useEditorStore.getState().openFileFromProject("/p", "a.md");

      mockInvoke.mockResolvedValueOnce("content2");
      await useEditorStore.getState().openFileFromProject("/p", "b.md");

      const recent = useEditorStore.getState().recentFiles;
      expect(recent).toHaveLength(2);
      expect(recent[0].relativePath).toBe("b.md");
      expect(recent[1].relativePath).toBe("a.md");
    });

    it("limits recent files to 10", async () => {
      for (let i = 0; i < 12; i++) {
        mockInvoke.mockResolvedValueOnce(`content-${i}`);
        await useEditorStore.getState().openFileFromProject("/p", `file-${i}.md`);
      }

      expect(useEditorStore.getState().recentFiles).toHaveLength(10);
    });

    it("shows error toast on failure", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("File not found"));

      await useEditorStore.getState().openFileFromProject("/p", "missing.md");

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect(toasts[0].title).toBe("Fehler beim Öffnen");
    });
  });

  describe("updateContent", () => {
    it("updates content and makes file dirty", async () => {
      mockInvoke.mockResolvedValueOnce("original");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");

      useEditorStore.getState().updateContent("modified");

      const state = useEditorStore.getState();
      expect(state.openFile?.content).toBe("modified");
      expect(state.openFile?.savedContent).toBe("original");
      expect(selectIsDirty(state)).toBe(true);
    });

    it("does nothing when no file is open", () => {
      useEditorStore.getState().updateContent("something");
      expect(useEditorStore.getState().openFile).toBeNull();
    });
  });

  describe("isDirty selector", () => {
    it("returns false when content matches saved", async () => {
      mockInvoke.mockResolvedValueOnce("same");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");

      expect(selectIsDirty(useEditorStore.getState())).toBe(false);
    });

    it("returns false when no file is open", () => {
      expect(selectIsDirty(useEditorStore.getState())).toBe(false);
    });
  });

  describe("saveFile", () => {
    it("saves file and resets dirty state", async () => {
      mockInvoke.mockResolvedValueOnce("original");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");
      useEditorStore.getState().updateContent("updated");

      mockInvoke.mockResolvedValueOnce(undefined);
      const result = await useEditorStore.getState().saveFile();

      expect(result).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith("write_project_file", {
        folder: "/p",
        relativePath: "test.md",
        content: "updated",
      });

      const state = useEditorStore.getState();
      expect(state.openFile?.savedContent).toBe("updated");
      expect(selectIsDirty(state)).toBe(false);
    });

    it("shows success toast on save", async () => {
      mockInvoke.mockResolvedValueOnce("content");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");
      useEditorStore.getState().updateContent("changed");

      mockInvoke.mockResolvedValueOnce(undefined);
      await useEditorStore.getState().saveFile();

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].title).toBe("Gespeichert");
    });

    it("shows error toast on failure", async () => {
      mockInvoke.mockResolvedValueOnce("content");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");
      useEditorStore.getState().updateContent("changed");

      mockInvoke.mockRejectedValueOnce(new Error("Permission denied"));
      const result = await useEditorStore.getState().saveFile();

      expect(result).toBe(false);
      expect(useEditorStore.getState().isSaving).toBe(false);

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
    });

    it("returns false when not dirty", async () => {
      mockInvoke.mockResolvedValueOnce("content");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");

      const result = await useEditorStore.getState().saveFile();
      expect(result).toBe(false);
      expect(mockInvoke).toHaveBeenCalledTimes(1); // Only the read call
    });
  });

  describe("closeFile", () => {
    it("clears the open file", async () => {
      mockInvoke.mockResolvedValueOnce("content");
      await useEditorStore.getState().openFileFromProject("/p", "test.md");

      useEditorStore.getState().closeFile();
      expect(useEditorStore.getState().openFile).toBeNull();
    });
  });

  describe("togglePreview", () => {
    it("toggles preview visibility", () => {
      expect(useEditorStore.getState().isPreviewVisible).toBe(true);

      useEditorStore.getState().togglePreview();
      expect(useEditorStore.getState().isPreviewVisible).toBe(false);

      useEditorStore.getState().togglePreview();
      expect(useEditorStore.getState().isPreviewVisible).toBe(true);
    });
  });

  // ── Persistence Safety (Sentinel Tests — highest risk) ──────────────

  describe("[SENTINEL] edge: open/close while dirty (documents current behavior)", () => {
    // Sentinel tests — will BREAK intentionally if a dirty-guard is added.
    // See bug-finding in PR #89 description / architect plan.
    it("openFileFromProject overwrites dirty file without warning", async () => {
      await openAndDirty("a-orig", "a-dirty", "/p", "a.md");
      expect(selectIsDirty(useEditorStore.getState())).toBe(true);

      mockInvoke.mockResolvedValueOnce("b-orig");
      await useEditorStore.getState().openFileFromProject("/p", "b.md");

      const state = useEditorStore.getState();
      expect(state.openFile?.relativePath).toBe("b.md");
      expect(state.openFile?.content).toBe("b-orig");
    });

    it("closeFile discards dirty file without warning", async () => {
      await openAndDirty("orig", "dirty");
      expect(selectIsDirty(useEditorStore.getState())).toBe(true);

      useEditorStore.getState().closeFile();
      expect(useEditorStore.getState().openFile).toBeNull();
    });
  });

  // ── saveFile edge cases ──────────────────────────────────────────────

  describe("saveFile edge cases", () => {
    it("flips isSaving flag during write and clears it afterwards", async () => {
      await openAndDirty("x", "y");

      let savingDuringWrite = false;
      mockInvoke.mockImplementationOnce(async () => {
        savingDuringWrite = useEditorStore.getState().isSaving;
        return undefined;
      });
      await useEditorStore.getState().saveFile();

      expect(savingDuringWrite).toBe(true);
      expect(useEditorStore.getState().isSaving).toBe(false);
    });

    it("second save call is no-op when not dirty anymore", async () => {
      await openAndDirty("orig", "new");

      mockInvoke.mockResolvedValueOnce(undefined);
      const firstResult = await useEditorStore.getState().saveFile();
      expect(firstResult).toBe(true);
      const callsAfterFirstSave = mockInvoke.mock.calls.length;

      const secondResult = await useEditorStore.getState().saveFile();
      expect(secondResult).toBe(false);
      expect(mockInvoke.mock.calls.length).toBe(callsAfterFirstSave);
    });

    it("becomes dirty again after save + subsequent edit", async () => {
      await openAndDirty("a", "b");

      mockInvoke.mockResolvedValueOnce(undefined);
      await useEditorStore.getState().saveFile();
      expect(selectIsDirty(useEditorStore.getState())).toBe(false);

      useEditorStore.getState().updateContent("c");
      expect(selectIsDirty(useEditorStore.getState())).toBe(true);
    });
  });

  // ── updateContent dirty-tracking bidirectional ───────────────────────

  describe("updateContent dirty-tracking", () => {
    it("reverting content to savedContent clears dirty flag", async () => {
      mockInvoke.mockResolvedValueOnce("orig");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");

      useEditorStore.getState().updateContent("changed");
      expect(selectIsDirty(useEditorStore.getState())).toBe(true);

      useEditorStore.getState().updateContent("orig");
      expect(selectIsDirty(useEditorStore.getState())).toBe(false);
    });
  });

  // ── openFileFromDialog ───────────────────────────────────────────────

  describe("openFileFromDialog", () => {
    it("opens file selected via dialog (Unix path)", async () => {
      mockOpen.mockResolvedValueOnce("/home/user/docs/note.md");
      mockInvoke.mockResolvedValueOnce("# Note");

      await useEditorStore.getState().openFileFromDialog();

      expect(mockInvoke).toHaveBeenCalledWith("read_project_file", {
        folder: "/home/user/docs",
        relativePath: "note.md",
      });
      expect(useEditorStore.getState().openFile?.content).toBe("# Note");
    });

    it("parses Windows paths correctly (backslash → slash)", async () => {
      mockOpen.mockResolvedValueOnce("C:\\Users\\h\\doc.md");
      mockInvoke.mockResolvedValueOnce("x");

      await useEditorStore.getState().openFileFromDialog();

      expect(mockInvoke).toHaveBeenCalledWith("read_project_file", {
        folder: "C:/Users/h",
        relativePath: "doc.md",
      });
    });

    it("returns silently when user cancels dialog", async () => {
      mockOpen.mockResolvedValueOnce(null);

      await useEditorStore.getState().openFileFromDialog();

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(useEditorStore.getState().openFile).toBeNull();
    });

    it("ignores non-string dialog result (e.g. multi-select array)", async () => {
      mockOpen.mockResolvedValueOnce(["/a.md", "/b.md"]);

      await useEditorStore.getState().openFileFromDialog();

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(useEditorStore.getState().openFile).toBeNull();
    });

    it("shows error toast when dialog throws", async () => {
      mockOpen.mockRejectedValueOnce(new Error("dialog fail"));

      await useEditorStore.getState().openFileFromDialog();

      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect(toasts[0].title).toBe("Fehler beim Öffnen");
    });
  });

  // ── recentFiles dedup ────────────────────────────────────────────────

  describe("recentFiles dedup", () => {
    it("deduplicates and moves to top when same file opened twice", async () => {
      mockInvoke.mockResolvedValueOnce("v1");
      await useEditorStore.getState().openFileFromProject("/p", "a.md");
      mockInvoke.mockResolvedValueOnce("v2");
      await useEditorStore.getState().openFileFromProject("/p", "b.md");
      mockInvoke.mockResolvedValueOnce("v3");
      await useEditorStore.getState().openFileFromProject("/p", "a.md");

      const recent = useEditorStore.getState().recentFiles;
      expect(recent).toHaveLength(2);
      expect(recent[0].relativePath).toBe("a.md");
      expect(recent[1].relativePath).toBe("b.md");
    });

    it("same path under a different folder is NOT deduped", async () => {
      mockInvoke.mockResolvedValueOnce("v1");
      await useEditorStore.getState().openFileFromProject("/p1", "x.md");
      mockInvoke.mockResolvedValueOnce("v2");
      await useEditorStore.getState().openFileFromProject("/p2", "x.md");

      const recent = useEditorStore.getState().recentFiles;
      expect(recent).toHaveLength(2);
      expect(recent[0].folder).toBe("/p2");
      expect(recent[1].folder).toBe("/p1");
    });

    it("derives label from the filename of a nested relativePath", async () => {
      mockInvoke.mockResolvedValueOnce("c");
      await useEditorStore.getState().openFileFromProject("/p", "docs/sub/note.md");

      expect(useEditorStore.getState().recentFiles[0].label).toBe("note.md");
    });

    it("label falls back to the whole relativePath when no slash present", async () => {
      mockInvoke.mockResolvedValueOnce("c");
      await useEditorStore.getState().openFileFromProject("/p", "flat.md");

      expect(useEditorStore.getState().recentFiles[0].label).toBe("flat.md");
    });

    it("keeps the 10 most recent entries, dropping the oldest", async () => {
      for (let i = 0; i < 12; i++) {
        mockInvoke.mockResolvedValueOnce(`c-${i}`);
        await useEditorStore.getState().openFileFromProject("/p", `f-${i}.md`);
      }
      const recent = useEditorStore.getState().recentFiles;
      expect(recent).toHaveLength(10);
      expect(recent[0].relativePath).toBe("f-11.md");
      expect(recent[9].relativePath).toBe("f-2.md");
    });

    it("recent files are unchanged when the read call fails", async () => {
      mockInvoke.mockRejectedValueOnce(new Error("boom"));
      await useEditorStore.getState().openFileFromProject("/p", "fail.md");

      expect(useEditorStore.getState().recentFiles).toEqual([]);
    });
  });

  // ── initial state / defaults ─────────────────────────────────────────

  describe("initial state", () => {
    it("openFile defaults to null", () => {
      expect(useEditorStore.getState().openFile).toBeNull();
    });

    it("isPreviewVisible defaults to true", () => {
      expect(useEditorStore.getState().isPreviewVisible).toBe(true);
    });

    it("isSaving defaults to false", () => {
      expect(useEditorStore.getState().isSaving).toBe(false);
    });

    it("recentFiles defaults to an empty array", () => {
      expect(useEditorStore.getState().recentFiles).toEqual([]);
    });
  });

  // ── openFileFromProject — failure leaves prior file intact ───────────

  describe("openFileFromProject — failure isolation", () => {
    it("keeps the previously open file when a new open fails", async () => {
      mockInvoke.mockResolvedValueOnce("good");
      await useEditorStore.getState().openFileFromProject("/p", "ok.md");

      mockInvoke.mockRejectedValueOnce(new Error("nope"));
      await useEditorStore.getState().openFileFromProject("/p", "bad.md");

      expect(useEditorStore.getState().openFile?.relativePath).toBe("ok.md");
    });

    it("opens a file with empty content", async () => {
      mockInvoke.mockResolvedValueOnce("");
      await useEditorStore.getState().openFileFromProject("/p", "empty.md");

      const state = useEditorStore.getState();
      expect(state.openFile?.content).toBe("");
      expect(selectIsDirty(state)).toBe(false);
    });

    it("non-Error rejection still surfaces an error toast", async () => {
      mockInvoke.mockRejectedValueOnce("string failure");
      await useEditorStore.getState().openFileFromProject("/p", "x.md");

      expect(useUIStore.getState().toasts[0].type).toBe("error");
    });
  });

  // ── saveFile — no file open ──────────────────────────────────────────

  describe("saveFile — no open file", () => {
    it("returns false and invokes nothing when no file is open", async () => {
      const result = await useEditorStore.getState().saveFile();
      expect(result).toBe(false);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("does not flip isSaving when there is nothing to save", async () => {
      await useEditorStore.getState().saveFile();
      expect(useEditorStore.getState().isSaving).toBe(false);
    });

    it("save error toast carries the 'Fehler beim Speichern' title", async () => {
      await openAndDirty("a", "b");
      mockInvoke.mockRejectedValueOnce(new Error("disk full"));
      await useEditorStore.getState().saveFile();

      expect(useUIStore.getState().toasts[0].title).toBe("Fehler beim Speichern");
    });

    it("success toast includes the relativePath as message", async () => {
      await openAndDirty("a", "b", "/proj", "notes.md");
      mockInvoke.mockResolvedValueOnce(undefined);
      await useEditorStore.getState().saveFile();

      expect(useUIStore.getState().toasts[0].message).toBe("notes.md");
    });

    it("clears isSaving after a failed save", async () => {
      await openAndDirty("a", "b");
      mockInvoke.mockRejectedValueOnce(new Error("fail"));
      await useEditorStore.getState().saveFile();

      expect(useEditorStore.getState().isSaving).toBe(false);
    });
  });

  // ── closeFile — clean file ───────────────────────────────────────────

  describe("closeFile — additional", () => {
    it("is a no-op-safe call when no file is open", () => {
      useEditorStore.getState().closeFile();
      expect(useEditorStore.getState().openFile).toBeNull();
    });

    it("does not touch recentFiles", async () => {
      mockInvoke.mockResolvedValueOnce("c");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");
      useEditorStore.getState().closeFile();

      expect(useEditorStore.getState().recentFiles).toHaveLength(1);
    });
  });

  // ── updateContent — additional ───────────────────────────────────────

  describe("updateContent — additional", () => {
    it("setting identical content keeps file clean", async () => {
      mockInvoke.mockResolvedValueOnce("same");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");
      useEditorStore.getState().updateContent("same");

      expect(selectIsDirty(useEditorStore.getState())).toBe(false);
    });

    it("preserves folder and relativePath when updating content", async () => {
      mockInvoke.mockResolvedValueOnce("orig");
      await useEditorStore.getState().openFileFromProject("/proj", "deep/f.md");
      useEditorStore.getState().updateContent("new");

      const f = useEditorStore.getState().openFile;
      expect(f?.folder).toBe("/proj");
      expect(f?.relativePath).toBe("deep/f.md");
      expect(f?.savedContent).toBe("orig");
    });

    it("updating to empty string makes a non-empty file dirty", async () => {
      mockInvoke.mockResolvedValueOnce("text");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");
      useEditorStore.getState().updateContent("");

      expect(selectIsDirty(useEditorStore.getState())).toBe(true);
    });
  });

  // ── openFileFromDialog — additional ──────────────────────────────────

  describe("openFileFromDialog — additional", () => {
    it("propagates a read failure as an error toast", async () => {
      mockOpen.mockResolvedValueOnce("/d/note.md");
      mockInvoke.mockRejectedValueOnce(new Error("read fail"));

      await useEditorStore.getState().openFileFromDialog();

      expect(useUIStore.getState().toasts[0].type).toBe("error");
      expect(useEditorStore.getState().openFile).toBeNull();
    });

    it("returns silently when dialog yields undefined", async () => {
      mockOpen.mockResolvedValueOnce(undefined);
      await useEditorStore.getState().openFileFromDialog();

      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it("adds the dialog-opened file to recentFiles", async () => {
      mockOpen.mockResolvedValueOnce("/home/user/x.md");
      mockInvoke.mockResolvedValueOnce("body");
      await useEditorStore.getState().openFileFromDialog();

      const recent = useEditorStore.getState().recentFiles;
      expect(recent).toHaveLength(1);
      expect(recent[0].relativePath).toBe("x.md");
      expect(recent[0].label).toBe("x.md");
    });
  });

  // ── togglePreview — additional ───────────────────────────────────────

  describe("togglePreview — additional", () => {
    it("toggling twice returns to the original value", () => {
      const before = useEditorStore.getState().isPreviewVisible;
      useEditorStore.getState().togglePreview();
      useEditorStore.getState().togglePreview();
      expect(useEditorStore.getState().isPreviewVisible).toBe(before);
    });

    it("does not affect the open file", async () => {
      mockInvoke.mockResolvedValueOnce("c");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");
      useEditorStore.getState().togglePreview();

      expect(useEditorStore.getState().openFile?.relativePath).toBe("t.md");
    });
  });

  // ── granular selectors ───────────────────────────────────────────────

  describe("granular selectors", () => {
    it("selectOpenFile returns the current openFile", async () => {
      mockInvoke.mockResolvedValueOnce("c");
      await useEditorStore.getState().openFileFromProject("/p", "t.md");

      expect(selectOpenFile(useEditorStore.getState())?.relativePath).toBe("t.md");
    });

    it("selectOpenFile returns null when nothing open", () => {
      expect(selectOpenFile(useEditorStore.getState())).toBeNull();
    });

    it("selectIsSaving reflects the isSaving flag", () => {
      expect(selectIsSaving(useEditorStore.getState())).toBe(false);
      useEditorStore.setState({ isSaving: true });
      expect(selectIsSaving(useEditorStore.getState())).toBe(true);
    });

    it("selectIsPreviewVisible reflects the preview flag", () => {
      expect(selectIsPreviewVisible(useEditorStore.getState())).toBe(true);
      useEditorStore.getState().togglePreview();
      expect(selectIsPreviewVisible(useEditorStore.getState())).toBe(false);
    });

    it("selectSaveFile returns the bound saveFile action", () => {
      expect(selectSaveFile(useEditorStore.getState())).toBe(
        useEditorStore.getState().saveFile,
      );
    });

    it("selectTogglePreview returns the togglePreview action", () => {
      expect(selectTogglePreview(useEditorStore.getState())).toBe(
        useEditorStore.getState().togglePreview,
      );
    });

    it("selectOpenFileFromDialog returns the openFileFromDialog action", () => {
      expect(selectOpenFileFromDialog(useEditorStore.getState())).toBe(
        useEditorStore.getState().openFileFromDialog,
      );
    });

    it("selectCloseFile returns the closeFile action", () => {
      expect(selectCloseFile(useEditorStore.getState())).toBe(
        useEditorStore.getState().closeFile,
      );
    });

    it("selectUpdateContent returns the updateContent action", () => {
      expect(selectUpdateContent(useEditorStore.getState())).toBe(
        useEditorStore.getState().updateContent,
      );
    });

    it("selectIsDirty is true after an edit and false after save", async () => {
      await openAndDirty("a", "b");
      expect(selectIsDirty(useEditorStore.getState())).toBe(true);

      mockInvoke.mockResolvedValueOnce(undefined);
      await useEditorStore.getState().saveFile();
      expect(selectIsDirty(useEditorStore.getState())).toBe(false);
    });
  });
});
