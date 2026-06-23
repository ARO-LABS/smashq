import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { MarkdownEditorView } from "./MarkdownEditorView";
import { useEditorStore } from "../../store/editorStore";

describe("MarkdownEditorView pending-open handoff", () => {
  beforeEach(() => {
    useEditorStore.setState({ openFile: null, recentFiles: [] });
  });
  afterEach(() => {
    clearMocks();
    vi.restoreAllMocks();
  });

  it("pulls a pending open on mount and loads the file", async () => {
    mockIPC((cmd) => {
      if (cmd === "take_pending_editor_open") {
        return { folder: "C:/p", relativePath: "todo.md" };
      }
      if (cmd === "read_project_file") return "# todo";
      if (cmd === "plugin:event|listen") return 0;
      return undefined;
    });

    render(<MarkdownEditorView />);

    await waitFor(() => {
      expect(useEditorStore.getState().openFile?.relativePath).toBe("todo.md");
    });
    expect(useEditorStore.getState().openFile?.content).toBe("# todo");
  });

  it("does nothing when there is no pending open", async () => {
    mockIPC((cmd) => {
      if (cmd === "take_pending_editor_open") return null;
      if (cmd === "plugin:event|listen") return 0;
      return undefined;
    });
    render(<MarkdownEditorView />);
    await new Promise((r) => setTimeout(r, 50));
    expect(useEditorStore.getState().openFile).toBeNull();
  });
});
