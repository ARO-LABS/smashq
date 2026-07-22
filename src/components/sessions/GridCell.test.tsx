import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { GridCellChrome } from "./GridCell";
import { useSessionStore } from "../../store/sessionStore";
import type { ClaudeSession } from "../../store/sessionStore";

// Mock useNowTick to return a stable timestamp
vi.mock("../../hooks/useNowTick", () => ({
  useNowTick: () => 1700000000000,
}));

// Wiring-Test-Mock: das Restart-VERHALTEN (close + create + resume) ist in
// sessionRestart.test.ts abgedeckt — hier zählt nur, dass der Button die
// Aktion mit der richtigen sessionId auslöst.
const mockRestartSession = vi.fn();
vi.mock("./hooks/sessionRestart", () => ({
  restartSession: (id: string) => mockRestartSession(id) as Promise<void>,
}));

function makeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  return {
    id: "cell-1",
    title: "Grid Session",
    folder: "/test",
    shell: "powershell",
    status: "running",
    createdAt: 1700000000000 - 60000,
    finishedAt: null,
    exitCode: null,
    lastOutputAt: 1700000000000 - 2000,
    lastOutputSnippet: "some output",
    ...overrides,
  };
}

describe("GridCellChrome (floating pill variant)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default-Resolve: der Fire-and-forget-Pfad hängt ein `.finally` an —
    // ohne Promise-Rückgabe würde jeder Restart-Klick im Test crashen.
    mockRestartSession.mockResolvedValue(undefined);
    useSessionStore.setState({
      sessions: [makeSession()],
      activeSessionId: "cell-1",
    });
  });

  it("renders the floating pill container with absolute positioning at top-right", () => {
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const pill = screen.getByTestId("grid-cell-chrome-cell-1");
    expect(pill).toBeTruthy();
    expect(pill.className).toContain("absolute");
    expect(pill.className).toContain("top-2");
    expect(pill.className).toContain("right-2");
    // No title text — pill is action-only + branch chip
    expect(screen.queryByText("Grid Session")).toBeNull();
  });

  it("renders the pill mostly opaque at rest (90, full on hover)", () => {
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const pill = screen.getByTestId("grid-cell-chrome-cell-1");
    // 60% Ruhe-Deckkraft liess die Pille ueber Terminal-Text verwaschen
    // wirken — 90% haelt sie lesbar, hover:100 bleibt (#Grid-Farben).
    expect(pill.className).toContain("opacity-90");
    expect(pill.className).not.toContain("opacity-60");
  });

  it("calls onMaximize when maximize button is clicked", () => {
    const onMaximize = vi.fn();
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={onMaximize}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Maximieren"));
    expect(onMaximize).toHaveBeenCalledTimes(1);
  });

  it("calls onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={vi.fn()}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByLabelText("Aus Grid entfernen"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("button clicks do not bubble to the cell wrapper (stopPropagation)", async () => {
    const onWrapperClick = vi.fn();
    const { container } = render(
      <div onClick={onWrapperClick}>
        <GridCellChrome
          sessionId="cell-1"
          onMaximize={vi.fn()}
          onRemove={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(container.querySelector('[aria-label="Maximieren"]')!);
    fireEvent.click(container.querySelector('[aria-label="Aus Grid entfernen"]')!);
    fireEvent.click(container.querySelector('[aria-label="Session neu starten"]')!);
    expect(onWrapperClick).not.toHaveBeenCalled();
    // finally-setState des Restart-Buttons flushen (act-Hygiene).
    await act(async () => {});
  });

  // ── Restart button (Issue #49) ───────────────────────────────────────

  it("renders the restart button and calls restartSession with the cell's sessionId", async () => {
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Session neu starten"));

    expect(mockRestartSession).toHaveBeenCalledTimes(1);
    expect(mockRestartSession).toHaveBeenCalledWith("cell-1");
    // finally-setState flushen (act-Hygiene).
    await act(async () => {});
  });

  it("disables the restart button while the restart is in flight", async () => {
    // Kontrolliert auflösbares Promise: der Button muss sofort disabled +
    // busy sein, solange der Restart läuft.
    let releaseRestart!: () => void;
    mockRestartSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRestart = resolve;
        }),
    );
    render(
      <GridCellChrome
        sessionId="cell-1"
        onMaximize={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const btn = screen.getByLabelText("Session neu starten") as HTMLButtonElement;
    fireEvent.click(btn);

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      releaseRestart();
    });
    expect(btn.disabled).toBe(false);
  });
});
