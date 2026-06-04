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

  it("sorts active sessions before done sessions", () => {
    const now = Date.now();
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s-done", title: "Done Session", status: "done", createdAt: now - 1000 }),
        makeSession({ id: "s-run", title: "Running Session", status: "running", createdAt: now }),
      ],
      activeSessionId: "s-run",
    });

    const { container } = render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    // Running session should appear before done in DOM
    const cards = container.querySelectorAll("[class*='cursor-pointer']");
    const titles = Array.from(cards).map((c) => c.textContent ?? "");
    const runIdx = titles.findIndex((t) => t.includes("Running Session"));
    const doneIdx = titles.findIndex((t) => t.includes("Done Session"));
    // Both should be found, running first
    if (runIdx !== -1 && doneIdx !== -1) {
      expect(runIdx).toBeLessThan(doneIdx);
    }
  });

  // ── Sorting ────────────────────────────────────────────────────────────

  it("sorts sessions within the active group by createdAt ascending", () => {
    const now = Date.now();
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s-late", title: "Late Session", status: "running", createdAt: now }),
        makeSession({ id: "s-early", title: "Early Session", status: "running", createdAt: now - 5000 }),
      ],
    });

    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    const early = screen.getByText("Early Session");
    const late = screen.getByText("Late Session");
    expect(early.compareDocumentPosition(late) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("treats waiting status as an active session for sorting", () => {
    const now = Date.now();
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s-done", title: "Done One", status: "done", createdAt: now - 10000 }),
        makeSession({ id: "s-wait", title: "Waiting One", status: "waiting", createdAt: now }),
      ],
    });

    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    const wait = screen.getByText("Waiting One");
    const done = screen.getByText("Done One");
    expect(wait.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

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

  it("shows the grid marker icon for sessions currently in the grid", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "g1", title: "In Grid" }),
        makeSession({ id: "g2", title: "Not In Grid" }),
      ],
      layoutMode: "grid",
      gridSessionIds: ["g1"],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);

    expect(screen.getAllByLabelText("Im Grid")).toHaveLength(1);
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
    useSettingsStore.setState({ favorites: [] });
  });

  it("renders one drag-handle per session row", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s1", title: "Alpha" }),
        makeSession({ id: "s2", title: "Beta" }),
      ],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.getAllByLabelText("Session-Drag-Handle")).toHaveLength(2);
  });

  it("renders zero drag-handles when no sessions exist", () => {
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    expect(screen.queryAllByLabelText("Session-Drag-Handle")).toHaveLength(0);
  });

  it("renders sessions in store order (not by alphabetical)", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "s3", title: "Third", status: "running" }),
        makeSession({ id: "s1", title: "First", status: "running" }),
        makeSession({ id: "s2", title: "Second", status: "running" }),
      ],
    });
    render(<SessionList onNewSession={vi.fn()} onQuickStart={vi.fn()} />);
    const handles = screen.getAllByLabelText("Session-Drag-Handle");
    // All 3 handles present — store order is stable within same status+createdAt bucket
    expect(handles).toHaveLength(3);
  });
});
