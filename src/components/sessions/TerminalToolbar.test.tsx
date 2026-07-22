import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { TerminalToolbar } from "./TerminalToolbar";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: <T,>(cmd: string, args?: Record<string, unknown>) =>
    mockInvoke(cmd, args) as Promise<T>,
}));

// Wiring-Test-Mock: das Restart-VERHALTEN (close + create + resume) ist in
// sessionRestart.test.ts abgedeckt — hier zählt nur, dass der Button die
// Aktion mit der richtigen sessionId auslöst.
const mockRestartSession = vi.fn();
vi.mock("./hooks/sessionRestart", () => ({
  restartSession: (id: string) => mockRestartSession(id) as Promise<void>,
}));

beforeEach(() => {
  mockInvoke.mockReset();
  // Default: not a git repo — prevents unhandled promise warnings in tests
  // that don't set their own mock
  mockInvoke.mockRejectedValue(new Error("Not a git repository"));
  mockRestartSession.mockReset();
  mockRestartSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TerminalToolbar (floating overlay variant)", () => {
  it("renders the floating overlay container with absolute positioning", () => {
    render(
      <TerminalToolbar layoutMode="single" onLayoutChange={vi.fn()} />,
    );
    const overlay = screen.getByTestId("terminal-toolbar");
    expect(overlay.className).toContain("absolute");
    expect(overlay.className).toContain("top-2");
    expect(overlay.className).toContain("right-2");
    // Default at-rest opacity is 80 (full on hover).
    expect(overlay.className).toContain("opacity-80");
  });

  it("does not render title or grid-count (signal lives in sidebar/segmented-control)", () => {
    render(
      <TerminalToolbar layoutMode="grid" onLayoutChange={vi.fn()} />,
    );
    expect(screen.queryByText(/Kein Terminal/)).toBeNull();
    expect(screen.queryByText(/Grid \(/)).toBeNull();
  });

  it("calls onLayoutChange with correct mode on button clicks", () => {
    const onLayoutChange = vi.fn();
    render(
      <TerminalToolbar layoutMode="single" onLayoutChange={onLayoutChange} />,
    );

    fireEvent.click(screen.getByLabelText("Grid-Ansicht"));
    expect(onLayoutChange).toHaveBeenCalledWith("grid");

    fireEvent.click(screen.getByLabelText("Einzelansicht"));
    expect(onLayoutChange).toHaveBeenCalledWith("single");
  });

  it("renders config panel toggle in single mode when handler provided", () => {
    const onToggle = vi.fn();
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={false}
        onToggleConfigPanel={onToggle}
      />,
    );

    const btn = screen.getByLabelText("Konfig-Panel öffnen");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("does not render config panel toggle in grid mode", () => {
    render(
      <TerminalToolbar
        layoutMode="grid"
        onLayoutChange={vi.fn()}
        configPanelOpen={false}
        onToggleConfigPanel={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Konfig-Panel öffnen")).toBeNull();
  });

  it("shows close label when config panel is open", () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={true}
        onToggleConfigPanel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Konfig-Panel schließen")).toBeTruthy();
  });

  // ── Restart button (Issue #49) ─────────────────────────────────────────────

  it("renders the restart button and calls restartSession with the toolbar's sessionId", async () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        sessionId="sess-toolbar"
      />,
    );

    const btn = screen.getByLabelText("Session neu starten");
    fireEvent.click(btn);

    expect(mockRestartSession).toHaveBeenCalledTimes(1);
    expect(mockRestartSession).toHaveBeenCalledWith("sess-toolbar");
    await act(async () => {});
  });

  it("does not render the restart button without a sessionId", () => {
    render(<TerminalToolbar layoutMode="single" onLayoutChange={vi.fn()} />);
    expect(screen.queryByLabelText("Session neu starten")).toBeNull();
  });

  it("disables the restart button and marks it busy while the restart is in flight", async () => {
    let releaseRestart!: () => void;
    mockRestartSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRestart = resolve;
        }),
    );
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        sessionId="sess-busy"
      />,
    );

    const btn = screen.getByLabelText("Session neu starten") as HTMLButtonElement;
    fireEvent.click(btn);

    // Reine Optik wie in SessionCard: der Modul-Guard in restartSession
    // bleibt die Wahrheit gegen Doppelklicks.
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      releaseRestart();
    });
    await waitFor(() => {
      expect(btn.disabled).toBe(false);
    });
  });

  // ── Branch chip ────────────────────────────────────────────────────────────

  it("shows branch chip when folder has a git repo", async () => {
    mockInvoke.mockResolvedValue({ branch: "feature/test-chip", last_commit: null, remote_url: "" });
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("git-branch-chip")).toBeTruthy();
    });
    expect(screen.getByText("feature/test-chip")).toBeTruthy();
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", { folder: "/some/git/repo" });
  });

  it("shows no branch chip when folder is undefined", async () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
      />,
    );
    // Allow any async effects to flush before asserting
    await act(async () => {});
    expect(screen.queryByTestId("git-branch-chip")).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("shows no branch chip when HEAD is detached", async () => {
    mockInvoke.mockResolvedValue({ branch: "HEAD", last_commit: null, remote_url: "" });
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("git-branch-chip")).toBeNull();
  });

  it("shows no branch chip when get_git_info throws", async () => {
    mockInvoke.mockRejectedValue(new Error("Not a git repository"));
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/not/a/repo"
      />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("git-branch-chip")).toBeNull();
  });

  it("shows no branch chip when branch is empty string", async () => {
    mockInvoke.mockResolvedValue({ branch: "", last_commit: null, remote_url: "" });
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    await act(async () => {});
    expect(screen.queryByTestId("git-branch-chip")).toBeNull();
  });

  it("shows branch chip in grid mode when focused session folder is provided", async () => {
    mockInvoke.mockResolvedValue({ branch: "main", last_commit: null, remote_url: "" });
    render(
      <TerminalToolbar
        layoutMode="grid"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", { folder: "/some/git/repo" });
    expect(screen.getByTestId("git-branch-chip")).toBeTruthy();
  });

  it("polls for branch again after 30 s", async () => {
    vi.useFakeTimers();
    mockInvoke.mockResolvedValue({ branch: "master", last_commit: null, remote_url: "" });

    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );

    // First fetch on mount — flush promises
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Advance past poll interval
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("does not call setState after unmount", async () => {
    mockInvoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ branch: "main", last_commit: null, remote_url: "" }), 100)),
    );
    const { unmount } = render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    // Unmount before the invoke resolves — no setState-after-unmount warning
    unmount();
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    // No assertion needed — test passes if no React warning/error is thrown
  });

  // ── Layout button active state ───────────────────────────────────────

  it("highlights the single-view button as active in single mode", () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Einzelansicht").className).toContain("text-accent");
    expect(screen.getByLabelText("Grid-Ansicht").className).not.toContain("text-accent");
  });

  it("highlights the grid-view button as active in grid mode", () => {
    render(
      <TerminalToolbar
        layoutMode="grid"
        onLayoutChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Grid-Ansicht").className).toContain("text-accent");
    expect(screen.getByLabelText("Einzelansicht").className).not.toContain("text-accent");
  });

  it("renders both layout toggle buttons in grid mode", () => {
    render(
      <TerminalToolbar
        layoutMode="grid"
        onLayoutChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Einzelansicht")).toBeTruthy();
    expect(screen.getByLabelText("Grid-Ansicht")).toBeTruthy();
  });

  // ── Config panel toggle ──────────────────────────────────────────────

  it("does not render config panel toggle in single mode without a handler", () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={false}
      />,
    );
    expect(screen.queryByLabelText("Konfig-Panel öffnen")).toBeNull();
    expect(screen.queryByLabelText("Konfig-Panel schließen")).toBeNull();
  });

  it("highlights the config panel toggle as active when the panel is open", () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={true}
        onToggleConfigPanel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Konfig-Panel schließen").className).toContain("text-accent");
  });

  it("does not highlight the config panel toggle when the panel is closed", () => {
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={false}
        onToggleConfigPanel={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Konfig-Panel öffnen").className).not.toContain("text-accent");
  });

  it("invokes onToggleConfigPanel when the open panel toggle is clicked", () => {
    const onToggle = vi.fn();
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        configPanelOpen={true}
        onToggleConfigPanel={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText("Konfig-Panel schließen"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  // ── Branch chip ──────────────────────────────────────────────────────

  it("sets the branch name as the chip title attribute", async () => {
    mockInvoke.mockResolvedValue({ branch: "feature/long-branch-name", last_commit: null, remote_url: "" });
    render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/some/git/repo"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("git-branch-chip")).toBeTruthy();
    });
    expect(screen.getByTestId("git-branch-chip").getAttribute("title")).toBe(
      "feature/long-branch-name",
    );
  });

  it("re-fetches branch info when the folder prop changes", async () => {
    mockInvoke.mockResolvedValue({ branch: "main", last_commit: null, remote_url: "" });
    const { rerender } = render(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/repo/one"
      />,
    );
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", { folder: "/repo/one" });

    rerender(
      <TerminalToolbar
        layoutMode="single"
        onLayoutChange={vi.fn()}
        folder="/repo/two"
      />,
    );
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledWith("get_git_info", { folder: "/repo/two" });
  });
});
