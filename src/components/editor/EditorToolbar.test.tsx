import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EditorToolbar } from "./EditorToolbar";
import { useEditorStore, type EditorFile } from "../../store/editorStore";
import { useUIStore } from "../../store/uiStore";

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
    relativePath: "docs/readme.md",
    content: "hello",
    savedContent: "hello",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("EditorToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it("shows 'Keine Datei geöffnet' when no file is open", () => {
    render(<EditorToolbar />);
    expect(screen.getByText("Keine Datei geöffnet")).toBeTruthy();
    // Close button should not exist without open file
    expect(screen.queryByLabelText("Datei schließen")).toBeNull();
  });

  it("renders file path and dirty indicator when file is dirty", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "modified", savedContent: "orig" }),
    });
    render(<EditorToolbar />);
    expect(screen.getByText("docs/readme.md")).toBeTruthy();
    // Dirty dot (role=img, aria-label)
    expect(screen.getByLabelText("Ungespeicherte Änderungen")).toBeTruthy();
  });

  it("calls saveFile action when Save button clicked (and is dirty)", () => {
    const saveFileSpy = vi.fn().mockResolvedValue(true);
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      saveFile: saveFileSpy,
    });
    render(<EditorToolbar />);
    const saveBtn = screen.getByLabelText("Datei speichern") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    expect(saveFileSpy).toHaveBeenCalledTimes(1);
  });

  it("disables Save button when file is clean", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "same", savedContent: "same" }),
    });
    render(<EditorToolbar />);
    const saveBtn = screen.getByLabelText("Datei speichern") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    // No dirty indicator either
    expect(screen.queryByLabelText("Ungespeicherte Änderungen")).toBeNull();
  });

  it("toggles preview and closes file via corresponding buttons", () => {
    const togglePreviewSpy = vi.fn();
    const closeFileSpy = vi.fn();
    useEditorStore.setState({
      openFile: makeFile(),
      togglePreview: togglePreviewSpy,
      closeFile: closeFileSpy,
    });
    render(<EditorToolbar />);

    // Preview currently visible → label is "Vorschau ausblenden"
    const previewBtn = screen.getByLabelText("Vorschau ausblenden");
    fireEvent.click(previewBtn);
    expect(togglePreviewSpy).toHaveBeenCalledTimes(1);

    const closeBtn = screen.getByLabelText("Datei schließen");
    fireEvent.click(closeBtn);
    expect(closeFileSpy).toHaveBeenCalledTimes(1);
  });

  it("calls openFileFromDialog when Öffnen button clicked", () => {
    const openSpy = vi.fn();
    useEditorStore.setState({ openFileFromDialog: openSpy });
    render(<EditorToolbar />);
    fireEvent.click(screen.getByLabelText("Markdown-Datei öffnen"));
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("shows 'Speichert...' label and disables Save while saving", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      isSaving: true,
    });
    render(<EditorToolbar />);
    expect(screen.getByText("Speichert...")).toBeTruthy();
    const saveBtn = screen.getByLabelText("Datei speichern") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it("shows 'Speichern' label when not saving", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "changed", savedContent: "orig" }),
      isSaving: false,
    });
    render(<EditorToolbar />);
    expect(screen.getByText("Speichern")).toBeTruthy();
    expect(screen.queryByText("Speichert...")).toBeNull();
  });

  it("does not trigger saveFile when Save is disabled (clean file)", () => {
    const saveFileSpy = vi.fn();
    useEditorStore.setState({
      openFile: makeFile({ content: "same", savedContent: "same" }),
      saveFile: saveFileSpy,
    });
    render(<EditorToolbar />);
    const saveBtn = screen.getByLabelText("Datei speichern") as HTMLButtonElement;
    fireEvent.click(saveBtn);
    expect(saveFileSpy).not.toHaveBeenCalled();
  });

  it("shows 'Vorschau einblenden' label when preview is hidden", () => {
    useEditorStore.setState({
      openFile: makeFile(),
      isPreviewVisible: false,
    });
    render(<EditorToolbar />);
    expect(screen.getByLabelText("Vorschau einblenden")).toBeTruthy();
    expect(screen.queryByLabelText("Vorschau ausblenden")).toBeNull();
  });

  it("preview toggle button is available even without an open file", () => {
    const togglePreviewSpy = vi.fn();
    useEditorStore.setState({ openFile: null, togglePreview: togglePreviewSpy });
    render(<EditorToolbar />);
    fireEvent.click(screen.getByLabelText("Vorschau ausblenden"));
    expect(togglePreviewSpy).toHaveBeenCalledTimes(1);
  });

  it("renders no dirty indicator for a freshly opened (clean) file", () => {
    useEditorStore.setState({
      openFile: makeFile({ content: "x", savedContent: "x" }),
    });
    render(<EditorToolbar />);
    expect(screen.getByText("docs/readme.md")).toBeTruthy();
    expect(screen.queryByLabelText("Ungespeicherte Änderungen")).toBeNull();
  });
});
