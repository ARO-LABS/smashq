import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import { useSettingsStore } from "../../store/settingsStore";
import { useSessionStore } from "../../store/sessionStore";

// settingsStore persistence touches the Tauri storage adapter on rehydrate.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────

/** The toggle button — role-scoped so it never collides with the window,
 *  which also carries the accessible name "Notizen". */
const toggleButton = () => screen.getByRole("button", { name: "Notizen" });
const queryWindow = () => screen.queryByRole("dialog", { name: "Notizen" });

describe("NotesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom does not implement Pointer Capture APIs. The window-drag and
    // resize-handle tests call setPointerCapture / releasePointerCapture
    // via the useDraggableWindow hook; without these stubs, the calls throw
    // and surface as unhandled errors even when assertions still pass.
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn(() => true);
    useSettingsStore.setState({
      globalNotes: "",
      projectNotes: {},
      favorites: [],
      notesWindowSize: { w: 384, h: 288 },
    });
    useSessionStore.setState({
      sessions: [],
      activeSessionId: null,
      // Reset layout state too: NotesPanel reads selectEffectiveSession, which
      // is layout-aware. Without this, a grid-mode test would leak layoutMode /
      // focusedGridSessionId into later single-mode tests (#260).
      layoutMode: "single",
      focusedGridSessionId: null,
    });
  });

  it("renders the Notizen button", () => {
    render(<NotesPanel />);
    expect(toggleButton()).toBeTruthy();
  });

  it("grid mode: project notes follow the focused grid cell, not the maximized session (#260)", () => {
    // Regression #260: in grid layout the user focuses a cell via
    // focusedGridSessionId WITHOUT changing activeSessionId. The notes panel
    // must show the FOCUSED cell's project note — previously it stayed pinned
    // to the last-maximized session because it read selectActiveSession.
    const store = useSessionStore.getState();
    store.addSession({ id: "A", title: "Alpha", folder: "C:/projects/alpha", shell: "powershell" });
    store.addSession({ id: "B", title: "Beta", folder: "C:/projects/beta", shell: "powershell" });
    useSessionStore.setState({
      layoutMode: "grid",
      activeSessionId: "A", // last maximized
      focusedGridSessionId: "B", // currently focused grid cell
    });
    useSettingsStore.setState({
      projectNotes: {
        "c:/projects/alpha": "NOTE ALPHA",
        "c:/projects/beta": "NOTE BETA",
      },
    });

    render(<NotesPanel />);
    fireEvent.click(toggleButton());

    // Panel opens on the project tab and must show the focused cell B's note.
    expect(screen.getByDisplayValue("NOTE BETA")).toBeTruthy();
    expect(screen.queryByDisplayValue("NOTE ALPHA")).toBeNull();
  });

  it("opens the window on button click", () => {
    render(<NotesPanel />);
    expect(queryWindow()).toBeNull();
    fireEvent.click(toggleButton());
    expect(queryWindow()).toBeTruthy();
    expect(screen.getByText("Globale Notizen")).toBeTruthy();
    expect(screen.getByText("Projekt-Notizen")).toBeTruthy();
  });

  it("closes the window on a second button click", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    expect(queryWindow()).toBeTruthy();
    fireEvent.click(toggleButton());
    expect(queryWindow()).toBeNull();
  });

  it("closes the window via the close button", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    fireEvent.click(
      screen.getByRole("button", { name: "Notizen schliessen" }),
    );
    expect(queryWindow()).toBeNull();
  });

  it("closes the window on Escape", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    expect(queryWindow()).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(queryWindow()).toBeNull();
  });

  it("stays open on an outside click (windowed behaviour)", () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <NotesPanel />
      </div>,
    );
    fireEvent.click(toggleButton());
    expect(queryWindow()).toBeTruthy();
    // A floating window must NOT close just because the user clicks elsewhere.
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(queryWindow()).toBeTruthy();
  });

  it("defaults to the global tab when no sessions or favorites exist", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    expect(
      screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs..."),
    ).toBeTruthy();
  });

  it("shows the stored global notes value", () => {
    useSettingsStore.setState({ globalNotes: "My global notes" });
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    fireEvent.click(screen.getByText("Globale Notizen"));
    const textarea = screen.getByPlaceholderText(
      "Globale Stichsaetze, Ideen, TODOs...",
    );
    expect((textarea as HTMLTextAreaElement).value).toBe("My global notes");
  });

  it("updates global notes on textarea change", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    fireEvent.click(screen.getByText("Globale Notizen"));
    const textarea = screen.getByPlaceholderText(
      "Globale Stichsaetze, Ideen, TODOs...",
    );
    fireEvent.change(textarea, { target: { value: "Updated notes" } });
    expect(useSettingsStore.getState().globalNotes).toBe("Updated notes");
  });

  it("shows project notes when a session is active", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Test",
          folder: "C:\\Projects\\test",
          shell: "powershell",
          status: "running",
          createdAt: Date.now(),
          finishedAt: null,
          exitCode: null,
          lastOutputAt: Date.now(),
          lastOutputSnippet: "",
        },
      ],
      activeSessionId: "s1",
    });
    useSettingsStore.setState({
      projectNotes: { "c:/projects/test": "Project note content" },
    });

    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const textarea = screen.getByPlaceholderText(
      "Notizen für dieses Projekt...",
    );
    expect((textarea as HTMLTextAreaElement).value).toBe(
      "Project note content",
    );
  });

  it("shows the folder picker when favorites exist but no session is active", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "fav-1",
          path: "C:\\Projects\\fav",
          label: "Favorite Proj",
          shell: "powershell",
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
          groupId: null,
          sortIndex: 0,
        },
      ],
    });

    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    fireEvent.click(screen.getByLabelText("Projekt-Notizen"));
    // Concept B: picker is a small "Projektordner wechseln" link, dropdown is
    // expanded explicitly. Folder identity lives in the tab label (verified
    // separately) so the picker text never duplicates the folder name.
    const picker = screen.getByLabelText("Projektordner wechseln");
    expect(picker.textContent).toBe("Projektordner wechseln");
    fireEvent.click(picker);
    // After expansion the link toggles to "Ordner-Wahl schliessen" + the
    // dropdown shows the favorite's user-supplied label.
    expect(picker.textContent).toBe("Ordner-Wahl schliessen");
    expect(screen.getByText("Favorite Proj")).toBeTruthy();
  });

  it("highlights the toggle button when notes exist", () => {
    useSettingsStore.setState({ globalNotes: "Some notes" });
    render(<NotesPanel />);
    expect(toggleButton().className).toContain("text-accent");
  });

  it("moves the window when its explicit drag-handle is dragged", () => {
    // The new affordance: a small drag-handle in the bottom-left corner,
    // mirroring the resize-handle in the bottom-right. Drag is EXCLUSIVELY
    // via this handle — no more "drag from anywhere non-interactive".
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const win = screen.getByRole("dialog", { name: "Notizen" });
    const before = win.style.left;

    const handle = screen.getByRole("button", {
      name: "Notizen-Fenster verschieben",
    });
    fireEvent.pointerDown(handle, {
      clientX: 100,
      clientY: 400,
      pointerId: 5,
    });
    fireEvent.pointerMove(handle, {
      clientX: 260,
      clientY: 240,
      pointerId: 5,
    });
    fireEvent.pointerUp(handle, {
      clientX: 260,
      clientY: 240,
      pointerId: 5,
    });

    expect(win.style.left).not.toBe(before);
  });

  it("does not move when the window-container itself receives a pointer-down", () => {
    // Drag is exclusively via the explicit bottom-left handle. Pointer-down
    // on the window-container chrome (border, empty space) must NOT start a
    // drag — that's the previous "drag everywhere" model we replaced.
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const win = screen.getByRole("dialog", { name: "Notizen" });
    const before = win.style.left;

    fireEvent.pointerDown(win, { clientX: 600, clientY: 80, pointerId: 3 });
    fireEvent.pointerMove(win, { clientX: 460, clientY: 240, pointerId: 3 });
    fireEvent.pointerUp(win, { clientX: 460, clientY: 240, pointerId: 3 });

    expect(win.style.left).toBe(before);
  });

  it("does not start a drag when pointer-down targets the textarea", () => {
    // The interactive-element guard now covers textareas too, so clicking
    // into the notes textarea must never nudge the window.
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    fireEvent.click(screen.getByLabelText("Globale Notizen"));
    const win = screen.getByRole("dialog", { name: "Notizen" });
    const before = win.style.left;
    const textarea = screen.getByPlaceholderText(
      "Globale Stichsaetze, Ideen, TODOs...",
    );

    fireEvent.pointerDown(textarea, {
      clientX: 600,
      clientY: 200,
      pointerId: 4,
    });
    fireEvent.pointerMove(textarea, {
      clientX: 460,
      clientY: 360,
      pointerId: 4,
    });

    expect(win.style.left).toBe(before);
  });

  it("does not move when the tab bar itself receives a pointer-down", () => {
    // Same regression-guard as above, but on the tab bar (which was the
    // drag-surface in the previous iteration). Drag must now only fire via
    // the explicit drag-handle in the bottom-left.
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const win = screen.getByRole("dialog", { name: "Notizen" });
    const before = win.style.left;

    const tabBar = win.firstElementChild as HTMLElement;
    fireEvent.pointerDown(tabBar, {
      clientX: 600,
      clientY: 80,
      pointerId: 1,
    });
    fireEvent.pointerMove(tabBar, {
      clientX: 460,
      clientY: 240,
      pointerId: 1,
    });
    fireEvent.pointerUp(tabBar, {
      clientX: 460,
      clientY: 240,
      pointerId: 1,
    });

    expect(win.style.left).toBe(before);
  });

  it("does not start a drag when the pointer-down targets the close button", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const win = screen.getByRole("dialog", { name: "Notizen" });
    const before = win.style.left;
    const closeBtn = screen.getByRole("button", {
      name: "Notizen schliessen",
    });

    // The close button now lives inside the tab-bar drag-handle. The hook's
    // target.closest("button") guard must ignore the pointer-down so closing
    // does not also nudge the window.
    fireEvent.pointerDown(closeBtn, {
      clientX: 900,
      clientY: 80,
      pointerId: 2,
    });
    fireEvent.pointerMove(win.firstElementChild as HTMLElement, {
      clientX: 700,
      clientY: 80,
      pointerId: 2,
    });

    expect(win.style.left).toBe(before);
  });

  it("does not show label span in sidebar variant", () => {
    const { container } = render(<NotesPanel variant="sidebar" />);
    // Sidebar variant is icon-only — no inline "Notizen" text span
    expect(container.querySelector("span.text-xs")).toBeNull();
  });

  it("does not highlight button when no notes exist", () => {
    const { container } = render(<NotesPanel />);
    const button = container.querySelector("button");
    expect(button?.className).toContain("text-neutral-400");
  });

  it("shows project notes dot when project notes exist", () => {
    useSettingsStore.setState({
      projectNotes: { "c:/projects/x": "content" },
    });
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    const projectTab = screen.getByLabelText("Projekt-Notizen");
    expect(projectTab.querySelector("span.bg-accent")).toBeTruthy();
  });

  it("updates project notes on textarea change when session active", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Test",
          folder: "C:\\Projects\\test",
          shell: "powershell",
          status: "running",
          createdAt: Date.now(),
          finishedAt: null,
          exitCode: null,
          lastOutputAt: Date.now(),
          lastOutputSnippet: "",
        },
      ],
      activeSessionId: "s1",
    });
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));

    const textarea = screen.getByPlaceholderText("Notizen für dieses Projekt...");
    fireEvent.change(textarea, { target: { value: "New project note" } });

    expect(useSettingsStore.getState().projectNotes["c:/projects/test"]).toBe(
      "New project note",
    );
  });

  it("hides folder picker when a session is active", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Test",
          folder: "C:\\Projects\\test",
          shell: "powershell",
          status: "running",
          createdAt: Date.now(),
          finishedAt: null,
          exitCode: null,
          lastOutputAt: Date.now(),
          lastOutputSnippet: "",
        },
      ],
      activeSessionId: "s1",
    });
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    // Folder picker placeholder must not appear when session is active
    expect(screen.queryByText("Projekt wählen...")).toBeNull();
  });

  it("shows empty state on project tab without context or folders", () => {
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    fireEvent.click(screen.getByLabelText("Projekt-Notizen"));
    expect(screen.getByText("Keine Projekte vorhanden")).toBeTruthy();
  });

  it("switches back to global tab from project tab", () => {
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    fireEvent.click(screen.getByLabelText("Projekt-Notizen"));
    fireEvent.click(screen.getByText("Globale Notizen"));
    expect(screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs...")).toBeTruthy();
  });

  it("selects a different folder from the picker dropdown", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "fav-1",
          path: "C:\\Projects\\alpha",
          label: "Alpha",
          shell: "powershell",
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
          groupId: null,
          sortIndex: 0,
        },
        {
          id: "fav-2",
          path: "C:\\Projects\\beta",
          label: "Beta",
          shell: "powershell",
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
          groupId: null,
          sortIndex: 1000,
        },
      ],
    });
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    fireEvent.click(screen.getByLabelText("Projekt-Notizen"));

    // Concept B: picker trigger is a tiny "Projektordner wechseln" link; the
    // ACTIVE folder lives in the tab label (where the tab aria-label is
    // "Projekt-Notizen" + label-text reflects the auto-selected short name).
    const picker = screen.getByLabelText("Projektordner wechseln");
    const projectTab = screen.getByLabelText("Projekt-Notizen");
    expect(projectTab.textContent).toContain("alpha");

    fireEvent.click(picker);
    fireEvent.click(screen.getByText("Beta"));
    // After selection: tab-label switches to the chosen folder.
    expect(projectTab.textContent).toContain("beta");
  });

  it("auto-selects the folder that has notes over the first folder", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "fav-1",
          path: "C:\\Projects\\alpha",
          label: "Alpha",
          shell: "powershell",
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
          groupId: null,
          sortIndex: 0,
        },
        {
          id: "fav-2",
          path: "C:\\Projects\\beta",
          label: "Beta",
          shell: "powershell",
          addedAt: Date.now(),
          lastUsedAt: Date.now(),
          groupId: null,
          sortIndex: 1000,
        },
      ],
      projectNotes: { "c:/projects/beta": "Beta has notes" },
    });
    render(<NotesPanel />);
    fireEvent.click(screen.getByLabelText("Notizen"));
    fireEvent.click(screen.getByLabelText("Projekt-Notizen"));

    // Beta has notes, so it should be auto-selected and its notes shown
    const textarea = screen.getByPlaceholderText(
      "Notizen für dieses Projekt...",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Beta has notes");
  });

  it("keeps the user's tab choice when an active session emits output", () => {
    // Regression: NotesPanel's open-tab-default useEffect re-fired on every
    // activeSession ref change. updateLastOutput spreads the session object on
    // each PTY-output chunk → new ref → useEffect ran setActiveTab("project")
    // and erased the user's manual click on "Globale Notizen".
    useSessionStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Test",
          folder: "C:\\Projects\\test",
          shell: "powershell",
          status: "running",
          createdAt: Date.now(),
          finishedAt: null,
          exitCode: null,
          lastOutputAt: Date.now(),
          lastOutputSnippet: "",
        },
      ],
      activeSessionId: "s1",
    });

    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    // Default after open with an active session: project tab.
    expect(
      screen.getByPlaceholderText("Notizen für dieses Projekt..."),
    ).toBeTruthy();

    // User switches to the global tab.
    fireEvent.click(screen.getByText("Globale Notizen"));
    expect(
      screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs..."),
    ).toBeTruthy();

    // Real session-output path: new chunk → updateLastOutput → new session ref.
    act(() => {
      useSessionStore.getState().updateLastOutput("s1", "new chunk");
    });

    // Tab must stay on global — the useEffect must not override the manual choice.
    expect(
      screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs..."),
    ).toBeTruthy();
    expect(
      screen.queryByPlaceholderText("Notizen für dieses Projekt..."),
    ).toBeNull();
  });

  it("applies the persisted notesWindowSize from settingsStore", () => {
    useSettingsStore.setState({
      notesWindowSize: { w: 600, h: 480 },
    });
    render(<NotesPanel />);
    fireEvent.click(toggleButton());

    const win = queryWindow();
    expect(win).toBeTruthy();
    // Hook initializes from store; window-container reflects the live size.
    expect((win as HTMLElement).style.width).toBe("600px");
    expect((win as HTMLElement).style.height).toBe("480px");
  });

  it("renders a resize handle in the open window", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    expect(
      screen.getByRole("button", { name: "Notizen-Fenster vergroessern" }),
    ).toBeTruthy();
  });

  it("renders the active project's short name as the project-tab label", () => {
    useSessionStore.setState({
      sessions: [
        {
          id: "s1",
          title: "Test",
          folder: "C:\\Projects\\smashq",
          shell: "powershell",
          status: "running",
          createdAt: Date.now(),
          finishedAt: null,
          exitCode: null,
          lastOutputAt: Date.now(),
          lastOutputSnippet: "",
        },
      ],
      activeSessionId: "s1",
    });
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    // Tab is identified by its stable aria-label, but its visible text is the
    // active folder's short name — no longer the generic "Projekt-Notizen".
    const projectTab = screen.getByLabelText("Projekt-Notizen");
    expect(projectTab.textContent).toContain("smashq");
    expect(projectTab.textContent).not.toContain("Projekt-Notizen");
  });

  it("falls back to the generic project-tab label without a folder context", () => {
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    const projectTab = screen.getByLabelText("Projekt-Notizen");
    expect(projectTab.textContent).toContain("Projekt-Notizen");
  });

  it("does not switch tabs when the resize handle is dragged", () => {
    // Pointer-capture stubs live in beforeEach.
    render(<NotesPanel />);
    fireEvent.click(toggleButton());
    // Switch to global tab so a regression that resets to project would show.
    fireEvent.click(screen.getByText("Globale Notizen"));
    expect(
      screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs..."),
    ).toBeTruthy();

    const handle = screen.getByRole("button", {
      name: "Notizen-Fenster vergroessern",
    });
    fireEvent.pointerDown(handle, { clientX: 500, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 520, clientY: 420, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 520, clientY: 420, pointerId: 1 });

    // Still on global tab.
    expect(
      screen.getByPlaceholderText("Globale Stichsaetze, Ideen, TODOs..."),
    ).toBeTruthy();
  });
});
