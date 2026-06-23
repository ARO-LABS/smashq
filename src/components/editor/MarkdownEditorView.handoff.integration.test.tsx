import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { MarkdownEditorView } from "./MarkdownEditorView";
import { useEditorStore } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";
import { emitTauriEvent } from "../../test/mockTauriIPC";

describe("MarkdownEditorView pending-open handoff", () => {
  beforeEach(() => {
    useEditorStore.setState({ openFile: null, recentFiles: [] });
    useUIStore.setState({ toasts: [] });
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

  it("loads the file on a warm open-md-file event when not dirty", async () => {
    mockIPC((cmd) => {
      if (cmd === "take_pending_editor_open") return null;
      if (cmd === "read_project_file") return "# warm";
      return undefined;
    });

    render(<MarkdownEditorView />);
    // Wait for the mount effect to register the open-md-file listener.
    await waitFor(() => {
      const bus = (
        globalThis as unknown as {
          __TAURI_TEST_EVENT_BUS__: { bus: Set<{ eventName: string }> };
        }
      ).__TAURI_TEST_EVENT_BUS__.bus;
      expect(
        Array.from(bus).some((l) => l.eventName === "open-md-file"),
      ).toBe(true);
    });

    await emitTauriEvent("open-md-file", {
      folder: "C:/p",
      relativePath: "warm.md",
    });

    await waitFor(() => {
      expect(useEditorStore.getState().openFile?.relativePath).toBe("warm.md");
    });
    expect(useEditorStore.getState().openFile?.content).toBe("# warm");
  });

  it("skips a warm open-md-file event when the editor is dirty", async () => {
    mockIPC((cmd) => {
      if (cmd === "take_pending_editor_open") return null;
      if (cmd === "read_project_file") return "# should-not-load";
      return undefined;
    });

    // Pre-seed a dirty file (content !== savedContent).
    useEditorStore.setState({
      openFile: {
        folder: "C:/p",
        relativePath: "dirty.md",
        content: "edited",
        savedContent: "original",
      },
    });

    render(<MarkdownEditorView />);
    await waitFor(() => {
      const bus = (
        globalThis as unknown as {
          __TAURI_TEST_EVENT_BUS__: { bus: Set<{ eventName: string }> };
        }
      ).__TAURI_TEST_EVENT_BUS__.bus;
      expect(
        Array.from(bus).some((l) => l.eventName === "open-md-file"),
      ).toBe(true);
    });

    await emitTauriEvent("open-md-file", {
      folder: "C:/p",
      relativePath: "warm.md",
    });
    await new Promise((r) => setTimeout(r, 50));

    // Dirty guard: the open is skipped, the dirty file stays put.
    expect(useEditorStore.getState().openFile?.relativePath).toBe("dirty.md");
    expect(useEditorStore.getState().openFile?.content).toBe("edited");
    // A skip toast was surfaced.
    expect(
      useUIStore.getState().toasts.some((t) => t.title === "Öffnen übersprungen"),
    ).toBe(true);
  });
});
