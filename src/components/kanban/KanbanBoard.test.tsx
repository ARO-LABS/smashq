import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { KanbanBoard } from "./KanbanBoard";
import { invoke } from "@tauri-apps/api/core";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({
      children,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } =
        props;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

// Mock projectStore — gives controlled project selection without localStorage
vi.mock("../../store/projectStore", () => ({
  useProjectStore: vi.fn(),
}));

// Mock KanbanDetailModal — the real modal fires its own Tauri calls and
// renders child viewers; for KanbanBoard tests we only care that it mounts
// with the right issue number.
vi.mock("./KanbanDetailModal", () => ({
  KanbanDetailModal: ({
    issueNumber,
    repository,
  }: {
    issueNumber: number;
    repository: string | null;
  }) => (
    <div data-testid="detail-modal" data-issue={issueNumber} data-repo={repository ?? ""}>
      Detail Modal
    </div>
  ),
}));

import { useProjectStore } from "../../store/projectStore";

// ── Test fixtures ─────────────────────────────────────────────────────

function makeBoard() {
  return {
    project_id: "PVT_abc123",
    status_field_id: "PVTSSF_field1",
    lanes: [
      { option_id: "opt_backlog", name: "Backlog", order: 0 },
      { option_id: "opt_ready", name: "Ready", order: 1 },
      { option_id: "opt_inprog", name: "In progress", order: 2 },
      { option_id: "opt_review", name: "In review", order: 3 },
      { option_id: "opt_done", name: "Done", order: 4 },
    ],
    items: [
      {
        item_id: "PVTI_1",
        issue_number: 1,
        title: "Backlog issue",
        assignee: "",
        labels: [],
        url: "https://github.com/org/repo/issues/1",
        state: "OPEN",
        current_lane_option_id: "opt_backlog",
      },
      {
        item_id: "PVTI_2",
        issue_number: 2,
        title: "Ready issue",
        assignee: "bob",
        labels: [{ name: "feature", color: "0075ca" }],
        url: "https://github.com/org/repo/issues/2",
        state: "OPEN",
        current_lane_option_id: "opt_ready",
      },
      {
        item_id: "PVTI_3",
        issue_number: 3,
        title: "In review issue",
        assignee: "alice",
        labels: [],
        url: "https://github.com/org/repo/issues/3",
        state: "OPEN",
        current_lane_option_id: "opt_review",
      },
      {
        item_id: "PVTI_4",
        issue_number: 4,
        title: "Done issue",
        assignee: "",
        labels: [],
        url: "https://github.com/org/repo/issues/4",
        state: "CLOSED",
        current_lane_option_id: "opt_done",
      },
      {
        item_id: "PVTI_5",
        issue_number: 5,
        title: "No status issue",
        assignee: "",
        labels: [],
        url: "https://github.com/org/repo/issues/5",
        state: "OPEN",
        current_lane_option_id: null,
      },
    ],
  };
}

// ── Store setup ───────────────────────────────────────────────────────

const mockSetFolderProject = vi.fn();
const mockSetGlobalProject = vi.fn();
const mockGetProjectForFolder = vi.fn();
const mockGetGlobalProject = vi.fn();
const mockInvoke = vi.mocked(invoke);

function setupStore(withProject = true) {
  vi.mocked(useProjectStore).mockReturnValue({
    projectByFolder: {},
    globalProject: null,
    setFolderProject: mockSetFolderProject,
    setGlobalProject: mockSetGlobalProject,
    getProjectForFolder: withProject
      ? mockGetProjectForFolder.mockReturnValue({
          projectNumber: 2,
          projectId: "PVT_abc123",
          title: "Agentic Dashboard",
        })
      : mockGetProjectForFolder.mockReturnValue(undefined),
    getGlobalProject: mockGetGlobalProject.mockReturnValue(undefined),
  } as ReturnType<typeof useProjectStore>);
}

function setupGlobalStore() {
  vi.mocked(useProjectStore).mockReturnValue({
    projectByFolder: {},
    globalProject: { projectNumber: 5, projectId: "PVT_g1", title: "Global Board" },
    setFolderProject: mockSetFolderProject,
    setGlobalProject: mockSetGlobalProject,
    getProjectForFolder: mockGetProjectForFolder.mockReturnValue(undefined),
    getGlobalProject: mockGetGlobalProject.mockReturnValue({
      projectNumber: 5,
      projectId: "PVT_g1",
      title: "Global Board",
    }),
  } as ReturnType<typeof useProjectStore>);
}

/**
 * Stateful store fixture: `setFolderProject` actually mutates a backing
 * variable that `getProjectForFolder` reads. This lets the picker /
 * auto-select flow run end-to-end (loadProjects → setFolderProject →
 * loadBoard), which the static `setupStore` cannot model.
 */
function setupStatefulStore(): { current: unknown } {
  const ref: { current: unknown } = { current: undefined };
  const setFolder = vi.fn((_folder: string, proj: unknown) => {
    ref.current = proj;
  });
  vi.mocked(useProjectStore).mockReturnValue({
    projectByFolder: {},
    globalProject: null,
    setFolderProject: setFolder,
    setGlobalProject: mockSetGlobalProject,
    getProjectForFolder: () => ref.current,
    getGlobalProject: () => undefined,
  } as unknown as ReturnType<typeof useProjectStore>);
  return ref;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("KanbanBoard — Projects v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows loading state initially", () => {
    // Project already in store → only get_project_board is called; keep it pending.
    setupStore();
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<KanbanBoard folder="/test/loading" />);

    expect(screen.getByText("Lade Kanban-Daten...")).toBeTruthy();
  });

  it("renders dynamic lanes from GitHub Projects v2 Status field", async () => {
    // setupStore(true) → getProjectForFolder returns a project immediately,
    // so loadProjects is skipped and only get_project_board is called.
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/lanes" />);

    await waitFor(() => {
      // Lane names come from GitHub, not hardcoded strings
      expect(screen.getByText("Backlog")).toBeTruthy();
      expect(screen.getByText("Ready")).toBeTruthy();
      expect(screen.getByText("In progress")).toBeTruthy();
      expect(screen.getByText("In review")).toBeTruthy();
      expect(screen.getByText("Done")).toBeTruthy();
    });
  });

  it("renders items in their correct GitHub Projects lane", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/items" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog issue")).toBeTruthy();
      expect(screen.getByText("Ready issue")).toBeTruthy();
      expect(screen.getByText("In review issue")).toBeTruthy();
      expect(screen.getByText("Done issue")).toBeTruthy();
    });
  });

  it("renders 'Kein Status' column for items without a status set", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/nostatus" />);

    await waitFor(() => {
      expect(screen.getByText("Kein Status")).toBeTruthy();
      expect(screen.getByText("No status issue")).toBeTruthy();
    });
  });

  it("data-lane-id uses Projects v2 option_id (not hardcoded slug)", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<KanbanBoard folder="/test/laneids" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const laneIds = Array.from(
      container.querySelectorAll("[data-lane-id]")
    ).map((el) => el.getAttribute("data-lane-id"));

    expect(laneIds).toContain("opt_backlog");
    expect(laneIds).toContain("opt_done");
    expect(laneIds).not.toContain("backlog");  // old hardcoded id must be gone
    expect(laneIds).not.toContain("in-progress");
  });

  it("shows error state on board load failure", async () => {
    setupStore();
    mockInvoke.mockRejectedValueOnce(new Error("Network error")); // get_project_board fails

    render(<KanbanBoard folder="/test/error" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });

    expect(screen.getByText("Erneut versuchen")).toBeTruthy();
  });

  it("shows scope hint when error mentions 'project'", async () => {
    setupStore();
    mockInvoke.mockRejectedValueOnce(new Error("Missing project scope")); // get_project_board fails

    render(<KanbanBoard folder="/test/scope" />);

    await waitFor(() => {
      expect(
        screen.getByText(/gh auth refresh -s project/)
      ).toBeTruthy();
    });
  });

  it("shows project title in board header", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/header" />);

    await waitFor(() => {
      expect(screen.getByText("Agentic Dashboard")).toBeTruthy();
    });
  });

  it("columns have no HTML5 DnD attributes", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<KanbanBoard folder="/test/nodnd" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const columns = container.querySelectorAll("[data-lane-id]");
    columns.forEach((col) => {
      expect(col.getAttribute("draggable")).toBeNull();
    });
  });

  it("global mode (folder=null) loads board and passes folder:null to backend", async () => {
    setupGlobalStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder={null} />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
      expect(screen.getByText("Global Board")).toBeTruthy();
    });

    // Board was fetched with folder: null — backend uses temp_dir fallback.
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_project_board",
      expect.objectContaining({ folder: null })
    );
  });

  // ── Header & item count ────────────────────────────────────────────────

  it("shows total issue count in header", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/count" />);

    // makeBoard has 5 items in total.
    await waitFor(() => {
      expect(screen.getByText("(5 Issues)")).toBeTruthy();
    });
  });

  it("renders a per-lane count badge for each lane", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<KanbanBoard folder="/test/lanecount" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    // Each lane column header has a count badge — 5 lanes + Kein-Status column.
    const backlogColumn = container.querySelector('[data-lane-id="opt_backlog"]');
    expect(backlogColumn?.textContent).toContain("1"); // exactly one backlog item
  });

  it("renders empty placeholder for lanes without items", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/emptylane" />);

    await waitFor(() => {
      expect(screen.getByText("In progress")).toBeTruthy();
    });

    // "In progress" lane has no items in makeBoard → placeholder text shown.
    expect(screen.getAllByText("Keine Issues").length).toBeGreaterThan(0);
  });

  it("returns null (renders nothing) when board resolves to falsy without error", async () => {
    setupStore();
    // Backend returns null board — component renders nothing after loading.
    mockInvoke.mockResolvedValueOnce(null);

    const { container } = render(<KanbanBoard folder="/test/nullboard" />);

    await waitFor(() => {
      expect(screen.queryByText("Lade Kanban-Daten...")).toBeNull();
    });
    expect(container.querySelector("[data-lane-id]")).toBeNull();
  });

  // ── Project picker ─────────────────────────────────────────────────────

  it("opens project picker dropdown on title click", async () => {
    // Stateful store + no project yet → loadProjects runs and populates the picker.
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Agentic Dashboard", items_total: 5 },
          { id: "PVT_other", number: 9, title: "Side Project", items_total: 3 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<KanbanBoard folder="/test/picker-open" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    // Picker closed initially — "Side Project" not visible.
    expect(screen.queryByText("Side Project")).toBeNull();

    fireEvent.click(screen.getByText("Agentic Dashboard"));

    await waitFor(() => {
      expect(screen.getByText("Side Project")).toBeTruthy();
    });
    // Item-count subtitle visible inside the dropdown.
    expect(screen.getByText("3 Items")).toBeTruthy();
  });

  it("selecting a project from the picker calls setFolderProject and closes the picker", async () => {
    const ref = setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Agentic Dashboard", items_total: 5 },
          { id: "PVT_other", number: 9, title: "Side Project", items_total: 3 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<KanbanBoard folder="/test/picker-select" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Agentic Dashboard"));
    await waitFor(() => {
      expect(screen.getByText("Side Project")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Side Project"));

    // setFolderProject updated the backing project reference.
    expect(ref.current).toMatchObject({ projectNumber: 9, projectId: "PVT_other" });
    // Dropdown closes after selection.
    await waitFor(() => {
      expect(screen.queryByText("3 Items")).toBeNull();
    });
  });

  it("project picker toggles closed on a second title click", async () => {
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Agentic Dashboard", items_total: 5 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<KanbanBoard folder="/test/picker-toggle" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const title = screen.getByText("Agentic Dashboard");
    fireEvent.click(title);
    await waitFor(() => {
      expect(screen.getByText("5 Items")).toBeTruthy();
    });

    fireEvent.click(title);
    await waitFor(() => {
      expect(screen.queryByText("5 Items")).toBeNull();
    });
  });

  // ── Refresh ────────────────────────────────────────────────────────────

  it("clicking the refresh button re-invokes get_project_board with forceRefresh", async () => {
    setupStore();
    mockInvoke
      .mockResolvedValueOnce(makeBoard()) // initial get_project_board
      .mockResolvedValue(makeBoard()); // refresh

    render(<KanbanBoard folder="/test/refresh" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const callsBefore = mockInvoke.mock.calls.filter(
      (c) => c[0] === "get_project_board"
    ).length;

    fireEvent.click(screen.getByTitle("Neu laden"));

    await waitFor(() => {
      const callsAfter = mockInvoke.mock.calls.filter(
        (c) => c[0] === "get_project_board"
      ).length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("retry button on error state re-attempts the board load", async () => {
    setupStore();
    mockInvoke
      .mockRejectedValueOnce(new Error("Network error")) // first load fails
      .mockResolvedValueOnce(makeBoard()); // retry succeeds

    render(<KanbanBoard folder="/test/retry" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Erneut versuchen"));

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });
    expect(screen.queryByText("Fehler beim Laden des Boards")).toBeNull();
  });

  // ── Card interaction / detail modal ───────────────────────────────────

  it("clicking a card opens the detail modal for that issue", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/cardclick" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog issue")).toBeTruthy();
    });

    // Modal not mounted before click.
    expect(screen.queryByTestId("detail-modal")).toBeNull();

    fireEvent.click(screen.getByText("Backlog issue"));

    // KanbanDetailModal mounts with the clicked issue's number.
    const modal = await screen.findByTestId("detail-modal");
    expect(modal.getAttribute("data-issue")).toBe("1");
  });

  it("does not mount the detail modal until a card is clicked", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<KanbanBoard folder="/test/nomodal" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog issue")).toBeTruthy();
    });
    expect(screen.queryByTestId("detail-modal")).toBeNull();
  });

  // ── Project list failure ──────────────────────────────────────────────

  it("shows error state when project list load fails (no project in store)", async () => {
    // Stateful store starts with no project → loadProjects runs and fails.
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        return Promise.reject(new Error("list failed"));
      }
      return Promise.resolve(makeBoard());
    });

    render(<KanbanBoard folder="/test/listfail" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });
  });

  it("renders cross-repo repository badge for global-board items", async () => {
    // Distinct project number so the module-level board cache (keyed by
    // project number) does not serve a stale board from an earlier test.
    vi.mocked(useProjectStore).mockReturnValue({
      projectByFolder: {},
      globalProject: { projectNumber: 77, projectId: "PVT_g77", title: "Repo Board" },
      setFolderProject: mockSetFolderProject,
      setGlobalProject: mockSetGlobalProject,
      getProjectForFolder: () => undefined,
      getGlobalProject: () => ({
        projectNumber: 77,
        projectId: "PVT_g77",
        title: "Repo Board",
      }),
    } as unknown as ReturnType<typeof useProjectStore>);

    const board = makeBoard();
    // The raw board item carries an optional `repository` field (read by the
    // component as `item.repository ?? null`); the makeBoard literal type is
    // narrower, so cast to attach it for this cross-repo case.
    board.items[0] = {
      ...board.items[0],
      repository: "octocat/hello-world",
    } as unknown as (typeof board.items)[0];
    mockInvoke.mockResolvedValueOnce(board); // get_project_board

    render(<KanbanBoard folder={null} />);

    await waitFor(() => {
      expect(screen.getByText("octocat/hello-world")).toBeTruthy();
    });
  });
});
