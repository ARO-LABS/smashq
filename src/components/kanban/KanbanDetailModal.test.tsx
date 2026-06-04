import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { KanbanDetailModal } from "./KanbanDetailModal";
import { invoke } from "@tauri-apps/api/core";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// Mock framer-motion to render synchronously
vi.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef<
      HTMLDivElement,
      React.PropsWithChildren<Record<string, unknown>>
    >(({ children, ...props }, ref) => {
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        ...rest
      } = props;
      return (
        <div ref={ref} {...rest}>
          {children as React.ReactNode}
        </div>
      );
    }),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// ── Helpers ───────────────────────────────────────────────────────────

const mockInvoke = vi.mocked(invoke);

function makeIssueDetail() {
  return {
    number: 42,
    title: "Fix login bug",
    body: "The login form does not validate email.",
    state: "OPEN",
    author: "alice",
    created_at: "2026-03-15T10:00:00Z",
    updated_at: "2026-03-16T09:00:00Z",
    closed_at: "",
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "priority", color: "ff0000" },
    ],
    assignees: ["bob"],
    milestone: null as string | null,
    url: "https://github.com/org/repo/issues/42",
    comments: [
      {
        id: "IC_kwDOtest001",
        author: "charlie",
        body: "I can reproduce this.",
        created_at: "2026-03-16T08:00:00Z",
      },
    ],
  };
}

function makeLinkedPRs() {
  return [
    {
      number: 50,
      title: "Fix login validation",
      state: "MERGED",
      url: "https://github.com/org/repo/pull/50",
      checks: [
        { name: "CI", status: "COMPLETED", conclusion: "SUCCESS" },
        { name: "Lint", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "Build", status: "IN_PROGRESS", conclusion: "" },
      ],
    },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("KanbanDetailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while fetching", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/Laden/)).toBeTruthy();
    expect(screen.getByText("#42")).toBeTruthy();
  });

  it("renders issue details after loading", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    // State badge
    expect(screen.getByText("Offen")).toBeTruthy();
    // Author in sidebar
    expect(screen.getByText("alice")).toBeTruthy();
    // Assignee in sidebar (rendered as plain username)
    expect(screen.getByText("bob")).toBeTruthy();
    // Labels
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("priority")).toBeTruthy();
    // Body (rendered via MarkdownBody → DOM text is findable)
    expect(
      screen.getByText("The login form does not validate email."),
    ).toBeTruthy();
    // Comments
    expect(screen.getByText("1 Kommentar")).toBeTruthy();
    expect(screen.getByText("charlie")).toBeTruthy();
    expect(screen.getByText("I can reproduce this.")).toBeTruthy();
  });

  it("renders closed state badge and closed_at date in sidebar", async () => {
    const detail = makeIssueDetail();
    detail.state = "CLOSED";
    detail.closed_at = "2026-03-20T14:00:00Z";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Geschlossen")).toBeTruthy();
    });

    // Sidebar shows "Geschlossen: {date}"
    expect(screen.getByText(/Geschlossen:/)).toBeTruthy();
  });

  it("renders linked PRs with CI checks", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve(makeLinkedPRs());
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Verknüpfte Pull Requests"),
      ).toBeTruthy();
    });

    // PR title
    expect(screen.getByText(/#50 Fix login validation/)).toBeTruthy();
    // PR state badge
    expect(screen.getByText("Merged")).toBeTruthy();
    // Check names
    expect(screen.getByText("CI")).toBeTruthy();
    expect(screen.getByText("Lint")).toBeTruthy();
    expect(screen.getByText("Build")).toBeTruthy();
  });

  it("shows error state with retry button on fetch failure", async () => {
    mockInvoke.mockRejectedValue(new Error("API error"));

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("API error")).toBeTruthy();
    });

    // Retry button should be present
    expect(screen.getByText("Erneut versuchen")).toBeTruthy();
  });

  it("retry button triggers a fresh load", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("API error"));

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Erneut versuchen")).toBeTruthy();
    });

    // On retry, second call succeeds
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    fireEvent.click(screen.getByText("Erneut versuchen"));

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });
  });

  it("does not render content when open is false", async () => {
    mockInvoke.mockResolvedValue(makeIssueDetail());

    const { container } = render(
      <KanbanDetailModal
        open={false}
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    // Modal is not rendered when closed
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Flush the mount effect's async loadDetail() so its setState settles in act()
    await act(async () => {});
  });

  it("renders plural 'Kommentare' for multiple comments", async () => {
    const detail = makeIssueDetail();
    detail.comments = [
      { id: "IC_a", author: "a", body: "First", created_at: "2026-03-16T08:00:00Z" },
      { id: "IC_b", author: "b", body: "Second", created_at: "2026-03-17T08:00:00Z" },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("2 Kommentare")).toBeTruthy();
    });
  });

  it("hides comments section when no comments", async () => {
    const detail = makeIssueDetail();
    detail.comments = [];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    // IssueComments is hidden when empty; but IssueCommentForm still renders.
    // Verify the comment count badge from IssueComments is absent.
    expect(screen.queryByText(/\d+ Kommentar/)).toBeNull();
  });

  it("renders all assignees when multiple are present", async () => {
    const detail = makeIssueDetail();
    detail.assignees = ["bob", "carol", "dave"];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("bob")).toBeTruthy();
    });

    expect(screen.getByText("carol")).toBeTruthy();
    expect(screen.getByText("dave")).toBeTruthy();
  });

  it("shows 'Niemand zugewiesen' when assignees is empty", async () => {
    const detail = makeIssueDetail();
    detail.assignees = [];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Niemand zugewiesen")).toBeTruthy();
    });
  });

  it("renders milestone when present", async () => {
    const detail = makeIssueDetail();
    detail.milestone = "v2.0";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("v2.0")).toBeTruthy();
    });
  });

  it("hides milestone section when milestone is null", async () => {
    const detail = makeIssueDetail();
    detail.milestone = null;

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    expect(screen.queryByText("Milestone")).toBeNull();
  });

  it("renders body markdown (bold text)", async () => {
    const detail = makeIssueDetail();
    detail.body = "This is **important** info.";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    const { container } = render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    // MarkdownBody should render **important** as <strong>
    const strong = container.querySelector("strong");
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("important");
  });

  it("shows empty body placeholder when body is empty", async () => {
    const detail = makeIssueDetail();
    detail.body = "";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(detail);
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Keine Beschreibung")).toBeTruthy();
    });
  });

  it("calls onIssueChanged and reloads after comment is posted", async () => {
    const onIssueChanged = vi.fn();

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      if (cmd === "post_issue_comment") return Promise.resolve(undefined);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
        onIssueChanged={onIssueChanged}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "Hello world" } });

    const submitButton = screen.getByText("Kommentar posten");
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(onIssueChanged).toHaveBeenCalledOnce();
    });
  });

  it("disables submit when comment body is empty", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Kommentar posten")).toBeTruthy();
    });

    const submitButton = screen.getByText("Kommentar posten");
    expect(submitButton).toHaveProperty("disabled", true);
  });

  // ── invoke argument wiring ───────────────────────────────────────────

  it("passes folder and issueNumber to get_issue_detail in folder mode", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/my/project"
        repository={null}
        issueNumber={7}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_issue_detail", {
      folder: "/my/project",
      repo: null,
      number: 7,
    });
  });

  it("passes repository to get_issue_detail in global-board mode", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder={null}
        repository="org/other"
        issueNumber={99}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_issue_detail", {
      folder: null,
      repo: "org/other",
      number: 99,
    });
  });

  // ── Header state badge ───────────────────────────────────────────────

  it("renders the issue title in the modal header", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      const heading = screen.getByRole("heading", { name: "Fix login bug" });
      expect(heading).toBeTruthy();
    });
  });

  it("does not render a state badge while still loading", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText("Offen")).toBeNull();
    expect(screen.queryByText("Geschlossen")).toBeNull();
  });

  // ── Refresh button ───────────────────────────────────────────────────

  it("reload button triggers another get_issue_detail call", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    const detailCallsBefore = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_issue_detail",
    ).length;

    fireEvent.click(screen.getByLabelText("Neu laden"));

    await waitFor(() => {
      const detailCallsAfter = mockInvoke.mock.calls.filter(
        (c) => c[0] === "get_issue_detail",
      ).length;
      expect(detailCallsAfter).toBe(detailCallsBefore + 1);
    });
  });

  it("reload button is disabled while loading", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Neu laden")).toHaveProperty("disabled", true);
  });

  it("opens the issue URL in browser via the header link", async () => {
    const { open: shellOpen } = await import("@tauri-apps/plugin-shell");
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Im Browser öffnen")).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Im Browser öffnen"));
    expect(shellOpen).toHaveBeenCalledWith(
      "https://github.com/org/repo/issues/42",
    );
  });

  // ── Linked PRs branches ──────────────────────────────────────────────

  it("does not render the linked-PR section when checks return empty", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    expect(screen.queryByText("Verknüpfte Pull Requests")).toBeNull();
  });

  it("falls back to empty linked PRs when get_issue_checks rejects", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.reject(new Error("checks down"));
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    // detail still renders despite the checks failure (caught inline)
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });
    expect(screen.queryByText("Verknüpfte Pull Requests")).toBeNull();
    expect(screen.queryByText("API error")).toBeNull();
  });

  it("renders an OPEN PR state badge", async () => {
    const prs = makeLinkedPRs();
    prs[0].state = "OPEN";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve(prs);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Open")).toBeTruthy();
    });
  });

  it("renders a CLOSED PR state badge", async () => {
    const prs = makeLinkedPRs();
    prs[0].state = "CLOSED";

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve(prs);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Closed")).toBeTruthy();
    });
  });

  it("renders a PR without check runs", async () => {
    const prs = makeLinkedPRs();
    prs[0].checks = [];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve(prs);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/#50 Fix login validation/)).toBeTruthy();
    });
    expect(screen.queryByText("CI")).toBeNull();
  });

  it("renders multiple linked PRs", async () => {
    const prs = [
      ...makeLinkedPRs(),
      {
        number: 51,
        title: "Second PR",
        state: "OPEN",
        url: "https://github.com/org/repo/pull/51",
        checks: [],
      },
    ];

    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve(prs);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/#50 Fix login validation/)).toBeTruthy();
    });
    expect(screen.getByText(/#51 Second PR/)).toBeTruthy();
  });

  // ── Sidebar wiring ───────────────────────────────────────────────────

  it("renders the created date in the sidebar", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Erstellt:/)).toBeTruthy();
    });
  });

  it("renders the updated date in the sidebar when it differs", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Geändert:/)).toBeTruthy();
    });
  });

  // ── onClose / reload identity ────────────────────────────────────────

  it("invokes onClose when the modal close button is clicked", async () => {
    const onClose = vi.fn();
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    const closeBtn = screen.getByLabelText("Schliessen");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it("reloads when issueNumber prop changes", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    const { rerender } = render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    rerender(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={43}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_issue_detail", {
        folder: "/test",
        repo: null,
        number: 43,
      });
    });
  });

  it("does not show the error retry button on a successful load", async () => {
    mockInvoke.mockImplementation(((cmd: string) => {
      if (cmd === "get_issue_detail") return Promise.resolve(makeIssueDetail());
      if (cmd === "get_issue_checks") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as typeof invoke);

    render(
      <KanbanDetailModal
        open
        folder="/test"
        repository={null}
        issueNumber={42}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeTruthy();
    });

    expect(screen.queryByText("Erneut versuchen")).toBeNull();
  });
});
