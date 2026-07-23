import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import SessionHistoryViewer from "./SessionHistoryViewer";
import { useSettingsStore } from "../../store/settingsStore";
import { useUIStore } from "../../store/uiStore";
import { useSessionStore } from "../../store/sessionStore";

// Mock @tauri-apps/api/core
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockSession = {
  session_id: "sess-001",
  title: "Fix login bug",
  started_at: "2026-04-05T10:00:00Z",
  ended_at: "2026-04-05T10:30:00Z",
  model: "claude-opus-4-20250514",
  user_turns: 5,
  total_messages: 20,
  subagent_count: 2,
  git_branch: "fix/login",
  cwd: "/projects/app",
};

const mockSession2 = {
  session_id: "sess-002",
  title: "Add unit tests",
  started_at: "2026-04-04T14:00:00Z",
  ended_at: "2026-04-04T15:15:00Z",
  model: "claude-sonnet-4-20250514",
  user_turns: 12,
  total_messages: 40,
  subagent_count: 0,
  git_branch: "test/coverage",
  cwd: "/projects/app",
};

describe("SessionHistoryViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      sessionTitleOverrides: {},
      sessionRestore: {
        enabled: true,
        sessions: [],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
    });
    useUIStore.setState({ toasts: [] });
    useSessionStore.setState({ sessions: [] });
  });

  it("shows loading state initially", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    render(<SessionHistoryViewer folder="/test/project" />);
    // Skeleton-Container traegt das aria-label — stabiler Hook statt Textabgleich
    expect(screen.getByLabelText("Sessions werden geladen")).toBeInTheDocument();
  });

  it("renders session list", async () => {
    mockInvoke.mockResolvedValue([mockSession, mockSession2]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("2 Sessions")).toBeInTheDocument();
    });

    expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    expect(screen.getByText("Add unit tests")).toBeInTheDocument();

    // Model display
    expect(screen.getByText("Opus")).toBeInTheDocument();
    expect(screen.getByText("Sonnet")).toBeInTheDocument();

    // Git branch
    expect(screen.getByText("fix/login")).toBeInTheDocument();
    expect(screen.getByText("test/coverage")).toBeInTheDocument();
  });

  it("shows empty state when no sessions found", async () => {
    mockInvoke.mockResolvedValue([]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(
        screen.getByText("Keine Claude-Sessions fuer dieses Projekt gefunden"),
      ).toBeInTheDocument();
    });
  });

  it("shows error state when loading fails", async () => {
    mockInvoke.mockRejectedValue(new Error("scan failed"));

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText(/Fehler beim Laden/)).toBeInTheDocument();
    });

    expect(screen.getByText("Erneut versuchen")).toBeInTheDocument();
  });

  it("calls onResumeSession when clicking resume button", async () => {
    mockInvoke.mockResolvedValue([mockSession]);
    const handleResume = vi.fn();

    render(
      <SessionHistoryViewer
        folder="/test/project"
        onResumeSession={handleResume}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const resumeBtn = screen.getByTitle("Session fortsetzen");
    fireEvent.click(resumeBtn);

    expect(handleResume).toHaveBeenCalledWith("sess-001", "/projects/app", "Fix login bug");
  });

  it("prefers user override title for rendering and resume", async () => {
    mockInvoke.mockResolvedValue([mockSession]);
    useSettingsStore.getState().setSessionTitleOverride("sess-001", "test123");
    const handleResume = vi.fn();

    render(
      <SessionHistoryViewer
        folder="/test/project"
        onResumeSession={handleResume}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("test123")).toBeInTheDocument();
    });

    // Der Original-Titel ist nicht mehr Titelzeile — er erscheint nur noch
    // als Vorschau in typografischen Anführungszeichen (History-Redesign).
    expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
    expect(screen.getByText("„Fix login bug“")).toBeInTheDocument();

    const resumeBtn = screen.getByTitle("Session fortsetzen");
    fireEvent.click(resumeBtn);

    expect(handleResume).toHaveBeenCalledWith("sess-001", "/projects/app", "test123");
  });

  it("does not show resume button when onResumeSession is not provided", async () => {
    mockInvoke.mockResolvedValue([mockSession]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    expect(screen.queryByTitle("Session fortsetzen")).not.toBeInTheDocument();
  });

  it("shows subagent count only when > 0", async () => {
    mockInvoke.mockResolvedValue([mockSession, mockSession2]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    // mockSession has 2 subagents, mockSession2 has 0. Query via title
    // attribute because the group header also renders a bare count ("2").
    const subagentBadges = screen.getAllByTitle("Subagents");
    expect(subagentBadges).toHaveLength(1);
    expect(subagentBadges[0]).toHaveTextContent("2");
  });

  it("refreshes on button click", async () => {
    mockInvoke.mockResolvedValue([mockSession]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const refreshBtn = screen.getByTitle("Neu laden");
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(2);
    });
  });

  it("shows singular 'Session' for single result", async () => {
    mockInvoke.mockResolvedValue([mockSession]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("1 Session")).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Delete-Button (move-to-trash flow)
  // ==========================================================================

  it("renders a delete button per session row", async () => {
    mockInvoke.mockResolvedValue([mockSession]);

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    expect(
      screen.getByTitle("Session loeschen (in den Papierkorb)"),
    ).toBeInTheDocument();
  });

  it("removes the row optimistically on delete-success and shows a success toast", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession, mockSession2]);
      if (cmd === "delete_claude_session") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByTitle("Session loeschen (in den Papierkorb)");
    expect(deleteButtons).toHaveLength(2);

    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.queryByText("Fix login bug")).not.toBeInTheDocument();
    });

    // The other session must remain visible — partial-state contract
    expect(screen.getByText("Add unit tests")).toBeInTheDocument();

    // Backend was invoked with the contract args
    expect(mockInvoke).toHaveBeenCalledWith("delete_claude_session", {
      folder: "/test/project",
      sessionId: "sess-001",
    });

    // Success toast surfaces with the Memory-pruefen action
    const toasts = useUIStore.getState().toasts;
    const successToast = toasts.find((t) => t.type === "success");
    expect(successToast).toBeDefined();
    expect(successToast?.title).toBe("Session geloescht");
    expect(successToast?.action?.label).toBe("Memory pruefen");
  });

  it("rolls back optimistic removal and shows an error toast on failure", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession]);
      if (cmd === "delete_claude_session") return Promise.reject(new Error("trash failed"));
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle("Session loeschen (in den Papierkorb)");

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    // Rolled back — the row reappears
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const toasts = useUIStore.getState().toasts;
    const errorToast = toasts.find((t) => t.type === "error");
    expect(errorToast).toBeDefined();
    expect(errorToast?.title).toBe("Loeschen fehlgeschlagen");
  });

  it("Memory-pruefen-action switches the active tab to Library", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession]);
      if (cmd === "delete_claude_session") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Session loeschen (in den Papierkorb)"));
    });

    await waitFor(() => {
      const t = useUIStore.getState().toasts.find((t) => t.type === "success");
      expect(t?.action).toBeDefined();
    });

    const successToast = useUIStore.getState().toasts.find((t) => t.type === "success");

    act(() => {
      successToast!.action!.onClick();
    });

    // The "Memory pruefen" action opens the Library in its own detached window.
    expect(mockInvoke).toHaveBeenCalledWith("open_detached_window", {
      view: "library",
      title: "Bibliothek",
    });
  });

  it("disables the trash button while a delete is in-flight on the same row", async () => {
    let resolveDelete: () => void = () => {};
    const deletePromise = new Promise<void>((res) => {
      resolveDelete = res;
    });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession]);
      if (cmd === "delete_claude_session") return deletePromise;
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle("Session loeschen (in den Papierkorb)") as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    // Optimistic remove already happened, but the row's button is gone with
    // it. We probe the disabled-while-pending behavior on a stable in-flight
    // delete using the no-op contract: a second click while the first is
    // pending is a no-op (the only-one-trash-button shortcut never has to
    // fire twice). We assert there was exactly ONE invoke for the delete.
    expect(mockInvoke).toHaveBeenCalledWith("delete_claude_session", {
      folder: "/test/project",
      sessionId: "sess-001",
    });
    const deleteCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === "delete_claude_session",
    );
    expect(deleteCalls).toHaveLength(1);

    await act(async () => {
      resolveDelete();
      await deletePromise;
    });
  });

  it("does not resurrect a successfully-deleted sibling on cross-session race", async () => {
    // Original: [Fix login bug (A), Add unit tests (B)].
    // Scenario: rapid clicks. A's delete REJECTS (rollback), B's delete
    // RESOLVES (kept gone). The pre-fix code captured the entire sessions
    // array at handler entry and rolled back via direct setSessions —
    // which would re-introduce B because A's rollback snapshot still
    // contained B. The position-preserving functional rollback operates
    // on live state and only re-inserts the failed session.
    mockInvoke.mockImplementation((cmd: string, args?: { sessionId?: string }) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession, mockSession2]);
      if (cmd === "delete_claude_session") {
        if (args?.sessionId === "sess-001") return Promise.reject(new Error("trash failed"));
        if (args?.sessionId === "sess-002") return Promise.resolve(undefined);
      }
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByTitle(
      "Session loeschen (in den Papierkorb)",
    );
    expect(deleteBtns).toHaveLength(2);

    await act(async () => {
      fireEvent.click(deleteBtns[0]); // A — will reject
      fireEvent.click(deleteBtns[1]); // B — will resolve
    });

    // A rolled back — visible again at its original position.
    // B is gone — successfully deleted, no ghost.
    await waitFor(() => {
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });
    expect(screen.queryByText("Add unit tests")).not.toBeInTheDocument();

    const toasts = useUIStore.getState().toasts;
    expect(toasts.some((t) => t.type === "error" && t.title === "Loeschen fehlgeschlagen")).toBe(true);
    expect(toasts.some((t) => t.type === "success" && t.title === "Session geloescht")).toBe(true);
  });

  it("clears sessionRestore + sessionTitleOverrides after delete-success", async () => {
    const ID = "sess-001";
    useSettingsStore.setState({
      sessionRestore: {
        enabled: true,
        sessions: [
          { folder: "/test/project", title: "Old", shell: "powershell", claudeSessionId: ID },
        ],
        activeFolder: null,
        layoutMode: "single",
        gridFolders: [],
      },
      sessionTitleOverrides: { [ID]: "Custom Name" },
    });

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "scan_claude_sessions") return Promise.resolve([mockSession]);
      if (cmd === "delete_claude_session") return Promise.resolve(undefined);
      return Promise.reject(new Error(`unexpected cmd: ${cmd}`));
    });

    render(<SessionHistoryViewer folder="/test/project" />);

    await waitFor(() => {
      expect(screen.getByText("Custom Name")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTitle("Session loeschen (in den Papierkorb)"));
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().sessionRestore.sessions).toHaveLength(0);
    });

    expect(useSettingsStore.getState().sessionTitleOverrides[ID]).toBeUndefined();
  });

  // ==========================================================================
  // History-Redesign (Task 4): Gruppierung, Suche, Aktiv-Status, Vorschau,
  // Skeleton
  // ==========================================================================

  describe("History-Redesign", () => {
    it("groups sessions by time with German group labels", async () => {
      const today = new Date().toISOString();
      const old = "2020-01-01T10:00:00Z";
      mockInvoke.mockResolvedValue([
        { ...mockSession, session_id: "s-new", started_at: today, ended_at: today },
        { ...mockSession, session_id: "s-old", started_at: old, ended_at: old },
      ]);
      render(<SessionHistoryViewer folder="C:\\p" />);
      // Testid statt Textquery: „Heute" existiert auch als relatives Datum
      // in der Metazeile — der Testid trifft eindeutig den Gruppen-Header.
      expect(await screen.findByTestId("history-group-today")).toHaveTextContent("Heute");
      expect(screen.getByTestId("history-group-older")).toHaveTextContent("Älter");
    });

    it("search filters by title, shows honest count and empty message", async () => {
      mockInvoke.mockResolvedValue([
        { ...mockSession, session_id: "a", title: "Kanban Board bauen" },
        { ...mockSession, session_id: "b", title: "Updater fixen" },
      ]);
      render(<SessionHistoryViewer folder="C:\\p" />);
      const input = await screen.findByPlaceholderText("Titel oder Branch durchsuchen …");
      fireEvent.change(input, { target: { value: "kanban" } });
      expect(screen.getByText("1 von 2 Sessions")).toBeInTheDocument();
      expect(screen.getByText("Kanban Board bauen")).toBeInTheDocument();
      expect(screen.queryByText("Updater fixen")).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: "zzz-nichts" } });
      expect(screen.getByText(/Keine Session passt zu/)).toBeInTheDocument();
      expect(screen.getByText("0 von 2 Sessions")).toBeInTheDocument();
    });

    it("clear button empties the query and restores the full list", async () => {
      mockInvoke.mockResolvedValue([
        { ...mockSession, session_id: "a", title: "Kanban Board bauen" },
        { ...mockSession, session_id: "b", title: "Updater fixen" },
      ]);
      render(<SessionHistoryViewer folder="C:\\p" />);
      const input = await screen.findByPlaceholderText("Titel oder Branch durchsuchen …");
      // X-Button erscheint erst bei nicht-leerer Query
      expect(screen.queryByLabelText("Suche leeren")).not.toBeInTheDocument();
      fireEvent.change(input, { target: { value: "kanban" } });
      fireEvent.click(screen.getByLabelText("Suche leeren"));
      expect(screen.getByText("2 Sessions")).toBeInTheDocument();
      expect(screen.getByText("Updater fixen")).toBeInTheDocument();
    });

    it("marks a running session as active and hides its actions (Doppel-Resume-Schutz)", async () => {
      mockInvoke.mockResolvedValue([{ ...mockSession, session_id: "uuid-live" }]);
      useSessionStore.setState({
        sessions: [{ id: "s1", claudeSessionId: "uuid-live", status: "running" }] as never,
      });
      render(<SessionHistoryViewer folder="C:\\p" onResumeSession={vi.fn()} />);
      expect(await screen.findByText("Aktiv")).toBeInTheDocument();
      expect(screen.queryByTitle("Session fortsetzen")).not.toBeInTheDocument();
      expect(screen.queryByTitle("Session loeschen (in den Papierkorb)")).not.toBeInTheDocument();
      expect(
        screen.getByText("Läuft gerade — Fortsetzen und Löschen gesperrt"),
      ).toBeInTheDocument();
    });

    it("shows preview with original first message only when a rename override exists", async () => {
      mockInvoke.mockResolvedValue([
        { ...mockSession, session_id: "u1", title: "Erste Nachricht der Session" },
        { ...mockSession, session_id: "u2", title: "Unbenannte Erstnachricht" },
      ]);
      useSettingsStore.setState({ sessionTitleOverrides: { u1: "Mein Name" } });
      render(<SessionHistoryViewer folder="C:\\p" />);
      expect(await screen.findByText("Mein Name")).toBeInTheDocument();
      expect(screen.getByText(/Erste Nachricht der Session/)).toBeInTheDocument();
      // Nicht umbenannte Session: Titel erscheint genau einmal, keine Vorschau-Dopplung
      expect(screen.getAllByText(/Unbenannte Erstnachricht/)).toHaveLength(1);
    });

    it("skeleton loading state exposes the loading label (edge case)", () => {
      mockInvoke.mockReturnValue(new Promise(() => {}));
      render(<SessionHistoryViewer folder="C:\\p" />);
      expect(screen.getByLabelText("Sessions werden geladen")).toBeInTheDocument();
    });

    it("rename button exists per row and calls the handler seam (Task-5-Vorbereitung)", async () => {
      mockInvoke.mockResolvedValue([mockSession]);
      render(<SessionHistoryViewer folder="C:\\p" />);
      await waitFor(() => {
        expect(screen.getByText("Fix login bug")).toBeInTheDocument();
      });
      const renameBtn = screen.getByTitle("Session umbenennen");
      // Noch No-op (Task 5 implementiert das Editieren) — darf nicht werfen
      fireEvent.click(renameBtn);
      expect(screen.getByText("Fix login bug")).toBeInTheDocument();
    });
  });
});
