import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ConfigPanelTabList } from "./ConfigPanelTabList";

// Mock Tauri dialog plugin
const mockDialogOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockDialogOpen(...args),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock Tauri core invoke — per-test implementation swapped via mockInvoke below.
const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

// ── Mutable mock store state ────────────────────────────────────────────
// The stores are mocked (matching the existing file convention), but the
// backing state objects are mutable so individual tests can drive behaviour:
// flip `hasDirtyEditor`, change `configSubTab`, seed pins, and capture the
// setter/toast spies. Defined via `vi.hoisted` so the hoisted `vi.mock`
// factories below can safely reference them.

interface PinDoc {
  id: string;
  relativePath: string;
  label: string;
}

const { uiState, settingsState } = vi.hoisted(() => ({
  uiState: {
    configSubTab: "claude-md" as string,
    setConfigSubTab: vi.fn(),
    addToast: vi.fn(),
    hasDirtyEditor: false,
  },
  settingsState: {
    pinnedDocs: {} as Record<string, PinDoc[]>,
    addPinnedDoc: vi.fn(),
    removePinnedDoc: vi.fn(),
    renamePinnedDoc: vi.fn(),
  },
}));

function resetMockStores() {
  uiState.configSubTab = "claude-md";
  uiState.setConfigSubTab = vi.fn();
  uiState.addToast = vi.fn();
  uiState.hasDirtyEditor = false;
  settingsState.pinnedDocs = {};
  settingsState.addPinnedDoc = vi.fn();
  settingsState.removePinnedDoc = vi.fn();
  settingsState.renamePinnedDoc = vi.fn();
}

// Mock stores — selectors read from the mutable state objects above.
vi.mock("../../store/uiStore", () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(uiState as unknown as Record<string, unknown>),
}));

vi.mock("../../store/settingsStore", () => {
  const useSettingsStore = (selector: (s: Record<string, unknown>) => unknown) =>
    selector(settingsState as unknown as Record<string, unknown>);
  // getState() used inside handleAddPin to re-read pins after add.
  (useSettingsStore as unknown as { getState: () => typeof settingsState }).getState =
    () => settingsState;
  return {
    useSettingsStore,
    normalizeProjectKey: (f: string) => f.replace(/\\/g, "/").toLowerCase(),
  };
});

/**
 * Helper to build an invoke implementation for the 5 Tauri commands fired by
 * ConfigPanelTabList's presence-detection useEffect.
 *
 * Defaults simulate an "empty" project (no artifacts, no git/github), which
 * lets tests override only the fields they care about.
 */
function makeInvokeImpl(overrides: {
  claudeMd?: string;
  skills?: unknown[];
  agents?: string[];
  settings?: string;
  projectPresence?:
    | { has_git: boolean; has_github: boolean; remote_url: string | null }
    | Promise<never>;
}) {
  return (cmd: string) => {
    switch (cmd) {
      case "read_project_file":
        // Called for both CLAUDE.md and settings.json — differentiate by argument order.
        // We simplify: return empty string by default, tests set claudeMd/settings together.
        return Promise.resolve(overrides.claudeMd ?? "");
      case "list_skill_dirs":
        return Promise.resolve(overrides.skills ?? []);
      case "list_project_dir":
        return Promise.resolve(overrides.agents ?? []);
      case "check_project_presence":
        if (overrides.projectPresence instanceof Promise) return overrides.projectPresence;
        return Promise.resolve(
          overrides.projectPresence ?? {
            has_git: false,
            has_github: false,
            remote_url: null,
          },
        );
      default:
        return Promise.resolve(undefined);
    }
  };
}

/**
 * More accurate invoke impl that routes read_project_file by its `relativePath`
 * argument so CLAUDE.md and settings.json can be mocked independently.
 */
function makeInvokeImplDetailed(overrides: {
  claudeMd?: string;
  skills?: unknown[];
  agents?: string[];
  settings?: string;
  projectPresence?:
    | { has_git: boolean; has_github: boolean; remote_url: string | null };
  projectPresenceReject?: boolean;
}) {
  return (cmd: string, args?: { relativePath?: string }) => {
    switch (cmd) {
      case "read_project_file":
        if (args?.relativePath === "CLAUDE.md") {
          return Promise.resolve(overrides.claudeMd ?? "");
        }
        if (args?.relativePath === ".claude/settings.json") {
          return Promise.resolve(overrides.settings ?? "");
        }
        return Promise.resolve("");
      case "list_skill_dirs":
        return Promise.resolve(overrides.skills ?? []);
      case "list_project_dir":
        return Promise.resolve(overrides.agents ?? []);
      case "check_project_presence":
        if (overrides.projectPresenceReject) {
          return Promise.reject(new Error("presence unavailable"));
        }
        return Promise.resolve(
          overrides.projectPresence ?? {
            has_git: false,
            has_github: false,
            remote_url: null,
          },
        );
      default:
        return Promise.resolve(undefined);
    }
  };
}

describe("ConfigPanelTabList", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockDialogOpen.mockReset();
    resetMockStores();
    // Default: empty project, no git, no github.
    mockInvoke.mockImplementation(makeInvokeImpl({}));
  });

  it("renders all 7 fixed tabs while presence is loading (anti-flash)", () => {
    // Presence-detection useEffect runs on mount but awaits async work —
    // first render happens with presence === null, so all tabs must be visible.
    render(<ConfigPanelTabList folder="/test" />);

    expect(screen.getByTitle("CLAUDE.md")).toBeTruthy();
    expect(screen.getByTitle("Skills")).toBeTruthy();
    expect(screen.getByTitle("Hooks")).toBeTruthy();
    expect(screen.getByTitle("GitHub")).toBeTruthy();
    expect(screen.getByTitle("Worktrees")).toBeTruthy();
    expect(screen.getByTitle("History")).toBeTruthy();
    // Kanban is no longer a config-sidebar tab (it lives in its own window).
    expect(screen.queryByTitle("Kanban")).toBeNull();
  });

  it("renders group separators between tab groups", () => {
    const { container } = render(<ConfigPanelTabList folder="/test" />);

    // Group separators are 1px-wide divs with bg-neutral-700
    const separators = container.querySelectorAll(".w-px.bg-neutral-700");
    // Expect 2 separators: context|project, project|history
    expect(separators.length).toBe(2);
  });

  it("highlights active tab with accent color", () => {
    render(<ConfigPanelTabList folder="/test" />);

    const claudeTab = screen.getByTitle("CLAUDE.md");
    expect(claudeTab.className).toContain("text-accent");
    // a30 statt a10 — die aktive Markierung muss deckend genug sein (#Grid-Farben)
    expect(claudeTab.className).toContain("bg-accent-a30");
  });

  it("renders non-active tabs with neutral color", () => {
    render(<ConfigPanelTabList folder="/test" />);

    const skillsTab = screen.getByTitle("Skills");
    expect(skillsTab.className).toContain("text-neutral-400");
    expect(skillsTab.className).not.toContain("text-accent");
  });

  it("renders add-pin button", () => {
    render(<ConfigPanelTabList folder="/test" />);

    expect(screen.getByTitle("Markdown-Datei anpinnen")).toBeTruthy();
  });

  it("renders GitHub tab when has_github=true and has_git=true", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({
        projectPresence: {
          has_git: true,
          has_github: true,
          remote_url: "https://github.com/foo/bar.git",
        },
      }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("GitHub")).toBeTruthy();
      expect(screen.getByTitle("Worktrees")).toBeTruthy();
    });
  });

  it("hides GitHub/Worktrees when has_github=false and has_git=false", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({
        projectPresence: {
          has_git: false,
          has_github: false,
          remote_url: null,
        },
      }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    // Wait for presence resolution (History always visible — reliable waypoint).
    await waitFor(() => {
      expect(screen.queryByTitle("GitHub")).toBeNull();
    });
    expect(screen.queryByTitle("Worktrees")).toBeNull();
    expect(screen.queryByTitle("Kanban")).toBeNull();
    expect(screen.getByTitle("History")).toBeTruthy();
  });

  it("shows Worktrees but hides GitHub when has_git=true and has_github=false", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({
        projectPresence: {
          has_git: true,
          has_github: false,
          remote_url: null,
        },
      }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    // All assertions inside one waitFor — presenceFlags resolution is async,
    // and a positive-only waitFor leaves the negative checks in a race window
    // on slow CI runners (CI run #26515714743 caught the initial-render state
    // where all tabs were still visible before the presence filter applied).
    await waitFor(() => {
      expect(screen.getByTitle("Worktrees")).toBeTruthy();
      expect(screen.queryByTitle("GitHub")).toBeNull();
      expect(screen.queryByTitle("Kanban")).toBeNull();
    });
  });

  it("hides all project-group tabs when check_project_presence rejects (safe default)", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({
        projectPresenceReject: true,
      }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    // Wait for the effect to settle (presence resolves to safe default).
    await waitFor(() => {
      expect(screen.queryByTitle("GitHub")).toBeNull();
    });
    expect(screen.queryByTitle("Worktrees")).toBeNull();
    expect(screen.queryByTitle("Kanban")).toBeNull();
  });

  // ── Presence-driven context tabs ───────────────────────────────────────

  it("shows CLAUDE.md tab only when CLAUDE.md file has content", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({ claudeMd: "# Project" }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("CLAUDE.md")).toBeTruthy();
    });
  });

  it("hides CLAUDE.md tab when CLAUDE.md is empty", async () => {
    mockInvoke.mockImplementation(makeInvokeImplDetailed({ claudeMd: "" }));

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.queryByTitle("CLAUDE.md")).toBeNull();
    });
    // History is presence-independent — always present after resolution.
    expect(screen.getByTitle("History")).toBeTruthy();
  });

  it("shows Skills tab when at least one skill dir exists", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({ skills: ["skill-a", "skill-b"] }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("Skills")).toBeTruthy();
    });
  });

  it("shows Agents tab when .claude/agents has .md files", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({ agents: ["reviewer.md", "planner.md"] }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("Agents")).toBeTruthy();
    });
  });

  it("shows Hooks tab when settings.json contains a non-empty hooks object", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({
        settings: JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*" }] } }),
      }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("Hooks")).toBeTruthy();
    });
  });

  it("hides Hooks tab when settings.json has an empty hooks object", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({ settings: JSON.stringify({ hooks: {} }) }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      // Settings tab appears (settings.json non-empty) — reliable waypoint.
      expect(screen.getByTitle("Settings")).toBeTruthy();
    });
    expect(screen.queryByTitle("Hooks")).toBeNull();
  });

  it("hides Hooks tab when settings.json is invalid JSON", async () => {
    mockInvoke.mockImplementation(
      makeInvokeImplDetailed({ settings: "{ not valid json" }),
    );

    render(<ConfigPanelTabList folder="/test" />);

    await waitFor(() => {
      expect(screen.getByTitle("Settings")).toBeTruthy();
    });
    expect(screen.queryByTitle("Hooks")).toBeNull();
  });

  // ── Tab switching ──────────────────────────────────────────────────────

  it("clicking a tab calls setConfigSubTab with the tab id", () => {
    render(<ConfigPanelTabList folder="/test" />);

    fireEvent.click(screen.getByTitle("History"));

    expect(uiState.setConfigSubTab).toHaveBeenCalledWith("history");
  });

  it("switching tabs is blocked when editor is dirty and confirm is cancelled", () => {
    uiState.hasDirtyEditor = true;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("History"));

    expect(confirmSpy).toHaveBeenCalled();
    expect(uiState.setConfigSubTab).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("switching tabs proceeds when editor is dirty and confirm is accepted", () => {
    uiState.hasDirtyEditor = true;
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("History"));

    expect(uiState.setConfigSubTab).toHaveBeenCalledWith("history");
    confirmSpy.mockRestore();
  });

  it("clicking the already-active tab does not prompt even when editor is dirty", () => {
    uiState.hasDirtyEditor = true;
    uiState.configSubTab = "history";
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("History"));

    // newTab === configSubTab → no confirm guard.
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(uiState.setConfigSubTab).toHaveBeenCalledWith("history");
    confirmSpy.mockRestore();
  });

  // ── Pinned docs ────────────────────────────────────────────────────────

  it("renders pinned-doc tabs from the settings store", () => {
    settingsState.pinnedDocs = {
      "/test": [
        { id: "p1", relativePath: "docs/guide.md", label: "Guide" },
        { id: "p2", relativePath: "docs/api.md", label: "API" },
      ],
    };

    render(<ConfigPanelTabList folder="/test" />);

    expect(screen.getByText("Guide")).toBeTruthy();
    expect(screen.getByText("API")).toBeTruthy();
  });

  it("clicking a pin tab activates the pin via setConfigSubTab", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByText("Guide"));

    expect(uiState.setConfigSubTab).toHaveBeenCalledWith("pin:p1");
  });

  it("removing a pin calls removePinnedDoc and emits an info toast", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByLabelText("Pin Guide entfernen"));

    expect(settingsState.removePinnedDoc).toHaveBeenCalledWith("/test", "p1");
    expect(uiState.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "info", title: "Pin entfernt" }),
    );
  });

  it("double-clicking a pin enters inline rename mode", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.doubleClick(screen.getByText("Guide"));

    const input = screen.getByLabelText("Pin-Label bearbeiten") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Guide");
  });

  it("committing a rename via Enter calls renamePinnedDoc with the trimmed value", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.doubleClick(screen.getByText("Guide"));

    const input = screen.getByLabelText("Pin-Label bearbeiten");
    fireEvent.change(input, { target: { value: "  Renamed Guide  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(settingsState.renamePinnedDoc).toHaveBeenCalledWith(
      "/test",
      "p1",
      "Renamed Guide",
    );
  });

  it("Escape during rename cancels without calling renamePinnedDoc", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.doubleClick(screen.getByText("Guide"));

    const input = screen.getByLabelText("Pin-Label bearbeiten");
    fireEvent.change(input, { target: { value: "Discarded" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(settingsState.renamePinnedDoc).not.toHaveBeenCalled();
    // Back to button view.
    expect(screen.getByText("Guide")).toBeTruthy();
  });

  it("renaming to an empty/whitespace value does not call renamePinnedDoc", () => {
    settingsState.pinnedDocs = {
      "/test": [{ id: "p1", relativePath: "docs/guide.md", label: "Guide" }],
    };

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.doubleClick(screen.getByText("Guide"));

    const input = screen.getByLabelText("Pin-Label bearbeiten");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(settingsState.renamePinnedDoc).not.toHaveBeenCalled();
  });

  // ── Add-pin flow ───────────────────────────────────────────────────────

  it("cancelling the file picker (no selection) adds no pin", async () => {
    mockDialogOpen.mockResolvedValue(null);

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("Markdown-Datei anpinnen"));

    await waitFor(() => {
      expect(mockDialogOpen).toHaveBeenCalled();
    });
    expect(settingsState.addPinnedDoc).not.toHaveBeenCalled();
  });

  it("rejects a picked file located outside the project folder", async () => {
    mockDialogOpen.mockResolvedValue("/other/project/readme.md");

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("Markdown-Datei anpinnen"));

    await waitFor(() => {
      expect(uiState.addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Datei außerhalb des Projekts",
        }),
      );
    });
    expect(settingsState.addPinnedDoc).not.toHaveBeenCalled();
  });

  it("pins a valid in-project file and emits a success toast", async () => {
    mockDialogOpen.mockResolvedValue("/test/docs/notes.md");
    settingsState.addPinnedDoc = vi.fn().mockReturnValue(null); // success → no error

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("Markdown-Datei anpinnen"));

    await waitFor(() => {
      expect(settingsState.addPinnedDoc).toHaveBeenCalledWith(
        "/test",
        "docs/notes.md",
      );
    });
    expect(uiState.addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Angepinnt" }),
    );
  });

  it("surfaces an error toast when addPinnedDoc reports a failure", async () => {
    mockDialogOpen.mockResolvedValue("/test/docs/notes.md");
    settingsState.addPinnedDoc = vi
      .fn()
      .mockReturnValue("Maximale Anzahl an Pins erreicht");

    render(<ConfigPanelTabList folder="/test" />);
    fireEvent.click(screen.getByTitle("Markdown-Datei anpinnen"));

    await waitFor(() => {
      expect(uiState.addToast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Pin fehlgeschlagen",
          message: "Maximale Anzahl an Pins erreicht",
        }),
      );
    });
  });

  // ── isPrimary gating ───────────────────────────────────────────────────

  it("non-primary instance does not auto-switch the shared tab when active tab is hidden", async () => {
    // configSubTab "claude-md" but CLAUDE.md is absent → tab hidden.
    uiState.configSubTab = "claude-md";
    mockInvoke.mockImplementation(makeInvokeImplDetailed({ claudeMd: "" }));

    render(<ConfigPanelTabList folder="/test" isPrimary={false} />);

    await waitFor(() => {
      expect(screen.queryByTitle("CLAUDE.md")).toBeNull();
    });
    // Non-primary must not mutate the shared store.
    expect(uiState.setConfigSubTab).not.toHaveBeenCalled();
  });

  it("primary instance auto-switches away from a now-hidden active tab", async () => {
    uiState.configSubTab = "claude-md";
    mockInvoke.mockImplementation(makeInvokeImplDetailed({ claudeMd: "" }));

    render(<ConfigPanelTabList folder="/test" isPrimary />);

    // claude-md hidden → effect switches to first visible tab.
    await waitFor(() => {
      expect(uiState.setConfigSubTab).toHaveBeenCalled();
    });
  });

  it("renders nothing presence-related and stays inert for an empty folder string", () => {
    render(<ConfigPanelTabList folder="" />);

    // Empty folder short-circuits presence detection (presence stays null),
    // so all fixed tabs render and no invoke fires.
    expect(screen.getByTitle("History")).toBeTruthy();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
