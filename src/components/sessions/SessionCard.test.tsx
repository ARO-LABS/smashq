import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionCard } from "./SessionCard";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { ClaudeSession } from "../../store/sessionStore";
import { invoke } from "@tauri-apps/api/core";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// ── Helpers ───────────────────────────────────────────────────────────

function makeSession(overrides: Partial<ClaudeSession> = {}): ClaudeSession {
  const now = Date.now();
  return {
    id: "session-1",
    title: "Test Session",
    folder: "C:/Projects/foo/bar/baz",
    shell: "powershell",
    status: "running",
    createdAt: now - 65_000, // 1:05
    finishedAt: null,
    exitCode: null,
    lastOutputAt: now - 2_000, // recent → active
    lastOutputSnippet: "hello output",
    ...overrides,
  };
}

function renderCard(
  session: ClaudeSession,
  overrides: {
    isActive?: boolean;
    onClick?: (id: string) => void;
    onClose?: (id: string) => void;
  } = {},
) {
  return render(
    <SessionCard
      session={session}
      isActive={overrides.isActive ?? false}
      onClick={overrides.onClick ?? vi.fn()}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("SessionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders title and shortened folder path (status-dot removed per user request)", () => {
    const session = makeSession({
      title: "My Session",
      folder: "C:/Projects/foo/bar/baz",
    });
    renderCard(session);

    expect(screen.getByText("My Session")).toBeTruthy();
    // folderLabel("C:/Projects/foo/bar/baz") → "baz" (last segment, quiet-rail suffix)
    expect(screen.getByText("baz")).toBeTruthy();
    // Full path must NOT appear as a text node
    expect(screen.queryByText("C:/Projects/foo/bar/baz")).toBeNull();
  });

  it("swaps project name for in-flow hover chrome so a long title truncates instead of overlapping", () => {
    // Regression guard for the title/icon overlap. The dynamic fix: the title is
    // `flex-1 min-w-0 truncate` (max width at rest), the project name is hidden
    // on hover (`group-hover:hidden`), and the action chrome is IN the flex flow
    // and revealed on hover (`hidden` → `group-hover:flex`). Because the chrome
    // occupies real flow width, flexbox shrinks the title and it truncates with
    // an ellipsis — no absolute overlay, so no overlap is possible.
    const session = makeSession({
      title: "Gib mir eine Zusammenfassung dieses sehr langen Titels",
      folder: "C:/Projects/foo/bar/baz",
    });
    renderCard(session);

    const title = screen.getByText(session.title);
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("truncate");

    // Project name is swapped out on hover (no fixed reserve width).
    const projectName = screen.getByText("baz");
    expect(projectName.className).toContain("group-hover:hidden");
    expect(projectName.className).not.toContain("w-[104px]");

    // Action chrome is in-flow (shrink-0) and only shown on hover — a button
    // proves the container; its parent carries the reveal classes.
    const chrome = screen.getByLabelText("Session schließen").parentElement;
    expect(chrome?.className).toContain("hidden");
    expect(chrome?.className).toContain("group-hover:flex");
    expect(chrome?.className).not.toContain("absolute");
  });

  it("hides time-chip for running+active (no sidebar signal by design — P7.5)", () => {
    renderCard(makeSession({ status: "running" }));
    // Active sessions: sidebar intentionally signal-less per P7.5 — status comes
    // from the terminal content itself, not from a redundant chip/dot.
    expect(screen.queryByText(/Läuft seit/)).toBeNull();
  });

  it("renders no status text chip for done status (quiet-rail row has no time display)", () => {
    const now = Date.now();
    const { container } = renderCard(
      makeSession({
        status: "done",
        createdAt: now - 120_000,
        finishedAt: now - 60_000,
      }),
    );
    // Quiet-rail row: no status text chips — the dot + title carry all identity.
    expect(screen.queryByText(/Fertig/)).toBeNull();
    expect(container.querySelector("svg.text-success")).toBeNull();
  });

  it("renders no status text chip for error status (quiet-rail row has no time display)", () => {
    const { container } = renderCard(
      makeSession({ status: "error", exitCode: 42 }),
    );
    // Quiet-rail row: no status text chips.
    expect(screen.queryByText(/Fehler/)).toBeNull();
    expect(container.querySelector("svg.text-error")).toBeNull();
  });

  it("calls onClick with id on card click and onClose on close button", () => {
    const onClick = vi.fn();
    const onClose = vi.fn();
    renderCard(makeSession({ id: "sess-99" }), { onClick, onClose });

    // Click card body (title) — should trigger onClick
    fireEvent.click(screen.getByText("Test Session"));
    expect(onClick).toHaveBeenCalledWith("sess-99");
    expect(onClose).not.toHaveBeenCalled();

    // Click close button — should trigger onClose, NOT re-trigger onClick
    // (stopPropagation verified via call count unchanged)
    const closeBtn = screen.getByLabelText("Session schließen");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledWith("sess-99");
    expect(onClick).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it("renders no dot for starting status (status-dot removed in P7.5 cleanup)", () => {
    const { container } = renderCard(makeSession({ status: "starting" }));
    expect(container.querySelector(".status-breathe-animation")).toBeNull();
  });

  // ── Rename Tests ─────────────────────────────────────────────────────

  it("enters edit mode on double-click and commits on Enter", () => {
    const session = makeSession({ id: "sess-rename", title: "Old Title" });
    useSessionStore.getState().addSession({
      id: session.id,
      title: session.title,
      folder: session.folder,
      shell: session.shell,
    });

    renderCard(session);

    // Double-click title to enter edit mode
    fireEvent.doubleClick(screen.getByText("Old Title"));
    const input = screen.getByLabelText("Session umbenennen");
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("Old Title");

    // Type new name and press Enter
    fireEvent.change(input, { target: { value: "New Title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Input should disappear, store should be updated
    expect(screen.queryByLabelText("Session umbenennen")).toBeNull();
    const updated = useSessionStore.getState().sessions.find((s) => s.id === "sess-rename");
    expect(updated?.title).toBe("New Title");
  });

  it("rename BEFORE discovery resolved the UUID: anchored one-shot resolve flushes the override", async () => {
    // Bug repro: History reads sessionTitleOverrides[uuid] only — a rename
    // while claudeSessionId is still unknown used to strand the intent in
    // pendingTitleOverrides until (if ever) discovery resolved. The rename
    // itself must now trigger a time-anchored scan so History updates too.
    const UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    useSessionStore.getState().addSession({
      id: "sess-pre-uuid",
      title: "Alter Titel",
      folder: "C:/proj/pre-uuid",
      shell: "powershell",
    });
    const stored = useSessionStore
      .getState()
      .sessions.find((s) => s.id === "sess-pre-uuid")!;
    const session = makeSession({
      id: "sess-pre-uuid",
      title: "Alter Titel",
      folder: "C:/proj/pre-uuid",
      claudeSessionId: undefined,
      createdAt: stored.createdAt,
    });

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "scan_claude_sessions") {
        // jsonl written ~1.5s after the card was created → inside tolerance.
        return [
          {
            session_id: UUID,
            started_at: new Date(stored.createdAt + 1_500).toISOString(),
          },
        ];
      }
      return undefined;
    });

    renderCard(session);
    fireEvent.doubleClick(screen.getByText("Alter Titel"));
    const input = screen.getByLabelText("Session umbenennen");
    fireEvent.change(input, { target: { value: "Neuer Titel" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(useSettingsStore.getState().sessionTitleOverrides[UUID]).toBe(
        "Neuer Titel",
      );
    });
    // The resolve also heals the missing UUID on the runtime session.
    expect(
      useSessionStore.getState().sessions.find((s) => s.id === "sess-pre-uuid")
        ?.claudeSessionId,
    ).toBe(UUID);
  });

  it("rename before discovery does NOT guess when no history entry is near the anchor", async () => {
    const FAR_UUID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    useSessionStore.getState().addSession({
      id: "sess-no-anchor",
      title: "Alter Titel",
      folder: "C:/proj/no-anchor",
      shell: "powershell",
    });
    const stored = useSessionStore
      .getState()
      .sessions.find((s) => s.id === "sess-no-anchor")!;
    const session = makeSession({
      id: "sess-no-anchor",
      title: "Alter Titel",
      folder: "C:/proj/no-anchor",
      claudeSessionId: undefined,
      createdAt: stored.createdAt,
    });

    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "scan_claude_sessions") {
        // Only candidate is hours away from the anchor — must not be claimed.
        return [
          {
            session_id: FAR_UUID,
            started_at: new Date(stored.createdAt - 7_200_000).toISOString(),
          },
        ];
      }
      return undefined;
    });

    renderCard(session);
    fireEvent.doubleClick(screen.getByText("Alter Titel"));
    const input = screen.getByLabelText("Session umbenennen");
    fireEvent.change(input, { target: { value: "Neuer Titel" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Intent is parked in pendingTitleOverrides (discovery seams flush later)…
    await waitFor(() => {
      expect(
        useSettingsStore.getState().pendingTitleOverrides["sess-no-anchor"],
      ).toBe("Neuer Titel");
    });
    // …but nothing was guessed: no override, no UUID on the session.
    expect(
      useSettingsStore.getState().sessionTitleOverrides[FAR_UUID],
    ).toBeUndefined();
    expect(
      useSessionStore.getState().sessions.find((s) => s.id === "sess-no-anchor")
        ?.claudeSessionId,
    ).toBeUndefined();
  });

  it("cancels rename on Escape without changing title", () => {
    const session = makeSession({ id: "sess-esc", title: "Keep This" });
    useSessionStore.getState().addSession({
      id: session.id,
      title: session.title,
      folder: session.folder,
      shell: session.shell,
    });

    renderCard(session);

    fireEvent.doubleClick(screen.getByText("Keep This"));
    const input = screen.getByLabelText("Session umbenennen");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // Input gone, title unchanged in store
    expect(screen.queryByLabelText("Session umbenennen")).toBeNull();
    const stored = useSessionStore.getState().sessions.find((s) => s.id === "sess-esc");
    expect(stored?.title).toBe("Keep This");
  });

  // ── Diff-Button visibility / invoke ─────────────────────────────────

  describe("Diff button", () => {
    // Seit Option-3-Reloaded (2026-05-27) ist der Sichtbarkeits-Vertrag des
    // DiffActionButton: Git-Repo ja → immer da; Farbe spiegelt hasDiff. Non-
    // Git → Komponente rendert null. Die Click-Strategie wird in
    // DiffActionButton.test.tsx getestet — hier nur Card-Integration.

    it("renders Diff button on git repos regardless of hasDiff state", () => {
      // Session muss im Store sein, damit DiffActionButton sie ueber den
      // Selector findet (kein Prop-Drilling — er liest direkt aus dem Store).
      const sessionDirty = makeSession({ id: "sess-dirty", isGitRepo: true, hasDiff: true });
      useSessionStore.setState({ sessions: [sessionDirty] });
      const { unmount: u1 } = renderCard(sessionDirty);
      expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
      u1();

      const sessionClean = makeSession({ id: "sess-clean", isGitRepo: true, hasDiff: false });
      useSessionStore.setState({ sessions: [sessionClean] });
      const { unmount: u2 } = renderCard(sessionClean);
      expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
      u2();

      const sessionUnknown = makeSession({ id: "sess-unknown", isGitRepo: true });
      useSessionStore.setState({ sessions: [sessionUnknown] });
      renderCard(sessionUnknown);
      expect(screen.getByLabelText("Diff anzeigen")).toBeTruthy();
    });

    it("omits Diff button on non-git sessions (no click target, no toast)", () => {
      const session = makeSession({ id: "sess-non-git", isGitRepo: false });
      useSessionStore.setState({ sessions: [session] });
      renderCard(session);
      expect(screen.queryByLabelText("Diff anzeigen")).toBeNull();
    });

    it("on click with hasDiff=true: invokes open_session_diff_window directly (1 IPC)", () => {
      const session = makeSession({ id: "sess-known-dirty", isGitRepo: true, hasDiff: true });
      useSessionStore.setState({ sessions: [session] });
      mockedInvoke.mockResolvedValueOnce(undefined);
      renderCard(session);
      fireEvent.click(screen.getByLabelText("Diff anzeigen"));
      expect(mockedInvoke).toHaveBeenCalledTimes(1);
      expect(mockedInvoke).toHaveBeenCalledWith("open_session_diff_window", {
        sessionId: "sess-known-dirty",
      });
    });
  });

  describe("displayId rendering", () => {
    it("does not render the #displayId suffix (user-irrelevant internal id)", () => {
      const session = makeSession({
        title: "Foo",
        displayId: "3K2X",
      });
      renderCard(session);

      // Title visible, internal displayId suffix never shown to the user
      expect(screen.getByText("Foo")).toBeInTheDocument();
      expect(screen.queryByText(/#3K2X/)).toBeNull();
    });

    it("omits suffix when displayId is absent (backward-compat for legacy sessions)", () => {
      const session = makeSession({
        title: "old-session",
        // displayId intentionally undefined
      });
      renderCard(session);

      expect(screen.getByText("old-session")).toBeTruthy();
      // No # marker present in DOM at all
      expect(screen.queryByText(/#/)).toBeNull();
    });

    it("inline-edit pre-fills just the plain title (no #displayId suffix)", () => {
      const session = makeSession({
        id: "sess-edit-id",
        title: "smashq",
        displayId: "3K2X",
      });
      useSessionStore.setState({ sessions: [], activeSessionId: null });
      useSessionStore.getState().addSession({
        id: session.id,
        title: session.title,
        displayId: session.displayId,
        folder: session.folder,
        shell: session.shell,
      });
      renderCard(session);

      fireEvent.doubleClick(screen.getByText("smashq"));
      const input = screen.getByLabelText("Session umbenennen") as HTMLInputElement;
      expect(input.value).toBe("smashq");
    });
  });

  // ── Status dot behavior (quiet-rail row) ────────────────────────────

  describe("status dot behavior", () => {
    it("renders no status text chips — quiet-rail row has no TimeDisplay", () => {
      // TimeDisplay is removed in the quiet-rail redesign. The dot + pulse carry status.
      const now = Date.now();
      for (const status of ["running", "starting", "waiting", "done", "error"] as const) {
        const { unmount } = renderCard(makeSession({ status, lastOutputAt: now - 60_000 }));
        expect(screen.queryByText(/Idle seit/)).toBeNull();
        expect(screen.queryByText(/Wartet auf Input/)).toBeNull();
        expect(screen.queryByText(/Fertig/)).toBeNull();
        expect(screen.queryByText(/Fehler/)).toBeNull();
        unmount();
      }
    });

    it("pulsing dot for running status", () => {
      const { container } = renderCard(makeSession({ status: "running" }));
      const dot = container.querySelector("[data-testid='sess-dot']");
      expect(dot?.className).toContain("animate-pulse");
    });

    it("pulsing dot for starting status", () => {
      const { container } = renderCard(makeSession({ status: "starting" }));
      const dot = container.querySelector("[data-testid='sess-dot']");
      expect(dot?.className).toContain("animate-pulse");
    });

    it("no pulse for done status", () => {
      const { container } = renderCard(makeSession({ status: "done" }));
      const dot = container.querySelector("[data-testid='sess-dot']");
      expect(dot?.className).not.toContain("animate-pulse");
    });

    it("no pulse for error status", () => {
      const { container } = renderCard(makeSession({ status: "error" }));
      const dot = container.querySelector("[data-testid='sess-dot']");
      expect(dot?.className).not.toContain("animate-pulse");
    });

    it("dot turns error-colored for an errored session", () => {
      const { container } = renderCard(makeSession({ folder: "C:/Projects/x", title: "t", status: "error" }));
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      expect(dot.style.background).toContain("--color-error");
    });

    it("dot turns warning-colored for a waiting session", () => {
      const { container } = renderCard(makeSession({ folder: "C:/Projects/x", title: "t", status: "waiting" }));
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      expect(dot.style.background).toContain("--color-warning");
    });

    it("dot pulses for a running session and uses the project color", () => {
      const { container } = renderCard(makeSession({ folder: "C:/Projects/x", title: "t", status: "running" }));
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      expect(dot.className).toContain("animate-pulse");
      expect(dot.style.background).toContain("oklch");
    });

    it("dot is dimmed for a done session", () => {
      const { container } = renderCard(makeSession({ folder: "C:/Projects/x", title: "t", status: "done" }));
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      expect(dot.className).toContain("opacity-40");
    });
  });

  // ── Status dot removed (Concept-B P7.5 cleanup) ──────────────────────

  describe("status dot is fully removed", () => {
    it("renders no status indicator for any status — text-chip carries all state", () => {
      const now = Date.now();
      for (const status of ["running", "starting", "waiting", "done", "error"] as const) {
        const { container, unmount } = renderCard(
          makeSession({ status, lastOutputAt: now - 60_000 }),
        );
        expect(container.querySelector(".status-pulse-animation")).toBeNull();
        expect(container.querySelector(".bg-info")).toBeNull();
        expect(container.querySelector(".bg-warning")).toBeNull();
        unmount();
      }
    });
  });

  it("shows the shortened project name as a muted suffix, not the full path", () => {
    const session = makeSession({ folder: "C:/Projects/animetrackler", title: "anim", status: "running" });
    renderCard(session);
    expect(screen.getByText("animetrackler")).toBeInTheDocument();
    expect(screen.queryByText("C:/Projects/animetrackler")).toBeNull();
  });

  // ── isActive / grid-slot styling ─────────────────────────────────────

  describe("active and grid markers", () => {
    it("applies active accent-tint styling when isActive=true", () => {
      const { container } = renderCard(makeSession(), { isActive: true });
      const card = container.querySelector(".cursor-pointer");
      expect(card?.className).toContain("bg-accent-a10");
      expect(card?.className).not.toContain("hover:bg-hover-overlay");
    });

    it("applies hover-overlay class at rest when isActive=false", () => {
      const { container } = renderCard(makeSession(), { isActive: false });
      const card = container.querySelector(".cursor-pointer");
      expect(card?.className).toContain("hover:bg-hover-overlay");
      expect(card?.className).not.toContain("bg-accent-a10");
    });

    it("renders a position-aware mini-map when gridSlot is set", () => {
      render(
        <SessionCard
          session={makeSession()}
          isActive={false}
          gridSlot={{ index: 2, count: 4 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      // index 2 of 4 → bottom-left quadrant (area "c").
      const map = screen.getByLabelText("Im Grid: unten links");
      expect(map).toBeTruthy();
      const active = map.querySelector('[data-active="true"]') as HTMLElement;
      expect(active?.getAttribute("data-cell")).toBe("c");
      // Aktive Zelle nutzt jetzt die Session-Farbe inline, nicht mehr bg-accent.
      expect(active.className).not.toContain("bg-accent");
      expect(active.style.background).toContain("oklch");
    });

    it("mini-map active cell matches the session dot color (idle)", () => {
      const { container } = render(
        <SessionCard
          session={makeSession({ folder: "C:/Projects/x", title: "t" })}
          isActive={false}
          gridSlot={{ index: 2, count: 4 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      const active = container.querySelector('[data-active="true"]') as HTMLElement;
      expect(active.style.background).toBe(dot.style.background);
      expect(active.style.background).toContain("oklch");
    });

    it("mini-map active cell follows the dot into error state", () => {
      const { container } = render(
        <SessionCard
          session={makeSession({ folder: "C:/Projects/x", title: "t", status: "error" })}
          isActive={false}
          gridSlot={{ index: 2, count: 4 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const active = container.querySelector('[data-active="true"]') as HTMLElement;
      expect(active.style.background).toContain("--color-error");
      // Inaktive Zellen bleiben neutral, ohne Inline-Farbe.
      const inactive = container.querySelector('[data-cell]:not([data-active="true"])') as HTMLElement;
      expect(inactive.className).toContain("bg-neutral-600");
      expect(inactive.style.background).toBe("");
    });

    it("adapts the mini-map to the session count (2 sessions = halves)", () => {
      render(
        <SessionCard
          session={makeSession()}
          isActive={false}
          gridSlot={{ index: 1, count: 2 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      // index 1 of 2 → bottom half (area "b"); only two cells rendered.
      const map = screen.getByLabelText("Im Grid: unten");
      expect(map.querySelectorAll("[data-cell]").length).toBe(2);
      expect(map.querySelector('[data-active="true"]')?.getAttribute("data-cell")).toBe("b");
    });

    it("omits the grid indicator when gridSlot is not set", () => {
      renderCard(makeSession());
      expect(screen.queryByTestId("grid-minimap")).toBeNull();
    });
  });

  // ── Hover-action buttons ─────────────────────────────────────────────

  describe("hover action buttons", () => {
    it("invokes open_folder_in_explorer with the session folder", () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      renderCard(makeSession({ folder: "C:/Projects/demo" }));
      fireEvent.click(screen.getByLabelText("Ordner im Explorer öffnen"));
      expect(mockedInvoke).toHaveBeenCalledWith("open_folder_in_explorer", {
        path: "C:/Projects/demo",
      });
    });

    it("invokes open_terminal_in_folder with the session folder", () => {
      mockedInvoke.mockResolvedValueOnce(undefined);
      renderCard(makeSession({ folder: "C:/Projects/demo" }));
      fireEvent.click(screen.getByLabelText("Terminal im Ordner öffnen"));
      expect(mockedInvoke).toHaveBeenCalledWith("open_terminal_in_folder", {
        path: "C:/Projects/demo",
      });
    });

    it("does not trigger onClick when a hover-action button is clicked", () => {
      const onClick = vi.fn();
      mockedInvoke.mockResolvedValue(undefined);
      renderCard(makeSession(), { onClick });
      fireEvent.click(screen.getByLabelText("Ordner im Explorer öffnen"));
      fireEvent.click(screen.getByLabelText("Terminal im Ordner öffnen"));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  // ── Rename edge cases ────────────────────────────────────────────────

  describe("rename edge cases", () => {
    it("does not rename when committed value is empty/whitespace", () => {
      const session = makeSession({ id: "sess-empty", title: "Stay Name" });
      useSessionStore.setState({ sessions: [], activeSessionId: null });
      useSessionStore.getState().addSession({
        id: session.id,
        title: session.title,
        folder: session.folder,
        shell: session.shell,
      });
      renderCard(session);

      fireEvent.doubleClick(screen.getByText("Stay Name"));
      const input = screen.getByLabelText("Session umbenennen");
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });

      const stored = useSessionStore.getState().sessions.find((s) => s.id === "sess-empty");
      expect(stored?.title).toBe("Stay Name");
    });

    it("does not rename on a no-op edit (unchanged value)", () => {
      const session = makeSession({ id: "sess-noop", title: "Same Title" });
      useSessionStore.setState({ sessions: [], activeSessionId: null });
      useSessionStore.getState().addSession({
        id: session.id,
        title: session.title,
        folder: session.folder,
        shell: session.shell,
      });
      const renameSpy = vi.spyOn(useSessionStore.getState(), "renameSession");
      renderCard(session);

      fireEvent.doubleClick(screen.getByText("Same Title"));
      const input = screen.getByLabelText("Session umbenennen");
      fireEvent.keyDown(input, { key: "Enter" });

      expect(renameSpy).not.toHaveBeenCalled();
      renameSpy.mockRestore();
    });

    it("commits rename on blur", () => {
      const session = makeSession({ id: "sess-blur", title: "Before Blur" });
      useSessionStore.setState({ sessions: [], activeSessionId: null });
      useSessionStore.getState().addSession({
        id: session.id,
        title: session.title,
        folder: session.folder,
        shell: session.shell,
      });
      renderCard(session);

      fireEvent.doubleClick(screen.getByText("Before Blur"));
      const input = screen.getByLabelText("Session umbenennen");
      fireEvent.change(input, { target: { value: "After Blur" } });
      fireEvent.blur(input);

      expect(screen.queryByLabelText("Session umbenennen")).toBeNull();
      const stored = useSessionStore.getState().sessions.find((s) => s.id === "sess-blur");
      expect(stored?.title).toBe("After Blur");
    });

    it("does not trigger onClick when clicking inside the edit input", () => {
      const onClick = vi.fn();
      const session = makeSession({ id: "sess-input-click", title: "Click Guard" });
      useSessionStore.setState({ sessions: [], activeSessionId: null });
      useSessionStore.getState().addSession({
        id: session.id,
        title: session.title,
        folder: session.folder,
        shell: session.shell,
      });
      renderCard(session, { onClick });

      fireEvent.doubleClick(screen.getByText("Click Guard"));
      const input = screen.getByLabelText("Session umbenennen");
      fireEvent.click(input);
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  // ── Accent context menu (per-project color) ──────────────────────────
  describe("accent context menu", () => {
    beforeEach(() => {
      useSettingsStore.setState({ folderAccents: {}, sessionAccents: {} });
    });

    it("opens the accent menu on right-click even without a claudeSessionId", () => {
      // Pre-discovery sessions have no claudeSessionId — the menu must still open
      // (regression: it previously bailed and silently showed nothing).
      const session = makeSession({ claudeSessionId: undefined, folder: "C:/Projects/demo" });
      renderCard(session);

      fireEvent.contextMenu(screen.getByText("Test Session"));
      expect(screen.getByRole("menu", { name: "Akzentfarbe wählen" })).toBeInTheDocument();
    });

    it("suppresses the native menu via preventDefault on right-click", () => {
      renderCard(makeSession({ claudeSessionId: undefined }));
      const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      const spy = vi.spyOn(evt, "preventDefault");
      screen.getByText("Test Session").dispatchEvent(evt);
      expect(spy).toHaveBeenCalled();
    });

    it("writes a per-folder accent override when a swatch is picked", () => {
      const session = makeSession({ claudeSessionId: undefined, folder: "C:/Projects/demo" });
      renderCard(session);

      fireEvent.contextMenu(screen.getByText("Test Session"));
      fireEvent.click(screen.getByRole("button", { name: "amber" }));

      expect(useSettingsStore.getState().folderAccents["C:/Projects/demo"]).toBe("amber");
    });
  });
});
