import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { AgentsViewer } from "./AgentsViewer";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("AgentsViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders agent list when agents exist", async () => {
    mockInvoke.mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "list_project_dir") {
        return Promise.resolve(["architect.md", "test-engineer.md"]);
      }
      if (cmd === "read_project_file") {
        const path = args?.relativePath as string;
        if (path.includes("architect")) {
          return Promise.resolve(
            "---\nmodel: opus\nmax-turns: 20\n---\n\n# Architect Agent\n\nPlanning agent.",
          );
        }
        if (path.includes("test-engineer")) {
          return Promise.resolve(
            "---\nmodel: sonnet\n---\n\n# Test Engineer\n\nWrites tests.",
          );
        }
      }
      return Promise.reject(new Error("unknown command"));
    });

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (2)")).toBeInTheDocument();
    });

    // "architect" appears in both list and detail pane (auto-selected first item)
    expect(screen.getAllByText("architect").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("test-engineer")).toBeInTheDocument();
  });

  it("shows empty state when no agents directory exists", async () => {
    mockInvoke.mockRejectedValue(new Error("directory not found"));

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine Agents in diesem Projekt konfiguriert"),
      ).toBeInTheDocument();
    });
  });

  it("shows empty state when directory has no .md files", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_project_dir") {
        return Promise.resolve(["readme.txt", "config.json"]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine Agents in diesem Projekt konfiguriert"),
      ).toBeInTheDocument();
    });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<AgentsViewer folder="/test/project" />);
    expect(screen.getByText("Lade Agents...")).toBeInTheDocument();
  });

  it("auto-selects first agent and shows its detail with model badge", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          return Promise.resolve(["architect.md"]);
        }
        if (cmd === "read_project_file") {
          const path = args?.relativePath as string;
          if (path.includes("architect")) {
            return Promise.resolve(
              "---\nmodel: opus\nmax-turns: 20\ndescription: Planning agent\n---\n\n# Architect\n\nBody.",
            );
          }
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (1)")).toBeInTheDocument();
    });

    // Detail pane shows the description and model badge (opus appears in card + detail)
    expect(screen.getAllByText("Planning agent").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("opus").length).toBeGreaterThanOrEqual(1);
  });

  it("renders Max Turns metadata field in detail when present", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          return Promise.resolve(["architect.md"]);
        }
        if (cmd === "read_project_file") {
          void args;
          return Promise.resolve(
            "---\nmodel: opus\nmax-turns: 42\n---\n\n# Architect\n\nBody.",
          );
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Max Turns")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText(".claude/agents/architect.md")).toBeInTheDocument();
  });

  it("does not render Max Turns field when max-turns is absent", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_project_dir") {
        return Promise.resolve(["plain.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve("---\nmodel: sonnet\n---\n\n# Plain\n\nBody.");
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (1)")).toBeInTheDocument();
    });
    expect(screen.queryByText("Max Turns")).not.toBeInTheDocument();
  });

  it("renders allowed tools section in detail", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_project_dir") {
        return Promise.resolve(["tooled.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve(
          "---\nmodel: opus\nallowed-tools: Read, Glob, Bash\n---\n\n# Tooled\n\nBody.",
        );
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Erlaubte Tools")).toBeInTheDocument();
    });
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Glob")).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
  });

  it("switches detail pane when a different agent is clicked", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          return Promise.resolve(["architect.md", "test-engineer.md"]);
        }
        if (cmd === "read_project_file") {
          const path = args?.relativePath as string;
          if (path.includes("architect")) {
            return Promise.resolve(
              "---\nmodel: opus\ndescription: Planning agent\n---\n\n# Architect\n\nBody.",
            );
          }
          return Promise.resolve(
            "---\nmodel: sonnet\ndescription: Writes tests\n---\n\n# Test Engineer\n\nBody.",
          );
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (2)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("test-engineer"));

    await waitFor(() => {
      expect(
        screen.getByText(".claude/agents/test-engineer.md"),
      ).toBeInTheDocument();
    });
  });

  it("filters agents by search query and shows no-match text", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          return Promise.resolve(["architect.md", "test-engineer.md"]);
        }
        if (cmd === "read_project_file") {
          const path = args?.relativePath as string;
          if (path.includes("architect")) {
            return Promise.resolve(
              "---\nmodel: opus\ndescription: Planning agent\n---\n\n# A\n\nBody.",
            );
          }
          return Promise.resolve(
            "---\nmodel: sonnet\ndescription: Writes tests\n---\n\n# T\n\nBody.",
          );
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (2)")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Suchen...");
    // architect is auto-selected: appears in card list + detail h2 = 2 occurrences
    expect(screen.getAllByText("architect").length).toBe(2);

    fireEvent.change(searchInput, { target: { value: "engineer" } });
    // test-engineer card now visible, architect filtered from list -> only detail h2 left
    expect(screen.getByText("test-engineer")).toBeInTheDocument();
    expect(screen.getAllByText("architect").length).toBe(1);

    fireEvent.change(searchInput, { target: { value: "zzz-nomatch" } });
    expect(screen.getByText("Keine Agents gefunden")).toBeInTheDocument();
  });

  it("skips unreadable agent files but keeps readable ones", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          return Promise.resolve(["good.md", "broken.md"]);
        }
        if (cmd === "read_project_file") {
          const path = args?.relativePath as string;
          if (path.includes("broken")) {
            return Promise.reject(new Error("read error"));
          }
          return Promise.resolve("---\nmodel: opus\n---\n\n# Good\n\nBody.");
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (1)")).toBeInTheDocument();
    });
    // "good" appears in card list + detail h2 (single agent auto-selected)
    expect(screen.getAllByText("good").length).toBe(2);
  });

  it("reloads agents when reload button is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_project_dir") {
        return Promise.resolve(["architect.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve("---\nmodel: opus\n---\n\n# Architect\n\nBody.");
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<AgentsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Agents (1)")).toBeInTheDocument();
    });

    const listCallsBefore = mockInvoke.mock.calls.filter(
      (c) => c[0] === "list_project_dir",
    ).length;

    fireEvent.click(screen.getByTitle("Neu laden"));

    await waitFor(() => {
      const listCallsAfter = mockInvoke.mock.calls.filter(
        (c) => c[0] === "list_project_dir",
      ).length;
      expect(listCallsAfter).toBeGreaterThan(listCallsBefore);
    });
  });

  it("reloads agent list when the folder prop changes", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_project_dir") {
          const folder = args?.folder as string;
          return Promise.resolve(
            folder === "/project-a" ? ["a-agent.md"] : ["b-agent.md"],
          );
        }
        if (cmd === "read_project_file") {
          return Promise.resolve("---\nmodel: opus\n---\n\n# X\n\nBody.");
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    const { rerender } = render(<AgentsViewer folder="/project-a" />);

    await waitFor(() => {
      expect(screen.getAllByText("a-agent").length).toBeGreaterThanOrEqual(1);
    });

    rerender(<AgentsViewer folder="/project-b" />);

    await waitFor(() => {
      expect(screen.getAllByText("b-agent").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("a-agent")).not.toBeInTheDocument();
  });
});
