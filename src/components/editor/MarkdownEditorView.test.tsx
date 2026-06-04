import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MarkdownEditorView } from "./MarkdownEditorView";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { useEditorStore, type EditorFile } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";

type CodeMirrorEditorProps = ComponentProps<typeof CodeMirrorEditor>;

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("../../utils/perfLogger", () => ({
  wrapInvoke: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

// CodeMirror mock — replace heavy editor with a simple textarea
vi.mock("./CodeMirrorEditor", () => ({
  CodeMirrorEditor: (p: CodeMirrorEditorProps) => (
    <textarea
      data-testid="cm-mock"
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
    />
  ),
}));

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

function makeFile(overrides: Partial<EditorFile> = {}): EditorFile {
  return {
    folder: "/project",
    relativePath: "notes.md",
    content: "# Hello",
    savedContent: "# Hello",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("MarkdownEditorView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("shows EmptyState with open-file CTA when no file is open", () => {
    render(<MarkdownEditorView />);
    // EmptyState renders CTA button with visible text "Markdown-Datei öffnen"
    // EmptyState CTA button has visible text "Markdown-Datei öffnen"; toolbar's "Öffnen" button also has that aria-label.
    // Find EmptyState specifically via the button that has textContent matching exactly.
    const buttons = screen.getAllByRole("button", { name: "Markdown-Datei öffnen" });
    const emptyStateCta = buttons.find((b) => b.textContent?.trim() === "Markdown-Datei öffnen");
    expect(emptyStateCta).toBeTruthy();
    // "Keine Datei geöffnet" appears twice (toolbar + EmptyState) when no file is open
    expect(screen.getAllByText("Keine Datei geöffnet").length).toBeGreaterThanOrEqual(1);
    // No editor textarea in empty state
    expect(screen.queryByTestId("cm-mock")).toBeNull();
  });

  it("renders editor + preview split when file is open and preview visible", () => {
    useEditorStore.setState({
      openFile: makeFile(),
      isPreviewVisible: true,
    });
    const { container } = render(<MarkdownEditorView />);
    expect(screen.getByTestId("cm-mock")).toBeTruthy();
    // Separator between editor/preview present
    expect(screen.getByRole("separator")).toBeTruthy();
    // Preview container rendered
    expect(container.querySelector(".md-preview")).toBeTruthy();
  });

  it("hides preview pane when isPreviewVisible is false", () => {
    useEditorStore.setState({
      openFile: makeFile(),
      isPreviewVisible: false,
    });
    const { container } = render(<MarkdownEditorView />);
    expect(screen.getByTestId("cm-mock")).toBeTruthy();
    // Separator gone
    expect(screen.queryByRole("separator")).toBeNull();
    // Preview container gone
    expect(container.querySelector(".md-preview")).toBeNull();
  });

  it("handles file close lifecycle: open file → closeFile → EmptyState reappears", () => {
    useEditorStore.setState({ openFile: makeFile() });
    const { rerender } = render(<MarkdownEditorView />);
    expect(screen.getByTestId("cm-mock")).toBeTruthy();

    // Invoke closeFile action from the real store
    act(() => {
      useEditorStore.getState().closeFile();
    });
    rerender(<MarkdownEditorView />);

    expect(screen.queryByTestId("cm-mock")).toBeNull();
    // EmptyState CTA button has visible text "Markdown-Datei öffnen"; toolbar's "Öffnen" button also has that aria-label.
    // Find EmptyState specifically via the button that has textContent matching exactly.
    const buttons = screen.getAllByRole("button", { name: "Markdown-Datei öffnen" });
    const emptyStateCta = buttons.find((b) => b.textContent?.trim() === "Markdown-Datei öffnen");
    expect(emptyStateCta).toBeTruthy();
  });

  it("triggers saveFile on global Ctrl+S when file is dirty", () => {
    const saveFileSpy = vi.fn().mockResolvedValue(true);
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      saveFile: saveFileSpy,
    });
    render(<MarkdownEditorView />);

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(saveFileSpy).toHaveBeenCalledTimes(1);

    // Clean file → Ctrl+S should not trigger save
    saveFileSpy.mockClear();
    act(() => {
      useEditorStore.setState({
        openFile: makeFile({ content: "same", savedContent: "same" }),
      });
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(saveFileSpy).not.toHaveBeenCalled();
  });

  it("triggers saveFile on Meta+S (macOS) when dirty", () => {
    const saveFileSpy = vi.fn().mockResolvedValue(true);
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      saveFile: saveFileSpy,
    });
    render(<MarkdownEditorView />);

    fireEvent.keyDown(window, { key: "s", metaKey: true });
    expect(saveFileSpy).toHaveBeenCalledTimes(1);
  });

  it("does not trigger saveFile for other key combos", () => {
    const saveFileSpy = vi.fn().mockResolvedValue(true);
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      saveFile: saveFileSpy,
    });
    render(<MarkdownEditorView />);

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    fireEvent.keyDown(window, { key: "s" }); // no modifier
    expect(saveFileSpy).not.toHaveBeenCalled();
  });

  it("renders the editor textarea with the open file's content", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "# Specific content" }),
    });
    render(<MarkdownEditorView />);
    const textarea = screen.getByTestId("cm-mock") as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Specific content");
  });

  it("editing the textarea updates openFile.content in the store", () => {
    useEditorStore.setState({ openFile: makeFile({ content: "old" }) });
    render(<MarkdownEditorView />);

    fireEvent.change(screen.getByTestId("cm-mock"), {
      target: { value: "new text" },
    });

    expect(useEditorStore.getState().openFile?.content).toBe("new text");
  });

  it("debounces preview content — updates after 300ms timer", () => {
    vi.useFakeTimers();
    try {
      useEditorStore.setState({
        openFile: makeFile({ content: "# Initial" }),
        isPreviewVisible: true,
      });
      const { container } = render(<MarkdownEditorView />);

      // previewContent starts empty until the first debounce timer fires
      expect(container.querySelector(".md-preview")?.textContent ?? "").not.toContain(
        "Initial",
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector(".md-preview")?.textContent).toContain(
        "Initial",
      );

      act(() => {
        useEditorStore.getState().updateContent("# Updated preview");
      });
      // Debounce not yet fired — preview still shows the previous text
      expect(container.querySelector(".md-preview")?.textContent).toContain(
        "Initial",
      );

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(container.querySelector(".md-preview")?.textContent).toContain(
        "Updated preview",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("separator responds to ArrowRight/ArrowLeft to resize the split", () => {
    useEditorStore.setState({
      openFile: makeFile(),
      isPreviewVisible: true,
    });
    const { container } = render(<MarkdownEditorView />);
    const separator = screen.getByRole("separator");

    const editorPane = container.querySelector(
      ".min-w-0.overflow-hidden",
    ) as HTMLElement;
    const initialWidth = editorPane.style.width;

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(editorPane.style.width).not.toBe(initialWidth);

    const widerWidth = editorPane.style.width;
    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(editorPane.style.width).not.toBe(widerWidth);
  });

  it("separator carries the German aria-label", () => {
    useEditorStore.setState({ openFile: makeFile(), isPreviewVisible: true });
    render(<MarkdownEditorView />);
    expect(
      screen.getByLabelText("Editor und Vorschau Trennlinie"),
    ).toBeInTheDocument();
  });

  it("editor pane spans full width when preview is hidden", () => {
    useEditorStore.setState({
      openFile: makeFile(),
      isPreviewVisible: false,
    });
    const { container } = render(<MarkdownEditorView />);
    const editorPane = container.querySelector(
      ".min-w-0.overflow-hidden",
    ) as HTMLElement;
    expect(editorPane.style.width).toBe("100%");
  });

  it("toggling preview visibility from the store shows/hides the pane", () => {
    useEditorStore.setState({ openFile: makeFile(), isPreviewVisible: false });
    const { container, rerender } = render(<MarkdownEditorView />);
    expect(container.querySelector(".md-preview")).toBeNull();

    act(() => {
      useEditorStore.getState().togglePreview();
    });
    rerender(<MarkdownEditorView />);
    expect(container.querySelector(".md-preview")).toBeTruthy();
  });
});
