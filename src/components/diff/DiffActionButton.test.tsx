import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../../utils/errorLogger";
import { DiffActionButton } from "./DiffActionButton";
import { useSessionStore } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";
import type { ClaudeSession } from "../../store/sessionStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockLogError = vi.mocked(logError);

function seedSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  const session: ClaudeSession = {
    id: "s1",
    title: "Test",
    folder: "C:/projects/x",
    shell: "powershell",
    status: "running",
    createdAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    lastOutputAt: Date.now(),
    lastOutputSnippet: "",
    isGitRepo: true,
    ...overrides,
  };
  useSessionStore.setState({ sessions: [session] });
  return session;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvoke.mockResolvedValue(undefined);
  useSessionStore.setState({ sessions: [] });
  useUIStore.setState({ toasts: [] });
});

describe("DiffActionButton — visibility contract", () => {
  it("renders nothing when session is missing from the store", () => {
    render(<DiffActionButton sessionId="ghost" errorSource="Test.diff" />);
    expect(screen.queryByLabelText("Diff anzeigen")).toBeNull();
  });

  it("renders nothing for non-git sessions", () => {
    seedSession({ id: "s-non-git", isGitRepo: false });
    render(<DiffActionButton sessionId="s-non-git" errorSource="Test.diff" />);
    expect(screen.queryByLabelText("Diff anzeigen")).toBeNull();
  });

  it("renders nothing when isGitRepo is undefined (defensive — no probe yet)", () => {
    seedSession({ id: "s-unknown-repo", isGitRepo: undefined });
    render(<DiffActionButton sessionId="s-unknown-repo" errorSource="Test.diff" />);
    expect(screen.queryByLabelText("Diff anzeigen")).toBeNull();
  });

  it("renders the button on a git repo regardless of hasDiff state", () => {
    seedSession({ id: "s-dirty", isGitRepo: true, hasDiff: true });
    const { unmount } = render(
      <DiffActionButton sessionId="s-dirty" errorSource="Test.diff" />,
    );
    expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
    unmount();

    seedSession({ id: "s-clean", isGitRepo: true, hasDiff: false });
    const { unmount: u2 } = render(
      <DiffActionButton sessionId="s-clean" errorSource="Test.diff" />,
    );
    expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
    u2();

    seedSession({ id: "s-unprobed", isGitRepo: true });
    render(<DiffActionButton sessionId="s-unprobed" errorSource="Test.diff" />);
    expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
  });
});

describe("DiffActionButton — color reflects hasDiff", () => {
  // className enthaelt immer `hover:text-accent`, daher reicht toContain nicht —
  // wir checken die Token-Liste exakt (split by whitespace).
  function tokens(el: Element): string[] {
    return el.className.split(/\s+/);
  }

  it("hasDiff===true → text-accent (base, not hover)", () => {
    seedSession({ id: "s1", hasDiff: true });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    expect(tokens(screen.getByLabelText("Diff anzeigen"))).toContain("text-accent");
  });

  it("hasDiff===false → text-neutral-500 (dimmed clean)", () => {
    seedSession({ id: "s1", hasDiff: false });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    expect(tokens(screen.getByLabelText("Diff anzeigen"))).toContain("text-neutral-500");
  });

  it("hasDiff===undefined → text-neutral-700 (not yet probed)", () => {
    seedSession({ id: "s1", hasDiff: undefined });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    expect(tokens(screen.getByLabelText("Diff anzeigen"))).toContain("text-neutral-700");
  });
});

describe("DiffActionButton — click strategy", () => {
  it("hasDiff===true: opens window directly with one IPC, no extra probe", () => {
    seedSession({ id: "s1", hasDiff: true });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("open_session_diff_window", {
      sessionId: "s1",
    });
  });

  it("hasDiff===undefined + probe returns true: opens window and updates store", async () => {
    seedSession({ id: "s1", hasDiff: undefined });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "session_has_diff") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("session_has_diff", { sessionId: "s1" });
      expect(mockInvoke).toHaveBeenCalledWith("open_session_diff_window", { sessionId: "s1" });
    });
    expect(useSessionStore.getState().sessions[0].hasDiff).toBe(true);
  });

  it("hasDiff===false + probe still returns false: shows toast, no window open", async () => {
    seedSession({ id: "s1", hasDiff: false });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "session_has_diff") return Promise.resolve(false);
      return Promise.resolve(undefined);
    });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    await vi.waitFor(() => {
      const toasts = useUIStore.getState().toasts;
      expect(toasts.some((t) => t.message === "Keine Aenderungen seit Session-Start.")).toBe(true);
    });
    const openCalls = mockInvoke.mock.calls.filter(
      (c) => c[0] === "open_session_diff_window",
    );
    expect(openCalls).toHaveLength(0);
  });

  it("hasDiff===false + probe flips to true: opens window (catches stale state)", async () => {
    seedSession({ id: "s1", hasDiff: false });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "session_has_diff") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    await vi.waitFor(() => {
      const openCalls = mockInvoke.mock.calls.filter(
        (c) => c[0] === "open_session_diff_window",
      );
      expect(openCalls).toHaveLength(1);
    });
    expect(useSessionStore.getState().sessions[0].hasDiff).toBe(true);
  });

  it("stops click propagation so the parent card is not selected", () => {
    seedSession({ id: "s1", hasDiff: true });
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <DiffActionButton sessionId="s1" errorSource="Test.diff" />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("logs an error with the given source when probe rejects", async () => {
    seedSession({ id: "s1", hasDiff: undefined });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "session_has_diff") return Promise.reject(new Error("probe failed"));
      return Promise.resolve(undefined);
    });
    render(<DiffActionButton sessionId="s1" errorSource="Card.openDiff" />);
    fireEvent.click(screen.getByLabelText("Diff anzeigen"));
    await vi.waitFor(() =>
      expect(mockLogError).toHaveBeenCalledWith("Card.openDiff", expect.any(Error)),
    );
  });
});

describe("DiffActionButton — padding prop", () => {
  it("applies the default p-1.5 padding when none is given", () => {
    seedSession({ id: "s1", hasDiff: true });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" />);
    expect(screen.getByLabelText("Diff anzeigen").className).toContain("p-1.5");
  });

  it("applies a custom padding when provided", () => {
    seedSession({ id: "s1", hasDiff: true });
    render(<DiffActionButton sessionId="s1" errorSource="Test.diff" padding="p-1" />);
    const cls = screen.getByLabelText("Diff anzeigen").className;
    expect(cls).toContain("p-1");
    expect(cls).not.toContain("p-1.5");
  });
});
