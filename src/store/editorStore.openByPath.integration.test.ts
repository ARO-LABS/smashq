import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { splitAbsolutePath, useEditorStore } from "./editorStore";

describe("splitAbsolutePath", () => {
  it("splits a Windows backslash path into folder + filename", () => {
    expect(splitAbsolutePath("C:\\Projects\\smashq\\tasks\\todo.md")).toEqual({
      folder: "C:/Projects/smashq/tasks",
      relativePath: "todo.md",
    });
  });

  it("splits a forward-slash path", () => {
    expect(splitAbsolutePath("/home/u/docs/readme.md")).toEqual({
      folder: "/home/u/docs",
      relativePath: "readme.md",
    });
  });

  it("bare filename with no slash returns empty folder", () => {
    expect(splitAbsolutePath("readme.md")).toEqual({ folder: "", relativePath: "readme.md" });
  });

  it("trailing slash returns empty relativePath", () => {
    expect(splitAbsolutePath("C:/projects/")).toEqual({ folder: "C:/projects", relativePath: "" });
  });
});

describe("openFileByPath", () => {
  beforeEach(() => {
    useEditorStore.setState({ openFile: null, recentFiles: [] });
  });
  afterEach(() => {
    clearMocks();
    vi.restoreAllMocks();
  });

  it("reads the file via read_project_file and sets openFile", async () => {
    let capturedArgs: unknown;
    mockIPC((cmd, args) => {
      if (cmd === "read_project_file") {
        capturedArgs = args;
        return "# content";
      }
      return undefined;
    });

    await useEditorStore.getState().openFileByPath("C:\\p\\x.md");

    expect(capturedArgs).toMatchObject({ folder: "C:/p", relativePath: "x.md" });
    const f = useEditorStore.getState().openFile;
    expect(f?.relativePath).toBe("x.md");
    expect(f?.content).toBe("# content");
  });

  it("no-ops on an empty path (no IPC call)", async () => {
    const spy = vi.fn();
    mockIPC((cmd) => {
      spy(cmd);
      return "";
    });
    await useEditorStore.getState().openFileByPath("   ");
    expect(spy).not.toHaveBeenCalled();
  });

  it("no-ops on a trailing-slash path (directory, no filename)", async () => {
    const spy = vi.fn();
    mockIPC((cmd) => {
      spy(cmd);
      return "";
    });
    await useEditorStore.getState().openFileByPath("C:/projects/smashq/");
    expect(spy).not.toHaveBeenCalled();
  });
});
