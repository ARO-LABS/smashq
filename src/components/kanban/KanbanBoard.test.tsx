import { describe, it, expect, beforeEach, vi } from "vitest";
import { useEffect, useReducer } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { KanbanBoard, __resetKanbanCachesForTest } from "./KanbanBoard";
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

// Folder/project mode was removed — KanbanBoard is global-only and takes no
// props. This thin test seam lets the existing render(<Board folder=… />) call
// sites compile unchanged; the folder value is intentionally ignored.
function Board(_props: { folder?: string | null }) {
  return <KanbanBoard />;
}

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

const mockSetGlobalProject = vi.fn();
const mockGetGlobalProject = vi.fn();
const mockInvoke = vi.mocked(invoke);

/** Static store with (default) or without a globally-selected board. */
function setupStore(withProject = true) {
  const proj = withProject
    ? { projectNumber: 2, projectId: "PVT_abc123", title: "Smashq" }
    : undefined;
  vi.mocked(useProjectStore).mockReturnValue({
    globalProject: proj ?? null,
    setGlobalProject: mockSetGlobalProject,
    getGlobalProject: mockGetGlobalProject.mockReturnValue(proj),
  } as ReturnType<typeof useProjectStore>);
}

/** A distinct global board (used where a specific title is asserted). */
function setupGlobalStore() {
  const proj = { projectNumber: 5, projectId: "PVT_g1", title: "Global Board" };
  vi.mocked(useProjectStore).mockReturnValue({
    globalProject: proj,
    setGlobalProject: mockSetGlobalProject,
    getGlobalProject: mockGetGlobalProject.mockReturnValue(proj),
  } as ReturnType<typeof useProjectStore>);
}

/**
 * Stateful store fixture: `setGlobalProject` mutates a backing variable that
 * `getGlobalProject` reads, so the auto-select/picker flow runs end-to-end
 * (loadProjects → setGlobalProject → loadBoard), which `setupStore` cannot model.
 *
 * Crucially it also RE-RENDERS the consumer on every set, modelling Zustand's
 * re-render-on-set (the real `useProjectStore()` subscribes to all state). This
 * is what re-runs the load effect via its `selectedProject?.projectId` dep — the
 * production path that loads the board after an auto-select/picker selection,
 * rather than a (removed) inline `loadBoard` call.
 */
function setupStatefulStore(): { current: unknown } {
  const ref: { current: unknown } = { current: undefined };
  const listeners = new Set<() => void>();
  const setGlobal = vi.fn((proj: unknown) => {
    ref.current = proj;
    listeners.forEach((notify) => notify());
  });
  vi.mocked(useProjectStore).mockImplementation((() => {
    const [, forceRender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      listeners.add(forceRender);
      return () => {
        listeners.delete(forceRender);
      };
    }, []);
    return {
      globalProject: ref.current ?? null,
      setGlobalProject: setGlobal,
      getGlobalProject: () => ref.current,
    };
  }) as unknown as typeof useProjectStore);
  return ref;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("KanbanBoard — Projects v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Caches are process-global; clear so tests don't serve each other stale
    // boards (global cache key is `global:${projectId}`, shared across tests).
    __resetKanbanCachesForTest();
    // jsdom lacks Document.elementsFromPoint; stub it so the drag tests can
    // spyOn/override it to resolve the lane under the pointer.
    document.elementsFromPoint = vi.fn(() => []);
  });

  it("shows loading state initially", () => {
    // Project already in store → only get_project_board is called; keep it pending.
    setupStore();
    mockInvoke.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Board folder="/test/loading" />);

    expect(screen.getByText("Lade Kanban-Daten...")).toBeTruthy();
  });

  it("renders dynamic lanes from GitHub Projects v2 Status field", async () => {
    // setupStore(true) → getGlobalProject returns a project immediately,
    // so loadProjects is skipped and only get_project_board is called.
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<Board folder="/test/lanes" />);

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

    render(<Board folder="/test/items" />);

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

    render(<Board folder="/test/nostatus" />);

    await waitFor(() => {
      expect(screen.getByText("Kein Status")).toBeTruthy();
      expect(screen.getByText("No status issue")).toBeTruthy();
    });
  });

  it("data-lane-id uses Projects v2 option_id (not hardcoded slug)", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<Board folder="/test/laneids" />);

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

    render(<Board folder="/test/error" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });

    expect(screen.getByText("Erneut versuchen")).toBeTruthy();
  });

  it("shows the scope hint for a STRUCTURED scope error", async () => {
    setupStore();
    mockInvoke.mockRejectedValueOnce({
      code: "SERVICE_AUTH_FAILED",
      message: "required scopes: read:project",
      details: "scope",
      retryable: false,
    }); // get_project_board fails with a real scope error

    render(<Board folder="/test/scope" />);

    await waitFor(() => {
      expect(screen.getByText(/gh auth refresh/)).toBeTruthy();
    });
  });

  it("offers a copy button for the scope fix command and keeps the retry path", async () => {
    // `gh auth refresh` is interactive (OAuth device flow) — the app cannot
    // run it itself, so the error card must offer the command as a copyable
    // snippet PLUS the retry button for after the user ran it in a terminal.
    setupStore();
    mockInvoke.mockRejectedValueOnce({
      code: "SERVICE_AUTH_FAILED",
      message: "required scopes: read:project",
      details: "scope",
      retryable: false,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Board folder="/test/scope-copy" />);

    await waitFor(() => {
      expect(screen.getByText("GitHub-Scope fehlt")).toBeTruthy();
    });
    expect(screen.getByText("Erneut versuchen")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Befehl kopieren"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        "gh auth refresh -s read:project,project"
      );
    });
  });

  it("shows NO copy button for errors without a fix command", async () => {
    setupStore();
    mockInvoke.mockRejectedValueOnce(new Error("Network error"));

    render(<Board folder="/test/error-no-command" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });
    expect(screen.queryByLabelText("Befehl kopieren")).toBeNull();
  });

  it("does NOT show a scope hint for a not_found board (the original misclassification bug)", async () => {
    // Regression guard: a deleted board's NOT_FOUND message contains 'project'
    // but must never surface as the scope hint.
    setupGlobalStore();
    mockInvoke.mockRejectedValue({
      code: "SERVICE_REQUEST_FAILED",
      message: "Could not resolve to a ProjectV2 with the number 5.",
      details: "not_found",
      retryable: false,
    });

    render(<Board folder={null} />);

    await waitFor(() => {
      expect(screen.getByText("Board nicht gefunden")).toBeTruthy();
    });
    expect(screen.queryByText(/gh auth refresh/)).toBeNull();
  });

  it("surfaces the chooser on a not_found board WITHOUT silently jumping to another board", async () => {
    // Regression guard for the review's HIGH finding: board_not_found must NOT
    // clear the selection (which would re-trigger the effect and auto-select a
    // different board). The selection is preserved; the chooser is shown.
    setupGlobalStore();
    mockInvoke.mockRejectedValue({
      code: "SERVICE_REQUEST_FAILED",
      message: "Could not resolve to a ProjectV2",
      details: "not_found",
      retryable: false,
    });

    render(<Board folder={null} />);

    await waitFor(() => {
      expect(screen.getByText("Board nicht gefunden")).toBeTruthy();
    });
    // No silent clear of the global selection.
    expect(mockSetGlobalProject).not.toHaveBeenCalledWith(null);
  });

  it("shows project title in board header", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<Board folder="/test/header" />);

    await waitFor(() => {
      expect(screen.getByText("Smashq")).toBeTruthy();
    });
  });

  it("columns have no HTML5 DnD attributes", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<Board folder="/test/nodnd" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const columns = container.querySelectorAll("[data-lane-id]");
    columns.forEach((col) => {
      expect(col.getAttribute("draggable")).toBeNull();
    });
  });

  it("loads the globally-selected board by its project id", async () => {
    setupGlobalStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<Board />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
      expect(screen.getByText("Global Board")).toBeTruthy();
    });

    // Board is addressed by its global project id (no folder mode anymore).
    expect(mockInvoke).toHaveBeenCalledWith(
      "get_project_board",
      expect.objectContaining({ projectId: "PVT_g1" })
    );
  });

  // ── Header & item count ────────────────────────────────────────────────

  it("shows total issue count in header", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    render(<Board folder="/test/count" />);

    // makeBoard has 5 items in total.
    await waitFor(() => {
      expect(screen.getByText("(5 Issues)")).toBeTruthy();
    });
  });

  it("renders a per-lane count badge for each lane", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<Board folder="/test/lanecount" />);

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

    render(<Board folder="/test/emptylane" />);

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

    const { container } = render(<Board folder="/test/nullboard" />);

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
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
          { id: "PVT_other", number: 9, title: "Side Project", items_total: 3 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/picker-open" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    // Picker closed initially — "Side Project" not visible.
    expect(screen.queryByText("Side Project")).toBeNull();

    fireEvent.click(screen.getByText("Smashq"));

    await waitFor(() => {
      expect(screen.getByText("Side Project")).toBeTruthy();
    });
    // Item-count subtitle visible inside the dropdown.
    expect(screen.getByText("3 Items")).toBeTruthy();
  });

  it("selecting a project from the picker persists it globally and closes the picker", async () => {
    const ref = setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
          { id: "PVT_other", number: 9, title: "Side Project", items_total: 3 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/picker-select" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Smashq"));
    await waitFor(() => {
      expect(screen.getByText("Side Project")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Side Project"));

    // setGlobalProject updated the backing project reference.
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
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/picker-toggle" />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });

    const title = screen.getByText("Smashq");
    fireEvent.click(title);
    await waitFor(() => {
      expect(screen.getByText("5 Items")).toBeTruthy();
    });

    fireEvent.click(title);
    await waitFor(() => {
      expect(screen.queryByText("5 Items")).toBeNull();
    });
  });

  it("lists owners in the picker and switches the board list per owner", async () => {
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "list_project_owners") {
        return Promise.resolve([
          { login: "me", kind: "user" },
          { login: "ARO-LABS", kind: "org" },
        ]);
      }
      if (cmd === "list_user_projects") {
        const owner = (args as { owner?: string } | undefined)?.owner;
        return Promise.resolve(
          owner === "ARO-LABS"
            ? [{ id: "PVT_org", number: 1, title: "Org Board", items_total: 0 }]
            : [{ id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 }],
        );
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/owner-switch" />);

    await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());

    fireEvent.click(screen.getByText("Smashq")); // open picker → loads owners

    const ownerSelect = await screen.findByLabelText("Konto");
    expect(ownerSelect).toBeTruthy();

    // Switching to the org re-lists that owner's boards.
    fireEvent.change(ownerSelect, { target: { value: "ARO-LABS" } });
    await waitFor(() => expect(screen.getByText("Org Board")).toBeTruthy());
  });

  it("shows the classified error inline when an owner's board list fails (Issue #7 ARO-LABS)", async () => {
    // Switching to an org the token can't access must surface the real error
    // in the chooser, not the misleading "Keine Boards für dieses Konto.".
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "list_project_owners") {
        return Promise.resolve([
          { login: "me", kind: "user" },
          { login: "ARO-LABS", kind: "org" },
        ]);
      }
      if (cmd === "list_user_projects") {
        const owner = (args as { owner?: string } | undefined)?.owner;
        if (owner === "ARO-LABS") {
          return Promise.reject({
            code: "SERVICE_AUTH_FAILED",
            message: "forbidden",
            details: "forbidden",
            retryable: false,
          });
        }
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/owner-fail" />);
    await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());

    fireEvent.click(screen.getByText("Smashq")); // open picker → loads owners
    const ownerSelect = await screen.findByLabelText("Konto");

    fireEvent.change(ownerSelect, { target: { value: "ARO-LABS" } });

    // Classified error shown inline; NOT the empty-list message.
    await waitFor(() => expect(screen.getByText("Kein Zugriff")).toBeTruthy());
    expect(screen.queryByText("Keine Boards für dieses Konto.")).toBeNull();

    // Pins the error to INLINE-in-chooser, not the full-screen error card:
    // the already-loaded board is still mounted behind the open picker. If a
    // regression routed the silent-branch error into errorInfo, the full-screen
    // card would eject the board and "Backlog" would be gone — both assertions
    // above would still pass, so this anchor is what actually guards the fix.
    expect(screen.getByText("Backlog")).toBeTruthy();
  });

  it("drops a stale owner-switch resolve on a rapid A→B→A switch", async () => {
    setupStatefulStore();
    // The org list call hangs until we resolve it by hand — long after the user
    // has switched back to their own boards.
    let resolveOrg!: (v: unknown) => void;
    const orgPending = new Promise<unknown>((r) => {
      resolveOrg = r;
    });
    mockInvoke.mockImplementation((cmd: string, args?: unknown) => {
      if (cmd === "list_project_owners") {
        return Promise.resolve([
          { login: "me", kind: "user" },
          { login: "ARO-LABS", kind: "org" },
        ]);
      }
      if (cmd === "list_user_projects") {
        const owner = (args as { owner?: string } | undefined)?.owner;
        if (owner === "ARO-LABS") return orgPending;
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
        ]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/owner-race" />);
    await waitFor(() => expect(screen.getByText("Backlog")).toBeTruthy());

    fireEvent.click(screen.getByText("Smashq")); // open picker → loads owners
    const ownerSelect = await screen.findByLabelText("Konto");

    // A→B: switch to the org (its list call hangs), then B→A: back to own boards.
    // ("Smashq" renders twice once the picker is open — header + list entry.)
    fireEvent.change(ownerSelect, { target: { value: "ARO-LABS" } });
    fireEvent.change(ownerSelect, { target: { value: "me" } });
    await waitFor(() =>
      expect(screen.getAllByText("Smashq").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Org Board")).toBeNull();

    // The stale org resolve lands late. The abort guard (signal.aborted check
    // before setProjects) must drop it so it can't clobber the current list.
    resolveOrg([{ id: "PVT_org", number: 1, title: "Org Board", items_total: 0 }]);
    await orgPending;
    await waitFor(() =>
      expect(screen.getAllByText("Smashq").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("Org Board")).toBeNull();
  });

  it("shows onboarding guidance + owner chooser when an owner has no boards", async () => {
    setupStatefulStore();
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") return Promise.resolve([]);
      if (cmd === "list_project_owners") {
        return Promise.resolve([{ login: "me", kind: "user" }]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/empty-owner" />);

    await waitFor(() => {
      expect(screen.getByText(/Kein Board/i)).toBeTruthy();
    });
    // The owner chooser is offered so the user can switch to an org.
    expect(screen.getByLabelText("Konto")).toBeTruthy();
  });

  // ── Refresh ────────────────────────────────────────────────────────────

  it("clicking the refresh button re-invokes get_project_board with forceRefresh", async () => {
    setupStore();
    mockInvoke
      .mockResolvedValueOnce(makeBoard()) // initial get_project_board
      .mockResolvedValue(makeBoard()); // refresh

    render(<Board folder="/test/refresh" />);

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

    render(<Board folder="/test/retry" />);

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

    render(<Board folder="/test/cardclick" />);

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

    render(<Board folder="/test/nomodal" />);

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

    render(<Board folder="/test/listfail" />);

    await waitFor(() => {
      expect(screen.getByText("Fehler beim Laden des Boards")).toBeTruthy();
    });
  });

  it("retry after an auth failure with no board selected re-lists projects and loads the board", async () => {
    // Issue #7: after `gh auth login` the retry button did nothing because
    // loadBoard no-ops without a selected board. It must re-list projects,
    // auto-select the first, and load its board.
    setupStatefulStore();
    let listCalls = 0;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_user_projects") {
        listCalls++;
        if (listCalls === 1) {
          return Promise.reject({
            code: "SERVICE_AUTH_FAILED",
            message: "gh auth login required",
            details: "auth",
            retryable: false,
          });
        }
        return Promise.resolve([
          { id: "PVT_abc123", number: 2, title: "Smashq", items_total: 5 },
        ]);
      }
      if (cmd === "list_project_owners") {
        return Promise.resolve([{ login: "me", kind: "user" }]);
      }
      return Promise.resolve(makeBoard());
    });

    render(<Board folder="/test/retry-auth" />);

    // First list load fails → honest auth error card with a retry button.
    await waitFor(() => {
      expect(screen.getByText("Nicht bei GitHub angemeldet")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Erneut versuchen"));

    // Retry re-lists projects, auto-selects the first, and loads its board.
    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeTruthy();
    });
    expect(listCalls).toBeGreaterThanOrEqual(2);
  });

  it("renders cross-repo repository badge for global-board items", async () => {
    // Distinct project id so the module-level board cache (keyed by project id)
    // does not serve a stale board from an earlier test.
    vi.mocked(useProjectStore).mockReturnValue({
      globalProject: { projectNumber: 77, projectId: "PVT_g77", title: "Repo Board" },
      setGlobalProject: mockSetGlobalProject,
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

    render(<Board folder={null} />);

    await waitFor(() => {
      expect(screen.getByText("octocat/hello-world")).toBeTruthy();
    });
  });

  // ── Drag re-render perf (change-guard) ─────────────────────────────────

  /** Starts a drag on a card and registers the board's global pointer
   * listeners, then returns a helper to dispatch a window pointermove that
   * resolves to `laneId` via a stubbed elementsFromPoint. */
  function startDragOverLane(cardTitle: string) {
    const card = screen.getByText(cardTitle).closest("[class*='cursor-grab']");
    if (!card) throw new Error("card root not found");
    fireEvent.pointerDown(card, { button: 0, clientX: 0, clientY: 0 });
    // Move past the 5px drag threshold → triggers onDragStart on the card,
    // which registers the board's window pointermove/up listeners.
    fireEvent.pointerMove(card, { clientX: 50, clientY: 50 });
    return (laneId: string) => {
      const laneEl = document.querySelector(`[data-lane-id="${laneId}"]`);
      vi.spyOn(document, "elementsFromPoint").mockReturnValue(
        laneEl ? [laneEl as Element] : [],
      );
      const ev = new Event("pointermove");
      Object.assign(ev, { clientX: 10, clientY: 10 });
      window.dispatchEvent(ev);
    };
  }

  it("highlights the lane under the pointer during a drag (happy path)", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<Board folder="/test/drag-highlight" />);
    await waitFor(() => expect(screen.getByText("Ready issue")).toBeTruthy());

    const moveOver = startDragOverLane("Ready issue");
    moveOver("opt_inprog");

    await waitFor(() => {
      const lane = container.querySelector('[data-lane-id="opt_inprog"]');
      expect(lane?.className).toContain("ring-accent");
    });
  });

  it("keeps the board stable when the pointer stays over the same lane (edge: change-guard)", async () => {
    setupStore();
    mockInvoke.mockResolvedValueOnce(makeBoard()); // get_project_board

    const { container } = render(<Board folder="/test/drag-guard" />);
    await waitFor(() => expect(screen.getByText("Ready issue")).toBeTruthy());

    const moveOver = startDragOverLane("Ready issue");
    moveOver("opt_inprog"); // first move → state changes (one commit)

    await waitFor(() => {
      expect(
        container
          .querySelector('[data-lane-id="opt_inprog"]')
          ?.className.includes("ring-accent"),
      ).toBe(true);
    });

    // Keep resolving the SAME lane; the change-guard must make
    // setDragOverOptionId bail out so the board is not torn down / rebuilt.
    const lane = container.querySelector('[data-lane-id="opt_inprog"]');
    vi.spyOn(document, "elementsFromPoint").mockReturnValue(
      lane ? [lane as Element] : [],
    );
    const before = container.querySelectorAll('[data-lane-id]').length;
    for (let i = 0; i < 5; i++) {
      const ev = new Event("pointermove");
      Object.assign(ev, { clientX: 10 + i, clientY: 10 + i });
      window.dispatchEvent(ev);
    }
    const after = container.querySelectorAll('[data-lane-id]').length;

    // Lane set unchanged and the hovered lane still highlighted — proving
    // repeated same-lane moves did not remount the board.
    expect(after).toBe(before);
    expect(
      container
        .querySelector('[data-lane-id="opt_inprog"]')
        ?.className.includes("ring-accent"),
    ).toBe(true);
  });
});
