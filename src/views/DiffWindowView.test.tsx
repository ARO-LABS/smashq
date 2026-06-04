import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { DiffWindowView } from "./DiffWindowView";
import type { SessionDiff } from "../components/diff/types";

// CodeMirror does some DOM measuring that jsdom does not fully support — we
// stub the DiffMergeView so the tests focus on routing + state flows. The
// child component owns its own unit test (DiffMergeView.test.tsx).
vi.mock("../components/diff/DiffMergeView", () => ({
  DiffMergeView: ({
    file,
    mode,
  }: {
    file: { path: string };
    mode: string;
  }) => (
    <div data-testid="diff-merge-stub" data-mode={mode}>
      {file.path}
    </div>
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// `listen` registers Tauri event handlers. We capture the registered callbacks
// per event name so tests can fire `tauri://focus` / `session-deleted/<id>`
// manually and assert the resulting state transitions.
const eventHandlers = new Map<string, (payload: unknown) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: (payload: unknown) => void) => {
    eventHandlers.set(event, handler);
    return Promise.resolve(() => eventHandlers.delete(event));
  }),
}));

function emitEvent(event: string, payload: unknown = {}): void {
  const handler = eventHandlers.get(event);
  if (handler) handler(payload);
}

const mockedInvoke = vi.mocked(invoke);

function makeDiff(overrides: Partial<SessionDiff> = {}): SessionDiff {
  return {
    sessionId: "session-1",
    snapshotCommit: "abc123",
    snapshotAt: "2026-05-12T14:02:00Z",
    computedAt: "2026-05-12T14:05:00Z",
    computeMs: 42,
    files: [
      {
        path: "src/foo.ts",
        status: "modified",
        additions: 3,
        deletions: 1,
        oldContent: "old",
        newContent: "new",
        oversize: false,
      },
    ],
    truncated: false,
    ...overrides,
  };
}

describe("DiffWindowView", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    eventHandlers.clear();
  });

  it("invokes get_session_diff on mount and renders file list + selected merge view", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);

    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("get_session_diff", {
        sessionId: "session-1",
      });
    });
    // File list (button) shows the modified file path
    const fileBtn = screen.getByTitle("Geaendert: src/foo.ts");
    expect(fileBtn).toBeTruthy();
    // Merge view stub mounts in side mode by default
    const stub = await screen.findByTestId("diff-merge-stub");
    expect(stub.getAttribute("data-mode")).toBe("side");
    expect(stub.textContent).toBe("src/foo.ts");
  });

  it("renders error banner with retry when invoke rejects", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("Snapshot missing"));
    render(<DiffWindowView sessionId="session-err" />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Snapshot missing");
    const retry = screen.getByRole("button", { name: /Erneut versuchen/i });
    expect(retry).toBeTruthy();

    // Successful retry replaces banner with normal content.
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(screen.getByTitle("Geaendert: src/foo.ts")).toBeTruthy();
  });

  it("renders empty-state when no files in diff", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff({ files: [] }));
    render(<DiffWindowView sessionId="session-empty" />);

    await waitFor(() => {
      expect(screen.getByText(/Keine Aenderungen seit Session-Start/i)).toBeTruthy();
    });
  });

  it("renders soft info-state (no red alert, no retry) when folder is not a git repository", async () => {
    mockedInvoke.mockRejectedValueOnce(
      new Error("Session folder is not a git repository"),
    );
    render(<DiffWindowView sessionId="session-non-git" />);

    // Soft state uses role=status, not role=alert; and no retry button.
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/kein Git-Repository/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /Erneut versuchen/i })).toBeNull();
  });

  it("switches view mode via the Side/Inline radio group", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);

    const inlineBtn = await screen.findByRole("radio", { name: /Inline/i });
    fireEvent.click(inlineBtn);
    const stub = await screen.findByTestId("diff-merge-stub");
    expect(stub.getAttribute("data-mode")).toBe("inline");
  });

  it("shows missing-id error if sessionId is null", async () => {
    render(<DiffWindowView sessionId={null} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Session-ID");
    // No invoke call because we never had an id.
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("renders the session id in the header when provided", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-xyz" />);
    await screen.findByTestId("diff-merge-stub");
    expect(screen.getByText("session-xyz")).toBeTruthy();
  });

  it("renders multiple files and switches the merge view on file select", async () => {
    mockedInvoke.mockResolvedValueOnce(
      makeDiff({
        files: [
          {
            path: "src/foo.ts",
            status: "modified",
            additions: 3,
            deletions: 1,
            oldContent: "old",
            newContent: "new",
            oversize: false,
          },
          {
            path: "src/bar.ts",
            status: "added",
            additions: 9,
            deletions: 0,
            oldContent: "",
            newContent: "new bar",
            oversize: false,
          },
        ],
      }),
    );
    render(<DiffWindowView sessionId="session-1" />);

    // First file selected by default.
    let stub = await screen.findByTestId("diff-merge-stub");
    expect(stub.textContent).toBe("src/foo.ts");

    // Select the second file.
    fireEvent.click(screen.getByTitle("Hinzugefuegt: src/bar.ts"));
    await waitFor(() => {
      expect(screen.getByTestId("diff-merge-stub").textContent).toBe("src/bar.ts");
    });
    stub = screen.getByTestId("diff-merge-stub");
    expect(stub.getAttribute("data-mode")).toBe("side");
  });

  it("freezes the diff when a session-deleted event arrives", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);
    await screen.findByTestId("diff-merge-stub");

    expect(screen.queryByRole("status")).toBeNull();
    emitEvent("session-deleted/session-1");

    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Session beendet");
  });

  it("auto-refreshes on tauri://focus while not frozen", async () => {
    mockedInvoke.mockResolvedValue(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);
    await screen.findByTestId("diff-merge-stub");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    emitEvent("tauri://focus");
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("does not refresh on focus once the session is frozen", async () => {
    mockedInvoke.mockResolvedValue(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);
    await screen.findByTestId("diff-merge-stub");
    expect(mockedInvoke).toHaveBeenCalledTimes(1);

    emitEvent("session-deleted/session-1");
    await screen.findByRole("status");

    emitEvent("tauri://focus");
    // Give any (unwanted) refresh a chance to fire.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
  });

  it("disables the footer refresh button while a refresh is in flight", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);
    await screen.findByTestId("diff-merge-stub");

    const refreshBtn = screen.getByRole("button", { name: /Diff neu laden/i });
    expect(refreshBtn).not.toBeDisabled();

    // A never-resolving refresh keeps refreshing=true.
    mockedInvoke.mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(refreshBtn).toBeDisabled();
    });
  });

  it("clears the previous error when a retry succeeds", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("first failure"));
    render(<DiffWindowView sessionId="session-1" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("first failure");

    mockedInvoke.mockResolvedValueOnce(makeDiff());
    fireEvent.click(screen.getByRole("button", { name: /Erneut versuchen/i }));
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("shows the truncated-budget hint in the footer when diff.truncated is true", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff({ truncated: true }));
    render(<DiffWindowView sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText(/Gekuerzt — Budget erreicht/i)).toBeTruthy();
    });
  });

  it("renders the compute time and file count in the footer", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff({ computeMs: 137 }));
    render(<DiffWindowView sessionId="session-1" />);
    await waitFor(() => {
      expect(screen.getByText("137 ms")).toBeTruthy();
    });
    expect(screen.getByText("1 Datei")).toBeTruthy();
  });

  it("disables footer refresh after the session is frozen", async () => {
    mockedInvoke.mockResolvedValueOnce(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);
    await screen.findByTestId("diff-merge-stub");

    const refreshBtn = screen.getByRole("button", { name: /Diff neu laden/i });
    expect(refreshBtn).not.toBeDisabled();

    emitEvent("session-deleted/session-1");
    await screen.findByRole("status");
    expect(refreshBtn).toBeDisabled();
  });

  it("keeps view mode persistent across a refresh", async () => {
    mockedInvoke.mockResolvedValue(makeDiff());
    render(<DiffWindowView sessionId="session-1" />);

    const inlineBtn = await screen.findByRole("radio", { name: /Inline/i });
    fireEvent.click(inlineBtn);
    await waitFor(() => {
      expect(screen.getByTestId("diff-merge-stub").getAttribute("data-mode")).toBe(
        "inline",
      );
    });

    emitEvent("tauri://focus");
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledTimes(2);
    });
    // Mode survives the refresh.
    expect(screen.getByTestId("diff-merge-stub").getAttribute("data-mode")).toBe(
      "inline",
    );
  });
});
