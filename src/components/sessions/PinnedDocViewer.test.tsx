import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { PinnedDocViewer } from "./PinnedDocViewer";
import { useSettingsStore, normalizeProjectKey } from "../../store/settingsStore";
import { useUIStore } from "../../store/uiStore";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("../editor/MarkdownPreview", () => ({
  MarkdownPreview: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}));

vi.mock("../editor/CodeMirrorEditor", () => ({
  CodeMirrorEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <textarea
      data-testid="code-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const TEST_FOLDER = "/test/project";
const TEST_PIN_ID = "pin-123";

function setupPinnedDoc(relativePath: string, label?: string) {
  const key = normalizeProjectKey(TEST_FOLDER);
  useSettingsStore.setState({
    pinnedDocs: {
      [key]: [
        {
          id: TEST_PIN_ID,
          relativePath,
          label: label ?? relativePath,
          addedAt: Date.now(),
        },
      ],
    },
  });
}

describe("PinnedDocViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ pinnedDocs: {} });
    useUIStore.setState({ toasts: [], hasDirtyEditor: false });
  });

  it("shows 'Pin nicht gefunden' when pin does not exist", () => {
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId="nonexistent" />);
    expect(screen.getByText("Pin nicht gefunden")).toBeInTheDocument();
  });

  it("shows loading state while fetching", () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);
    expect(screen.getByText(/Lade docs\/guide.md/)).toBeInTheDocument();
  });

  it("renders document content after loading", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("# Guide\n\nHelpful content.");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("# Guide");
  });

  it("shows error state when loading fails", async () => {
    setupPinnedDoc("docs/missing.md", "Missing Doc");
    mockInvoke.mockRejectedValue(new Error("file not found"));
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden")).toBeInTheDocument();
    });

    expect(screen.getByText("Erneut versuchen")).toBeInTheDocument();
  });

  it("shows empty file state when content is empty", async () => {
    setupPinnedDoc("docs/empty.md", "Empty Doc");
    mockInvoke.mockResolvedValue("");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText("Datei existiert nicht oder ist leer"),
      ).toBeInTheDocument();
    });
  });

  it("enters edit mode and can save", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_project_file") return Promise.resolve("original content");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });

    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    // Enter edit mode
    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    // Modify and save
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "updated content" },
    });

    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("write_project_file", {
        folder: TEST_FOLDER,
        relativePath: "docs/guide.md",
        content: "updated content",
      });
    });
  });

  it("calls read_project_file with folder and relativePath", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("content");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("read_project_file", {
        folder: TEST_FOLDER,
        relativePath: "docs/guide.md",
      });
    });
  });

  it("renders pin label in header when label differs from relativePath", async () => {
    setupPinnedDoc("docs/guide.md", "Mein Guide");
    mockInvoke.mockResolvedValue("content");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Mein Guide")).toBeInTheDocument();
    });
    // relativePath also shown as secondary mono text
    expect(screen.getAllByText("docs/guide.md").length).toBeGreaterThanOrEqual(1);
  });

  it("reload button refetches the file", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("v1");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent("v1");
    });

    mockInvoke.mockResolvedValue("v2");
    fireEvent.click(screen.getByLabelText("Neu laden"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent("v2");
    });
  });

  it("retry button reloads after an error", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden")).toBeInTheDocument();
    });

    mockInvoke.mockResolvedValue("recovered");
    fireEvent.click(screen.getByText("Erneut versuchen"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent("recovered");
    });
  });

  it("clicking the preview area enters edit mode", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("body");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle("Klicken zum Bearbeiten"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });
  });

  it("empty-file 'Bearbeiten' button opens the editor", async () => {
    setupPinnedDoc("docs/empty.md", "Empty Doc");
    mockInvoke.mockResolvedValue("");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(
        screen.getByText("Datei existiert nicht oder ist leer"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Bearbeiten (leere Datei)"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });
  });

  it("save button is disabled until content is dirty", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("original");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Datei speichern")).toBeDisabled();

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "changed" },
    });
    expect(screen.getByLabelText("Datei speichern")).toBeEnabled();
  });

  it("shows dirty indicator dot when edits are unsaved", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("original");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "dirty now" },
    });

    expect(
      screen.getByTitle("Ungespeicherte Änderungen"),
    ).toBeInTheDocument();
  });

  it("propagates dirty state to uiStore.hasDirtyEditor", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("original");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "edited" },
    });

    expect(useUIStore.getState().hasDirtyEditor).toBe(true);
  });

  it("'Vorschau' button discards edits and returns to preview", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockResolvedValue("original");
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "edited" },
    });
    fireEvent.click(screen.getByLabelText("Zurück zur Vorschau"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent("original");
    });
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("adds a success toast after a successful save", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "new body" },
    });
    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts.some((t) => t.type === "success")).toBe(true);
    });
  });

  it("adds an error toast when save fails", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file")
        return Promise.reject(new Error("disk full"));
      return Promise.reject(new Error("unknown"));
    });
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "new body" },
    });
    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(
        toasts.some(
          (t) => t.type === "error" && t.title === "Speichern fehlgeschlagen",
        ),
      ).toBe(true);
    });
  });

  it("Ctrl+S in edit mode triggers a save when dirty", async () => {
    setupPinnedDoc("docs/guide.md", "Guide");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });
    render(<PinnedDocViewer folder={TEST_FOLDER} pinId={TEST_PIN_ID} />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "ctrl-s body" },
    });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("write_project_file", {
        folder: TEST_FOLDER,
        relativePath: "docs/guide.md",
        content: "ctrl-s body",
      });
    });
  });
});
