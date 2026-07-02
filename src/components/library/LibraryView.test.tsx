import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LibraryView } from "./LibraryView";
import { useUIStore } from "../../store/uiStore";

// Mock framer-motion to render synchronously (no exit-animation delays)
vi.mock("framer-motion", () => ({
  motion: {
    div: React.forwardRef<
      HTMLDivElement,
      React.PropsWithChildren<Record<string, unknown>>
    >(({ children, ...props }, ref) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
      return (
        <div ref={ref} {...rest}>
          {children as React.ReactNode}
        </div>
      );
    }),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
import { useConfigDiscoveryStore } from "../../store/configDiscoveryStore";
import type { ScopeConfig } from "../../store/configDiscoveryStore";
import { useSettingsStore } from "../../store/settingsStore";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest mock requires runtime cast; vi.MockedFunction<> would need extra setup
const mockUseSettingsStore = useSettingsStore as any;

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("")),
}));

vi.mock("../../store/sessionStore", () => ({
  useSessionStore: vi.fn((sel: (s: unknown) => unknown) =>
    sel({ sessions: [], activeSessionId: null }),
  ),
  selectEffectiveSession: () => null,
}));

vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: vi.fn((sel: CallableFunction) =>
    sel({ favorites: [] }),
  ),
}));

const makeConfig = (overrides?: Partial<ScopeConfig>): ScopeConfig => ({
  skills: [],
  agents: [],
  hooks: [],
  settingsRaw: "",
  claudeMd: "",
  memoryFiles: [],
  rules: [],
  knowledge: [],
  ...overrides,
});

const mockSkill = {
  name: "implement",
  dirName: "implement",
  description: "Issue to PR",
  args: [],
  hasReference: false,
  scope: "global" as const,
  body: "# Implement Skill\nFull body content here.",
};

beforeEach(() => {
  useConfigDiscoveryStore.setState({
    globalConfig: null,
    projectConfig: null,
    projectPath: null,
    favoriteConfigs: {},
    favoritesLoading: {},
    loading: false,
    error: null,
    contentCache: {},
    contentLoading: {},
    selectedDetail: null,
  });
  useUIStore.setState({
    libraryScopeOpen: {},
    librarySectionOpen: {},
  });
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("LibraryView", () => {
  it("renders header with Library title", () => {
    render(<LibraryView />);
    expect(screen.getByText("Library")).toBeTruthy();
  });

  it("shows loading state when discovering", () => {
    useConfigDiscoveryStore.setState({ loading: true });
    render(<LibraryView />);
    expect(screen.getByText("Scanne Konfigurationen...")).toBeTruthy();
  });

  it("shows empty state when no configs found and not loading", () => {
    // Override discoverGlobal to not trigger loading
    useConfigDiscoveryStore.setState({
      loading: false,
      globalConfig: null,
      projectConfig: null,
    });
    // Replace discoverGlobal with a no-op to prevent useEffect from triggering loading
    const store = useConfigDiscoveryStore.getState();
    useConfigDiscoveryStore.setState({
      ...store,
      discoverGlobal: vi.fn(async () => {}),
      discoverProject: vi.fn(async () => {}),
    });
    render(<LibraryView />);
    expect(screen.getByText("Keine Konfigurationen gefunden")).toBeTruthy();
  });

  it("renders global scope panel with skills", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });

    render(<LibraryView />);
    const panelHeader = screen.getByText("Global (~/.claude/)");
    expect(panelHeader).toBeTruthy();
    // Panel starts collapsed — click to expand scope, then expand Skills section
    fireEvent.click(panelHeader.closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    expect(screen.getByText("implement")).toBeTruthy();
    expect(screen.getByText("Issue to PR")).toBeTruthy();
  });

  it("renders agents in global config", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        agents: [
          { name: "architect", model: "opus", description: "", scope: "global" },
        ],
      }),
    });

    render(<LibraryView />);
    const panelHeader = screen.getByText("Global (~/.claude/)");
    fireEvent.click(panelHeader.closest("button")!);
    fireEvent.click(screen.getByText("Agents").closest("button")!);
    expect(screen.getByText("architect")).toBeTruthy();
    expect(screen.getByText("opus")).toBeTruthy();
  });

  it("renders hooks in global config", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        hooks: [
          {
            event: "PreToolUse",
            matcher: "Bash",
            command: "node safe-guard.mjs",
            scope: "global",
            source: "settings.json",
          },
        ],
      }),
    });

    render(<LibraryView />);
    const panelHeader = screen.getByText("Global (~/.claude/)");
    fireEvent.click(panelHeader.closest("button")!);
    fireEvent.click(screen.getByText("Hooks").closest("button")!);
    expect(screen.getByText("PreToolUse")).toBeTruthy();
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("node safe-guard.mjs")).toBeTruthy();
  });

  it("renders refresh button", () => {
    render(<LibraryView />);
    const refreshBtn = screen.getByTitle("Neu laden");
    expect(refreshBtn).toBeTruthy();
  });

  it("renders favorite project panels when favorites exist", () => {
    // Override settingsStore mock to return favorites
    mockUseSettingsStore.mockImplementation(
      (sel: CallableFunction) =>
        sel({
          favorites: [
            {
              id: "fav-1",
              path: "C:/Projects/my-app",
              label: "My App",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
          ],
        }),
    );

    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      favoriteConfigs: {
        "C:/Projects/my-app": makeConfig({
          skills: [
            {
              name: "deploy",
              dirName: "deploy",
              description: "Deploy app",
              args: [],
              hasReference: false,
              scope: "project",
              body: "# Deploy\nDeploy instructions.",
            },
          ],
          claudeMd: "# My App Config",
        }),
      },
      discoverFavorites: vi.fn(async () => {}),
    });

    render(<LibraryView />);
    const panelHeader = screen.getByText(/My App/);
    expect(panelHeader).toBeTruthy();
    // Panel starts collapsed — click to expand scope, then expand Skills section
    fireEvent.click(panelHeader.closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    expect(screen.getByText("deploy")).toBeTruthy();
  });

  it("does not render favorite panel when config is not yet loaded", () => {
    mockUseSettingsStore.mockImplementation(
      (sel: CallableFunction) =>
        sel({
          favorites: [
            {
              id: "fav-2",
              path: "C:/Projects/other-app",
              label: "Other App",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
          ],
        }),
    );

    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      favoriteConfigs: {}, // Config not loaded yet
      discoverFavorites: vi.fn(async () => {}),
    });

    render(<LibraryView />);
    // "Other App" should not appear since config is not loaded
    expect(screen.queryByText(/Other App/)).toBeNull();
  });

  it("hides a favorite project panel whose config is empty", () => {
    mockUseSettingsStore.mockImplementation(
      (sel: CallableFunction) =>
        sel({
          favorites: [
            {
              id: "fav-3",
              path: "C:/Projects/empty-app",
              label: "Empty App",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
          ],
        }),
    );

    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      favoriteConfigs: { "C:/Projects/empty-app": makeConfig() },
      discoverFavorites: vi.fn(async () => {}),
    });

    render(<LibraryView />);
    expect(screen.queryByText(/Empty App/)).toBeNull();
    expect(
      screen.getByText("1 Projekt ohne Konfiguration ausgeblendet"),
    ).toBeTruthy();
  });

  it("counts multiple hidden projects in the footnote (plural)", () => {
    mockUseSettingsStore.mockImplementation(
      (sel: CallableFunction) =>
        sel({
          favorites: [
            {
              id: "fav-4",
              path: "C:/Projects/empty-a",
              label: "Empty A",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
            {
              id: "fav-5",
              path: "C:/Projects/empty-b",
              label: "Empty B",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
          ],
        }),
    );

    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      favoriteConfigs: {
        "C:/Projects/empty-a": makeConfig(),
        "C:/Projects/empty-b": makeConfig(),
      },
      discoverFavorites: vi.fn(async () => {}),
    });

    render(<LibraryView />);
    expect(screen.queryByText(/Empty A/)).toBeNull();
    expect(screen.queryByText(/Empty B/)).toBeNull();
    expect(
      screen.getByText("2 Projekte ohne Konfiguration ausgeblendet"),
    ).toBeTruthy();
  });

  it("shows no footnote when all favorite projects have content", () => {
    mockUseSettingsStore.mockImplementation(
      (sel: CallableFunction) =>
        sel({
          favorites: [
            {
              id: "fav-6",
              path: "C:/Projects/full-app",
              label: "Full App",
              shell: "powershell",
              addedAt: 1000,
              lastUsedAt: 2000,
            },
          ],
        }),
    );

    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      favoriteConfigs: {
        "C:/Projects/full-app": makeConfig({ claudeMd: "# Full" }),
      },
      discoverFavorites: vi.fn(async () => {}),
    });

    render(<LibraryView />);
    expect(screen.getByText(/Full App/)).toBeTruthy();
    expect(screen.queryByText(/ohne Konfiguration ausgeblendet/)).toBeNull();
  });

  // ── Modal Integration Tests ──────────────────────────────────────────

  it("opens detail modal when skill card is clicked", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });

    render(<LibraryView />);
    // Panel starts collapsed — expand scope, then expand Skills section
    const panelHeader = screen.getByText("Global (~/.claude/)");
    fireEvent.click(panelHeader.closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    // skill name appears in the card button
    const skillButton = screen.getByRole("button", { name: /implement/i });
    fireEvent.click(skillButton);

    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("detail modal closes when close button is clicked", async () => {
    // Open modal via store action directly
    useConfigDiscoveryStore.getState().openDetail({ category: "skills", item: mockSkill });

    render(<LibraryView />);
    expect(screen.getByRole("dialog")).toBeTruthy();

    const closeBtn = screen.getByLabelText("Schliessen");
    fireEvent.click(closeBtn);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("detail modal shows skill name in header", () => {
    useConfigDiscoveryStore.getState().openDetail({ category: "skills", item: mockSkill });

    render(<LibraryView />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // skill name appears in the modal header (in addition to card in background)
    const allImplementTexts = screen.getAllByText("implement");
    expect(allImplementTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("closes detail modal on Escape key", async () => {
    useConfigDiscoveryStore.getState().openDetail({ category: "skills", item: mockSkill });

    render(<LibraryView />);
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ScopePanel expand state persists across component remount", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });

    // Pre-set the global scope AND the skills section as open in the store
    // (sections default to collapsed after baecf4f)
    useUIStore.getState().setLibraryScopeOpen("global", true);
    useUIStore.getState().setLibrarySectionOpen("global:skills", true);

    // First mount — panel + section should be open (state from store)
    const { unmount } = render(<LibraryView />);
    // Skills section should be visible without clicking because scope+section are expanded
    expect(screen.getByText("implement")).toBeTruthy();
    unmount();

    // Second mount (simulates navigation/restart) — state is still in store
    render(<LibraryView />);
    // Panel should still be expanded — no click needed
    expect(screen.getByText("implement")).toBeTruthy();
  });

  // ── Discovery effects ────────────────────────────────────────────────

  it("calls discoverGlobal on mount", () => {
    const mockDiscover = vi.fn(async () => {});
    useConfigDiscoveryStore.setState({ discoverGlobal: mockDiscover });
    render(<LibraryView />);
    expect(mockDiscover).toHaveBeenCalled();
  });

  it("does not call discoverProject when there is no active folder", () => {
    const mockDiscoverProject = vi.fn(async () => {});
    useConfigDiscoveryStore.setState({
      discoverGlobal: vi.fn(async () => {}),
      discoverProject: mockDiscoverProject,
    });
    render(<LibraryView />);
    expect(mockDiscoverProject).not.toHaveBeenCalled();
  });

  it("refresh button triggers discoverGlobal again", () => {
    const mockDiscover = vi.fn(async () => {});
    useConfigDiscoveryStore.setState({ discoverGlobal: mockDiscover });
    render(<LibraryView />);
    mockDiscover.mockClear();
    fireEvent.click(screen.getByTitle("Neu laden"));
    expect(mockDiscover).toHaveBeenCalledTimes(1);
  });

  // ── Scope panel rendering ────────────────────────────────────────────

  it("shows 'Keine Konfiguration gefunden' for an empty global config", () => {
    useConfigDiscoveryStore.setState({ globalConfig: makeConfig() });
    render(<LibraryView />);
    expect(screen.getByText("Global (~/.claude/)")).toBeTruthy();
    expect(screen.getByText("Keine Konfiguration gefunden")).toBeTruthy();
  });

  it("collapsed scope panel hides section content until clicked", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });
    render(<LibraryView />);
    // Panel collapsed by default — skill not visible
    expect(screen.queryByText("implement")).toBeNull();
    // Section header also hidden until scope expanded
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("clicking scope header expands then collapses the panel", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });
    render(<LibraryView />);
    const header = screen.getByText("Global (~/.claude/)").closest("button")!;

    fireEvent.click(header);
    expect(screen.getByText("Skills")).toBeTruthy();

    fireEvent.click(header);
    expect(screen.queryByText("Skills")).toBeNull();
  });

  it("hides a section whose count is zero", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    // Skills section present, Agents/Hooks absent (count 0)
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.queryByText("Agents")).toBeNull();
    expect(screen.queryByText("Hooks")).toBeNull();
  });

  it("renders Settings section when settingsRaw is present", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ settingsRaw: '{"foo":1}' }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders CLAUDE.md section when claudeMd is present", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ claudeMd: "# Global Rules" }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    expect(screen.getByText("CLAUDE.md")).toBeTruthy();
  });

  it("renders Memory section when memory files are present", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        memoryFiles: [{ name: "MEMORY.md", relativePath: "memory/MEMORY.md" }],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    expect(screen.getByText("Memory")).toBeTruthy();
  });

  it("expands a memory file card to reveal its name preview", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        memoryFiles: [{ name: "MEMORY.md", relativePath: "memory/MEMORY.md" }],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Memory").closest("button")!);
    // Memory file card present
    expect(screen.getByText("MEMORY.md")).toBeTruthy();
  });

  it("shows skill ref/ badge when skill hasReference", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        skills: [{ ...mockSkill, hasReference: true }],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    expect(screen.getByText("ref/")).toBeTruthy();
  });

  it("falls back to body preview when skill has no description", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        skills: [
          {
            ...mockSkill,
            name: "nodesc",
            dirName: "nodesc",
            description: "",
            body: "# Heading\nPlain preview text from body.",
          },
        ],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    expect(screen.getByText(/Plain preview text from body/)).toBeTruthy();
  });

  it("renders the active session project panel", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig(),
      projectConfig: makeConfig({ skills: [mockSkill] }),
    });
    render(<LibraryView />);
    // No active folder via mocked sessionStore, so project panel must NOT render
    expect(screen.queryByText(/Projekt \(/)).toBeNull();
  });

  it("shows agent description when present", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        agents: [
          {
            name: "reviewer",
            model: "sonnet",
            description: "Reviews pull requests",
            scope: "global",
          },
        ],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Agents").closest("button")!);
    expect(screen.getByText("Reviews pull requests")).toBeTruthy();
    expect(screen.getByText("sonnet")).toBeTruthy();
  });

  it("renders hook source label", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({
        hooks: [
          {
            event: "PostToolUse",
            matcher: "",
            command: "echo done",
            scope: "global",
            source: "hooks.json",
          },
        ],
      }),
    });
    render(<LibraryView />);
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Hooks").closest("button")!);
    expect(screen.getByText("PostToolUse")).toBeTruthy();
    expect(screen.getByText("hooks.json")).toBeTruthy();
  });

  it("does not render dialog when no detail is selected", () => {
    useConfigDiscoveryStore.setState({
      globalConfig: makeConfig({ skills: [mockSkill] }),
    });
    render(<LibraryView />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
