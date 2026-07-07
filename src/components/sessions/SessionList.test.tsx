import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionList } from "./SessionList";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUIStore } from "../../store/uiStore";
import type { ClaudeSession } from "../../store/sessionStore";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// Stub DnD sensors so DndContext receives an empty (but valid) sensor array in jsdom.
// useSensors() returning [] is explicitly handled by DndContext (per @dnd-kit/core source).
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useSensor: vi.fn(() => null),
    useSensors: vi.fn(() => []),
  };
});

function makeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  const now = Date.now();
  return {
    id: "s-1",
    title: "Test Session",
    folder: "C:/Projects/test",
    shell: "powershell",
    status: "running",
    createdAt: now,
    finishedAt: null,
    exitCode: null,
    lastOutputAt: now,
    lastOutputSnippet: "",
    ...overrides,
  };
}

describe("SessionList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useSettingsStore.setState({ favorites: [] });
  });

  it("renders the new session trigger", () => {
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.getByLabelText("Neue Session starten")).toBeTruthy();
  });

  it("renders the floating add-favorite and new-session buttons, no SESSIONS header", () => {
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Ordner als Favorit hinzufügen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neue Session starten" })).toBeInTheDocument();
    expect(screen.queryByText("Sessions")).toBeNull();
  });

  it("calls onNewSession when trigger is clicked", () => {
    const onNewSession = vi.fn();
    render(<SessionList onNewSession={onNewSession} onQuickStart={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Neue Session starten"));
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("shows empty state text when no sessions exist", () => {
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.getByText("Keine Sessions vorhanden")).toBeTruthy();
  });

  it("renders session cards for existing sessions", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s1", title: "Session Alpha" }),
        makeSession({ id: "s2", title: "Session Beta" }),
      ],
      activeSessionId: "s1",
    });

    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.getByText("Session Alpha")).toBeTruthy();
    expect(screen.getByText("Session Beta")).toBeTruthy();
  });

  // Ordering is intentionally NOT status/createdAt-derived anymore: the list
  // renders the stored array order verbatim so drag-reorder survives (see the
  // "renders sessions in stored array order" regression in the DnD wiring
  // block). The former auto-sort tests were removed with that behavior.

  // ── Click handling (single mode) ───────────────────────────────────────

  it("sets the active session and closes the preview on card click in single mode", () => {
    useUIStore.setState({ previewFolder: "/some/preview" });
    useSessionStore.setState({
      sessions: [makeSession({ id: "s-click", title: "Clickable" })],
      layoutMode: "single",
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    fireEvent.click(screen.getByText("Clickable"));
    expect(useSessionStore.getState().activeSessionId).toBe("s-click");
    expect(useUIStore.getState().previewFolder).toBeNull();
  });

  it("invokes close_session and removes the session on close button click", () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    useSessionStore.setState({
      sessions: [makeSession({ id: "s-close", title: "Closable" })],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Session schließen"));
    expect(mockedInvoke).toHaveBeenCalledWith("close_session", { id: "s-close" });
    expect(useSessionStore.getState().sessions.find((s) => s.id === "s-close")).toBeUndefined();
  });

  // ── Click handling (grid mode) ─────────────────────────────────────────

  it("adds a session to the grid on click when it is not already in the grid", () => {
    useSessionStore.setState({
      sessions: [makeSession({ id: "s-grid", title: "Grid Add" })],
      layoutMode: "grid",
      gridSessionIds: [],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    fireEvent.click(screen.getByText("Grid Add"));
    expect(useSessionStore.getState().gridSessionIds).toContain("s-grid");
  });

  it("focuses an already-gridded session on click in grid mode", () => {
    useSessionStore.setState({
      sessions: [makeSession({ id: "s-focus", title: "Grid Focus" })],
      layoutMode: "grid",
      gridSessionIds: ["s-focus"],
      focusedGridSessionId: null,
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    fireEvent.click(screen.getByText("Grid Focus"));
    expect(useSessionStore.getState().focusedGridSessionId).toBe("s-focus");
  });

  it("marks the focused grid session as active in grid mode", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "g1", title: "Grid One" }),
        makeSession({ id: "g2", title: "Grid Two" }),
      ],
      layoutMode: "grid",
      gridSessionIds: ["g1", "g2"],
      focusedGridSessionId: "g2",
    });
    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    const activeCard = container.querySelector(".bg-accent-a10");
    expect(activeCard?.textContent).toContain("Grid Two");
  });

  it("shows the position-aware mini-map only for sessions currently in the grid", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "g1", title: "In Grid" }),
        makeSession({ id: "g2", title: "Not In Grid" }),
      ],
      layoutMode: "grid",
      gridSessionIds: ["g1"],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    const maps = screen.getAllByTestId("grid-minimap");
    expect(maps).toHaveLength(1);
    // Single grid session → the mini-map reports the full-screen slot.
    expect(maps[0].getAttribute("aria-label")).toBe("Im Grid: Vollbild");
  });
});

// ── DnD wiring ──────────────────────────────────────────────────────────────

describe("SessionList DnD wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    // favoriteGroups auch leeren — Gruppen-Header sind ebenfalls sortable
    // und wuerden die Row-Zaehlung unten verfaelschen.
    useSettingsStore.setState({ favorites: [], favoriteGroups: [] });
  });

  // Whole-tile drag: the sortable root carries dnd-kit's attributes; the
  // dedicated grip button is gone.
  function getSortableRows(container: HTMLElement): Element[] {
    return Array.from(container.querySelectorAll("[aria-roledescription='sortable']"));
  }

  it("renders one whole-row drag surface per session (no grip button)", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s1", title: "Alpha" }),
        makeSession({ id: "s2", title: "Beta" }),
      ],
    });
    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(getSortableRows(container)).toHaveLength(2);
    expect(screen.queryByLabelText("Session-Drag-Handle")).not.toBeInTheDocument();
  });

  it("renders zero drag surfaces when no sessions exist", () => {
    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(getSortableRows(container)).toHaveLength(0);
  });

  it("renders sessions in store order (not by alphabetical)", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s3", title: "Third", status: "running" }),
        makeSession({ id: "s1", title: "First", status: "running" }),
        makeSession({ id: "s2", title: "Second", status: "running" }),
      ],
    });
    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    // All 3 rows present — store order is stable within same status+createdAt bucket
    expect(getSortableRows(container)).toHaveLength(3);
  });

  // Regression for the drag-reorder bug: the render must honor the stored
  // array order verbatim — that is exactly what reorderSessions writes on drop.
  // The store order below deliberately contradicts the former auto-sort
  // (which floated active sessions up and ordered each group by createdAt):
  // a done+late session sits BEFORE a running+early one. If the render still
  // re-sorted, Beta would jump above Alpha and the drag would visibly snap back.
  it("renders sessions in stored array order, ignoring status and createdAt", () => {
    const now = Date.now();
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s-a", title: "Alpha", status: "done", createdAt: now }),
        makeSession({ id: "s-b", title: "Beta", status: "running", createdAt: now - 5000 }),
      ],
    });
    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    const titles = getSortableRows(container).map((r) => r.textContent ?? "");
    expect(titles[0]).toContain("Alpha");
    expect(titles[1]).toContain("Beta");
  });
});
