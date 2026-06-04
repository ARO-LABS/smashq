import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SkillsViewer } from "./SkillsViewer";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const skillContent1 = `---
name: implement
description: Issue to PR workflow
user-invokable: true
args:
  - name: issue
    description: GitHub issue number
    required: true
---

# Implement Skill

Steps to implement a feature.`;

const skillContent2 = `---
name: auto-lint
description: Automatic linting hook
user-invokable: false
---

# Auto Lint

Runs lint automatically.`;

describe("SkillsViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<SkillsViewer folder="/test/project" />);
    expect(screen.getByText("Lade Skills...")).toBeInTheDocument();
  });

  it("renders skill list via list_skill_dirs", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          {
            dir_name: "implement",
            content: skillContent1,
            has_reference_dir: true,
          },
          {
            dir_name: "auto-lint",
            content: skillContent2,
            has_reference_dir: false,
          },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    // "implement" appears in both list and detail (auto-selected first item)
    expect(screen.getAllByText("implement").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("auto-lint")).toBeInTheDocument();
  });

  it("shows empty state when no skills found", async () => {
    mockInvoke.mockRejectedValue(new Error("not found"));

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine Skills in diesem Projekt konfiguriert"),
      ).toBeInTheDocument();
    });
  });

  it("filters skills by invokable type", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    // Filter to "Aufrufbar" (user-invokable) — multiple "Aufrufbar" exist (filter btn + badge)
    const aufrufbarButtons = screen.getAllByText("Aufrufbar");
    fireEvent.click(aufrufbarButtons[0]); // filter button

    // Only invokable skill should show
    expect(screen.getAllByText("implement").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("auto-lint")).not.toBeInTheDocument();

    // Filter to "Automatisch"
    const autoButtons = screen.getAllByText("Automatisch");
    fireEvent.click(autoButtons[0]);

    // "implement" should no longer be in the list, only in the detail (if still selected)
    expect(screen.getByText("auto-lint")).toBeInTheDocument();
  });

  it("searches skills by name", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Suchen...");
    fireEvent.change(searchInput, { target: { value: "lint" } });

    // auto-lint is shown in the filtered list
    expect(screen.getAllByText("auto-lint").length).toBeGreaterThanOrEqual(1);
  });

  it("auto-selects first skill and shows detail", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: true },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      // Detail pane shows the skill description
      expect(screen.getAllByText("Issue to PR workflow").length).toBeGreaterThanOrEqual(1);
    });

    // Args section should show the parameter
    expect(screen.getByText("Parameter")).toBeInTheDocument();
    expect(screen.getByText("issue")).toBeInTheDocument();
  });

  it("falls back to legacy loading when list_skill_dirs fails", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.reject(new Error("command not found"));
      }
      if (cmd === "list_project_dir") {
        return Promise.resolve(["implement.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve(skillContent1);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });
  });

  it("falls back to legacy loading when list_skill_dirs returns empty array", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([]);
      }
      if (cmd === "list_project_dir") {
        return Promise.resolve(["auto-lint.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve(skillContent2);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });
    // single skill auto-selected -> name in card list + detail h2
    expect(screen.getAllByText("auto-lint").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when no skills directory exists at all", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.reject(new Error("not available"));
      }
      if (cmd === "list_project_dir") {
        return Promise.reject(new Error("dir not found"));
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine Skills in diesem Projekt konfiguriert"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(".claude/skills/")).toBeInTheDocument();
  });

  it("legacy loader uses filename as name when frontmatter has none", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.reject(new Error("not available"));
      }
      if (cmd === "list_project_dir") {
        return Promise.resolve(["nameless.md"]);
      }
      if (cmd === "read_project_file") {
        return Promise.resolve("---\nuser-invokable: true\n---\n\n# Body\n\nText.");
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });
    expect(screen.getAllByText("nameless").length).toBeGreaterThanOrEqual(1);
  });

  it("renders reference dir badge in detail when has_reference_dir is true", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: true },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Referenzen")).toBeInTheDocument();
    });
  });

  it("does not render reference badge when has_reference_dir is false", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });
    expect(screen.queryByText("Referenzen")).not.toBeInTheDocument();
  });

  it("marks required args with the *erforderlich indicator", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Parameter")).toBeInTheDocument();
    });
    expect(screen.getByText("*erforderlich")).toBeInTheDocument();
    expect(screen.getByText("GitHub issue number")).toBeInTheDocument();
  });

  it("does not render Parameter section when skill has no args", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });
    expect(screen.queryByText("Parameter")).not.toBeInTheDocument();
  });

  it("switches detail pane when a different skill card is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    // implement is auto-selected; click auto-lint
    fireEvent.click(screen.getByText("auto-lint"));

    await waitFor(() => {
      expect(
        screen.getAllByText("Automatic linting hook").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows no-match text when search yields nothing", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Suchen...");
    fireEvent.change(searchInput, { target: { value: "zzz-nomatch" } });

    expect(screen.getByText("Keine Skills gefunden")).toBeInTheDocument();
  });

  it("combines invokable filter and search query", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    // Filter "Automatisch" -> only auto-lint, then search "implement" -> empty
    fireEvent.click(screen.getAllByText("Automatisch")[0]);
    const searchInput = screen.getByPlaceholderText("Suchen...");
    fireEvent.change(searchInput, { target: { value: "implement" } });

    expect(screen.getByText("Keine Skills gefunden")).toBeInTheDocument();
  });

  it("returns to full list when filter switches back to Alle", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
          { dir_name: "auto-lint", content: skillContent2, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (2)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByText("Aufrufbar")[0]);
    expect(screen.queryByText("auto-lint")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Alle"));
    expect(screen.getByText("auto-lint")).toBeInTheDocument();
  });

  it("reloads skills when reload button is clicked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_skill_dirs") {
        return Promise.resolve([
          { dir_name: "implement", content: skillContent1, has_reference_dir: false },
        ]);
      }
      return Promise.reject(new Error("unknown"));
    });

    render(<SkillsViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Skills (1)")).toBeInTheDocument();
    });

    const callsBefore = mockInvoke.mock.calls.filter(
      (c) => c[0] === "list_skill_dirs",
    ).length;

    fireEvent.click(screen.getByTitle("Neu laden"));

    await waitFor(() => {
      const callsAfter = mockInvoke.mock.calls.filter(
        (c) => c[0] === "list_skill_dirs",
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("reloads skill list when the folder prop changes", async () => {
    mockInvoke.mockImplementation(
      (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "list_skill_dirs") {
          const folder = args?.folder as string;
          const name = folder === "/project-a" ? "skill-a" : "skill-b";
          return Promise.resolve([
            {
              dir_name: name,
              content: `---\nname: ${name}\ndescription: x\nuser-invokable: false\n---\n\n# Body`,
              has_reference_dir: false,
            },
          ]);
        }
        return Promise.reject(new Error("unknown"));
      },
    );

    const { rerender } = render(<SkillsViewer folder="/project-a" />);

    await waitFor(() => {
      expect(screen.getAllByText("skill-a").length).toBeGreaterThanOrEqual(1);
    });

    rerender(<SkillsViewer folder="/project-b" />);

    await waitFor(() => {
      expect(screen.getAllByText("skill-b").length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText("skill-a")).not.toBeInTheDocument();
  });
});
