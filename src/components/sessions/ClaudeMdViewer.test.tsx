import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClaudeMdViewer } from "./ClaudeMdViewer";
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

describe("ClaudeMdViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset real uiStore — never mock Zustand
    useUIStore.setState({ toasts: [] });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ClaudeMdViewer folder="/test/project" />);
    expect(screen.getByText("Lade CLAUDE.md...")).toBeInTheDocument();
  });

  it("renders markdown content after loading", async () => {
    mockInvoke.mockResolvedValue("# My Project\n\nSome content here.");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("# My Project");
    expect(screen.getByText("CLAUDE.md")).toBeInTheDocument();
  });

  it("shows empty state when no CLAUDE.md found", async () => {
    mockInvoke.mockRejectedValue(new Error("file not found"));
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine CLAUDE.md in diesem Projekt gefunden"),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("/test/project")).toBeInTheDocument();
  });

  it("enters edit mode when clicking Bearbeiten button", async () => {
    mockInvoke.mockResolvedValue("# Content");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });
  });

  it("saves file and exits edit mode", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/test/project");
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    // Enter edit mode
    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    // Modify content
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "modified content" },
    });

    // Save
    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("write_project_file", {
        folder: "/test/project",
        relativePath: "CLAUDE.md",
        content: "modified content",
      });
    });
  });

  it("shows empty content as null (not found state)", async () => {
    mockInvoke.mockResolvedValue("");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine CLAUDE.md in diesem Projekt gefunden"),
      ).toBeInTheDocument();
    });
  });

  it("resolves project root before reading the file", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/main/root");
      if (cmd === "read_project_file") return Promise.resolve("# X");
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/worktree/branch" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    expect(mockInvoke).toHaveBeenCalledWith("resolve_project_root", {
      folder: "/worktree/branch",
    });
    // read uses the resolved root, not the raw worktree folder
    expect(mockInvoke).toHaveBeenCalledWith("read_project_file", {
      folder: "/main/root",
      relativePath: "CLAUDE.md",
    });
  });

  it("renders the refresh (Neu laden) button in preview mode", async () => {
    mockInvoke.mockResolvedValue("# Content");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByLabelText("Neu laden")).toBeInTheDocument();
    });
  });

  it("reloads content when clicking Neu laden", async () => {
    let readCount = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/test/project");
      if (cmd === "read_project_file") {
        readCount += 1;
        return Promise.resolve(`# Version ${readCount}`);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent(
        "# Version 1",
      );
    });

    fireEvent.click(screen.getByLabelText("Neu laden"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent(
        "# Version 2",
      );
    });
  });

  it("enters edit mode by clicking the preview area", async () => {
    mockInvoke.mockResolvedValue("# Click me");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    // preview wrapper is a role=button
    fireEvent.click(screen.getByTitle("Klicken zum Bearbeiten"));

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });
  });

  it("enters edit mode via Enter key on the preview area", async () => {
    mockInvoke.mockResolvedValue("# Keyboard");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.keyDown(screen.getByTitle("Klicken zum Bearbeiten"), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });
  });

  it("returns to preview via the Vorschau button without saving", async () => {
    mockInvoke.mockResolvedValue("# Original");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    // make an edit then cancel
    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "discarded edit" },
    });
    fireEvent.click(screen.getByLabelText("Zurück zur Vorschau"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });
    // original content preserved — write was never invoked
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "write_project_file",
      expect.anything(),
    );
    expect(screen.getByTestId("markdown-preview")).toHaveTextContent(
      "# Original",
    );
  });

  it("disables the save button when there are no changes", async () => {
    mockInvoke.mockResolvedValue("# Pristine");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    // not dirty → save disabled
    expect(screen.getByLabelText("Datei speichern")).toBeDisabled();
  });

  it("enables the save button once the content is edited", async () => {
    mockInvoke.mockResolvedValue("# Pristine");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "# Dirty now" },
    });

    expect(screen.getByLabelText("Datei speichern")).not.toBeDisabled();
  });

  it("shows the unsaved-changes dot when content is dirty", async () => {
    mockInvoke.mockResolvedValue("# Pristine");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Ungespeicherte Änderungen")).toBeNull();

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "# Changed" },
    });

    expect(
      screen.getByTitle("Ungespeicherte Änderungen"),
    ).toBeInTheDocument();
  });

  it("emits a success toast after a successful save", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/test/project");
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "new content" },
    });
    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("success");
      expect(toasts[0].title).toBe("CLAUDE.md gespeichert");
    });
  });

  it("emits an error toast and stays in edit mode when save fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/test/project");
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file")
        return Promise.reject(new Error("disk full"));
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "will fail" },
    });
    fireEvent.click(screen.getByLabelText("Datei speichern"));

    await waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].type).toBe("error");
      expect(toasts[0].title).toBe("Speichern fehlgeschlagen");
    });

    // failed save → editor still mounted
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
  });

  it("saves via Ctrl+S keyboard shortcut while editing", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "resolve_project_root") return Promise.resolve("/test/project");
      if (cmd === "read_project_file") return Promise.resolve("original");
      if (cmd === "write_project_file") return Promise.resolve(undefined);
      return Promise.reject(new Error("unknown"));
    });

    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("code-editor"), {
      target: { value: "saved via shortcut" },
    });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("write_project_file", {
        folder: "/test/project",
        relativePath: "CLAUDE.md",
        content: "saved via shortcut",
      });
    });
  });

  it("Ctrl+S does nothing when content is not dirty", async () => {
    mockInvoke.mockResolvedValue("# Pristine");
    render(<ClaudeMdViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    // no edit → save not invoked
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "write_project_file",
      expect.anything(),
    );
  });

  it("reloads content when the folder prop changes", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: { folder: string }) => {
      if (cmd === "resolve_project_root") return Promise.resolve(args!.folder);
      if (cmd === "read_project_file")
        return Promise.resolve(`# Project ${args!.folder}`);
      return Promise.reject(new Error("unknown"));
    });

    const { rerender } = render(<ClaudeMdViewer folder="/project/a" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent(
        "/project/a",
      );
    });

    rerender(<ClaudeMdViewer folder="/project/b" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toHaveTextContent(
        "/project/b",
      );
    });
  });

  it("exits edit mode automatically when the folder prop changes", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: { folder: string }) => {
      if (cmd === "resolve_project_root") return Promise.resolve(args!.folder);
      if (cmd === "read_project_file") return Promise.resolve("# Some content");
      return Promise.reject(new Error("unknown"));
    });

    const { rerender } = render(<ClaudeMdViewer folder="/project/a" />);

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Datei bearbeiten"));
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    });

    rerender(<ClaudeMdViewer folder="/project/b" />);

    // load() effect resets isEditing → back to preview
    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });
});
