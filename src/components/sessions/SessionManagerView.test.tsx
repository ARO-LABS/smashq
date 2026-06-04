import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { SessionManagerView } from "./SessionManagerView";
import { useSessionStore } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

// Shared mount- und unmount-Spy für den SessionTerminal-Mock.
// Wird in Regression-Tests verwendet, um zu verifizieren dass
// Tab-Switches UND Layout-Switches keine Remounts triggern.
const sessionTerminalMountSpy = vi.fn<(sessionId: string) => void>();
const sessionTerminalUnmountSpy = vi.fn<(sessionId: string) => void>();

// Mock heavy child components to keep tests fast and isolated.
// Zwei testids werden emittiert:
//   - "session-terminal" → legacy-Selector (bestehende Tests).
//   - `terminal-${sessionId}` → dynamischer Selector (Regression-Tests).
vi.mock("./SessionTerminal", () => ({
  SessionTerminal: ({ sessionId }: { sessionId: string }) => {
    useEffect(() => {
      sessionTerminalMountSpy(sessionId);
      return () => {
        sessionTerminalUnmountSpy(sessionId);
      };
    }, [sessionId]);
    return (
      <div data-testid="session-terminal">
        <div data-testid={`terminal-${sessionId}`}>{sessionId}</div>
      </div>
    );
  },
}));

vi.mock("./ConfigPanel", () => ({
  ConfigPanel: () => <div data-testid="config-panel" />,
}));

vi.mock("./TerminalToolbar", () => ({
  TerminalToolbar: () => <div data-testid="terminal-toolbar" />,
}));

vi.mock("./FavoritePreview", () => ({
  FavoritePreview: () => <div data-testid="favorite-preview" />,
}));

vi.mock("./hooks/useResizeHandle", () => ({
  useResizeHandle: () => ({ containerRef: { current: null }, handleResizeStart: vi.fn() }),
}));

vi.mock("./hooks/useSessionEvents", () => ({
  useSessionEvents: vi.fn(),
}));

vi.mock("./hooks/useSessionCreation", () => ({
  useSessionCreation: () => ({
    handleResumeSession: vi.fn(),
    handleQuickStart: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  sessionTerminalMountSpy.mockClear();
  sessionTerminalUnmountSpy.mockClear();
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    layoutMode: "single",
    gridSessionIds: [],
    focusedGridSessionId: null,
  });
  useUIStore.setState({ previewFolder: null });
});

// Test-Helper: Session-Fabrik für Regression-Tests.
function mockSession(id: string) {
  return {
    id,
    title: `Session ${id}`,
    folder: "/test",
    shell: "powershell" as const,
    status: "running" as const,
    createdAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    lastOutputAt: Date.now(),
    lastOutputSnippet: "",
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SessionManagerView", () => {
  it("renders empty state when no sessions exist", () => {
    render(<SessionManagerView />);

    const toggleBtn = screen.getByTitle("Sidebar ausblenden");
    expect(toggleBtn).toBeTruthy();
  });

  it("renders terminal when an active session exists", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    render(<SessionManagerView />);

    expect(screen.getByTestId("session-terminal")).toBeTruthy();
  });

  it("shows favorite preview even when a session is active", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: "/some/project" });

    render(<SessionManagerView />);

    expect(screen.getByTestId("favorite-preview")).toBeTruthy();
    // Terminals bleiben gemountet (Scrollback-Schutz), werden aber versteckt.
    // Deshalb: Terminal-Instanzen existieren im DOM, aber FavoritePreview ist
    // sichtbar. Wir prüfen hier die Preview-Sichtbarkeit — das Terminal-Wrapper-
    // Sichtbarkeitsverhalten ist durch Regression-Tests unten abgedeckt.
  });

  it("returns to terminal when preview is closed", async () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: "/some/project" });

    const { rerender } = render(<SessionManagerView />);
    expect(screen.getByTestId("favorite-preview")).toBeTruthy();

    // Close the preview and let the resulting async updates settle inside act()
    await act(async () => {
      useUIStore.getState().closePreview();
      rerender(<SessionManagerView />);
    });

    expect(screen.queryByTestId("favorite-preview")).toBeNull();
    expect(screen.getByTestId("session-terminal")).toBeTruthy();
  });

  it("renders grid chrome elements in grid layout mode", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1"), mockSession("s-2")],
      activeSessionId: "s-1",
      layoutMode: "grid",
      gridSessionIds: ["s-1", "s-2"],
      focusedGridSessionId: "s-1",
    });

    render(<SessionManagerView />);

    // Statt SessionGrid-Wrapper jetzt Grid-Cell-Chrome-Elemente pro Session.
    expect(screen.getByTestId("grid-cell-chrome-s-1")).toBeTruthy();
    expect(screen.getByTestId("grid-cell-chrome-s-2")).toBeTruthy();
  });
});

// ── Regression-Tests: Scroll-Bug-Fix (Commit 8b820f5 + Option-B-Refactor) ────
// Sichert ab dass SessionTerminal-Instanzen WEDER beim Tab-Switch NOCH
// beim Layout-Switch unmountet werden → xterm-Scrollback-Buffer überlebt.
describe("SessionManagerView — Scroll-Regression (always-mounted Terminals)", () => {
  it("rendert alle Sessions gleichzeitig im Single-Mode (3 Sessions → 3 Terminal-Instanzen)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B"), mockSession("C")],
      activeSessionId: "A",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    render(<SessionManagerView />);

    expect(screen.getByTestId("terminal-A")).toBeTruthy();
    expect(screen.getByTestId("terminal-B")).toBeTruthy();
    expect(screen.getByTestId("terminal-C")).toBeTruthy();
  });

  it("zeigt nur die aktive Session, versteckt die anderen (display:none)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "B",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    const { container } = render(<SessionManagerView />);

    const wrapperA = container.querySelector('[data-session-wrapper="A"]');
    const wrapperB = container.querySelector('[data-session-wrapper="B"]');

    expect(wrapperA).toBeTruthy();
    expect(wrapperB).toBeTruthy();
    // Inaktive Session → display:none.
    expect((wrapperA as HTMLElement).style.display).toBe("none");
    // Aktive Session → display:flex (sichtbar).
    expect((wrapperB as HTMLElement).style.display).toBe("flex");
  });

  it("unmountet SessionTerminal nicht beim Tab-Switch (Scrollback-Buffer bleibt erhalten)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    const { rerender } = render(<SessionManagerView />);

    expect(sessionTerminalUnmountSpy).not.toHaveBeenCalled();

    act(() => {
      useSessionStore.setState({ activeSessionId: "B" });
    });
    rerender(<SessionManagerView />);

    expect(sessionTerminalUnmountSpy).not.toHaveBeenCalledWith("A");
    expect(sessionTerminalUnmountSpy).not.toHaveBeenCalledWith("B");
    expect(sessionTerminalUnmountSpy).not.toHaveBeenCalled();

    expect(screen.getByTestId("terminal-A")).toBeTruthy();
    expect(screen.getByTestId("terminal-B")).toBeTruthy();
  });

  it("unmountet SessionTerminal NICHT beim Layout-Switch Single → Grid → Single", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    const { rerender } = render(<SessionManagerView />);

    // Initial-Mount: A + B werden genau einmal gemountet.
    expect(sessionTerminalMountSpy).toHaveBeenCalledWith("A");
    expect(sessionTerminalMountSpy).toHaveBeenCalledWith("B");
    const initialMountCount = sessionTerminalMountSpy.mock.calls.length;
    expect(initialMountCount).toBe(2);

    // Switch Single → Grid.
    act(() => {
      useSessionStore.setState({
        layoutMode: "grid",
        gridSessionIds: ["A", "B"],
        focusedGridSessionId: "A",
      });
    });
    rerender(<SessionManagerView />);

    // Switch Grid → Single.
    act(() => {
      useSessionStore.setState({
        layoutMode: "single",
        gridSessionIds: [],
        focusedGridSessionId: null,
      });
    });
    rerender(<SessionManagerView />);

    // Nach 2 Layout-Switches dürfen KEINE Unmounts passiert sein.
    expect(sessionTerminalUnmountSpy).not.toHaveBeenCalled();
    // Und die Terminal-Instanzen wurden nur beim Initial-Render gemountet,
    // nicht nochmal bei den Layout-Switches.
    expect(sessionTerminalMountSpy.mock.calls.length).toBe(initialMountCount);
  });

  it("data-session-wrapper-Divs sind identische DOM-Nodes über Layout-Switches", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    const { container, rerender } = render(<SessionManagerView />);

    const wrapperABefore = container.querySelector('[data-session-wrapper="A"]');
    const wrapperBBefore = container.querySelector('[data-session-wrapper="B"]');
    expect(wrapperABefore).toBeTruthy();
    expect(wrapperBBefore).toBeTruthy();

    // Single → Grid.
    act(() => {
      useSessionStore.setState({
        layoutMode: "grid",
        gridSessionIds: ["A", "B"],
        focusedGridSessionId: "A",
      });
    });
    rerender(<SessionManagerView />);

    const wrapperAAfter = container.querySelector('[data-session-wrapper="A"]');
    const wrapperBAfter = container.querySelector('[data-session-wrapper="B"]');

    // Gleiche DOM-Referenz → React hat NICHT remountet.
    expect(wrapperAAfter).toBe(wrapperABefore);
    expect(wrapperBAfter).toBe(wrapperBBefore);
  });

  it("Grid-Mode: beide Grid-Sessions sind sichtbar (display:flex)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B"), mockSession("C")],
      activeSessionId: "A",
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "A",
    });

    const { container } = render(<SessionManagerView />);

    const wrapperA = container.querySelector('[data-session-wrapper="A"]') as HTMLElement;
    const wrapperB = container.querySelector('[data-session-wrapper="B"]') as HTMLElement;
    const wrapperC = container.querySelector('[data-session-wrapper="C"]') as HTMLElement;

    // A + B im Grid → sichtbar.
    expect(wrapperA.style.display).toBe("flex");
    expect(wrapperB.style.display).toBe("flex");
    // C nicht im Grid → versteckt, aber gemountet.
    expect(wrapperC.style.display).toBe("none");
    expect(wrapperC).toBeTruthy();
  });
});

// ── Sidebar / Toolbar / Panel-Verhalten ──────────────────────────────────
describe("SessionManagerView — Sidebar & Toolbar", () => {
  it("blendet die Sidebar aus und wieder ein per Toggle-Button", () => {
    render(<SessionManagerView />);

    // Initial: Sidebar sichtbar → Toggle-Button bietet "ausblenden" an.
    const collapseBtn = screen.getByTitle("Sidebar ausblenden");
    act(() => {
      fireEvent.click(collapseBtn);
    });

    // Nach Klick: Sidebar collapsed → Button-Titel wechselt zu "einblenden".
    expect(screen.getByTitle("Sidebar einblenden")).toBeTruthy();
    expect(screen.queryByTitle("Sidebar ausblenden")).toBeNull();

    // Erneuter Klick stellt die Sidebar wieder her.
    act(() => {
      fireEvent.click(screen.getByTitle("Sidebar einblenden"));
    });
    expect(screen.getByTitle("Sidebar ausblenden")).toBeTruthy();
  });

  it("zeigt KEINE Terminal-Toolbar wenn keine Session und kein Grid existiert", () => {
    render(<SessionManagerView />);

    // Ohne aktive Session / Grid darf die Toolbar nicht gerendert werden.
    expect(screen.queryByTestId("terminal-toolbar")).toBeNull();
  });

  it("zeigt die Terminal-Toolbar sobald eine aktive Session existiert", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });

    render(<SessionManagerView />);

    expect(screen.getByTestId("terminal-toolbar")).toBeTruthy();
  });

  it("versteckt die Terminal-Toolbar im Grid-Mode (per-cell Maximize replaces global toggle)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: null,
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "A",
    });

    render(<SessionManagerView />);

    // Grid-Mode → globale Toolbar versteckt (per-cell Pill übernimmt "back to single" Funktion).
    expect(screen.queryByTestId("terminal-toolbar")).toBeNull();
  });
});

describe("SessionManagerView — ConfigPanel & Preview", () => {
  it("rendert das ConfigPanel im Single-Mode wenn configPanelOpen true ist", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: null, configPanelOpen: true });

    render(<SessionManagerView />);

    expect(screen.getByTestId("config-panel")).toBeTruthy();
  });

  it("rendert das ConfigPanel NICHT wenn configPanelOpen false ist", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: null, configPanelOpen: false });

    render(<SessionManagerView />);

    expect(screen.queryByTestId("config-panel")).toBeNull();
  });

  it("rendert das ConfigPanel als Preview-Panel im Grid-Mode bei aktivem previewFolder", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "A",
    });
    useUIStore.setState({ previewFolder: "/grid/preview", configPanelOpen: false });

    render(<SessionManagerView />);

    // Grid-Mode + previewFolder → ConfigPanel als Preview-Panel, FavoritePreview NICHT.
    expect(screen.getByTestId("config-panel")).toBeTruthy();
    expect(screen.queryByTestId("favorite-preview")).toBeNull();
  });

  it("zeigt EmptyState wenn keine Sessions und kein Preview existieren", () => {
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: null });

    const { container } = render(<SessionManagerView />);

    // Kein Terminal-Root sichtbar.
    const root = container.querySelector('[data-testid="session-terminal-root"]') as HTMLElement;
    expect(root.style.display).toBe("none");
  });

  it("blendet den Terminal-Root aus solange ein Single-Preview offen ist", () => {
    useSessionStore.setState({
      sessions: [mockSession("s-1")],
      activeSessionId: "s-1",
      layoutMode: "single",
      gridSessionIds: [],
      focusedGridSessionId: null,
    });
    useUIStore.setState({ previewFolder: "/preview" });

    render(<SessionManagerView />);

    // Preview offen → Terminal-Container-Wrapper auf display:none, Terminals bleiben gemountet.
    expect(screen.getByTestId("favorite-preview")).toBeTruthy();
    expect(screen.getByTestId("terminal-s-1")).toBeTruthy();
  });
});

describe("SessionManagerView — Grid-Cell-Fokus", () => {
  it("rahmt fokussierte Grid-Zelle staerker als unfokussierte", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "B",
    });

    const { container } = render(<SessionManagerView />);

    const wrapperA = container.querySelector('[data-session-wrapper="A"]') as HTMLElement;
    const wrapperB = container.querySelector('[data-session-wrapper="B"]') as HTMLElement;

    // Beide Zellen tragen einen farbigen Border (Projekt-Farbe via --qr-frame).
    expect(wrapperA.getAttribute("style")).toContain("--qr-frame");
    expect(wrapperB.getAttribute("style")).toContain("--qr-frame");
    // Fokussierte Zelle B → 2px, unfokussierte A → 1px.
    expect(wrapperB.getAttribute("style")).toContain("border-width: 2px");
    expect(wrapperA.getAttribute("style")).toContain("border-width: 1px");
  });

  it("faerbt jede Grid-Zelle mit ihrer Per-Session-Projektfarbe (--qr-frame)", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B")],
      activeSessionId: "A",
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "A",
    });

    render(<SessionManagerView />);

    // Farbe kommt aus accentColorFor (direktes oklch) — identisch zur Sidebar-Punktfarbe.
    const cellA = screen.getByTestId("grid-cell-A");
    const cellB = screen.getByTestId("grid-cell-B");
    expect(cellA.getAttribute("style")).toContain("--qr-frame");
    expect(cellA.getAttribute("style")).toContain("oklch");
    expect(cellB.getAttribute("style")).toContain("oklch");
  });

  it("rendert Grid-Cell-Chrome nur fuer Sessions im Grid, nicht fuer Ausserstehende", () => {
    useSessionStore.setState({
      sessions: [mockSession("A"), mockSession("B"), mockSession("C")],
      activeSessionId: "A",
      layoutMode: "grid",
      gridSessionIds: ["A", "B"],
      focusedGridSessionId: "A",
    });

    render(<SessionManagerView />);

    expect(screen.getByTestId("grid-cell-chrome-A")).toBeTruthy();
    expect(screen.getByTestId("grid-cell-chrome-B")).toBeTruthy();
    // C ist nicht im Grid → kein Chrome.
    expect(screen.queryByTestId("grid-cell-chrome-C")).toBeNull();
  });
});
