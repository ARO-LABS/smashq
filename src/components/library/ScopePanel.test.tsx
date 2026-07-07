import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ICONS } from "../../utils/icons";
import { ScopePanel } from "./ScopePanel";
import { useUIStore } from "../../store/uiStore";
import { useConfigDiscoveryStore } from "../../store/configDiscoveryStore";
import type { ScopeConfig } from "../../store/configDiscoveryStore";

const Globe = ICONS.library.scopeGlobal;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("")),
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

const renderPanel = (config: ScopeConfig) =>
  render(
    <ScopePanel
      scope="global"
      config={config}
      label="Global (~/.claude/)"
      icon={Globe}
      scopeId="global"
      folder="global"
    />,
  );

beforeEach(() => {
  useConfigDiscoveryStore.setState({
    contentCache: {},
    contentLoading: {},
    selectedDetail: null,
  });
  useUIStore.setState({ libraryScopeOpen: {}, librarySectionOpen: {} });
});

describe("ScopePanel", () => {
  it("renders its label", () => {
    renderPanel(makeConfig({ skills: [mockSkill] }));
    expect(screen.getByText("Global (~/.claude/)")).toBeTruthy();
  });

  it("shows 'Keine Konfiguration gefunden' when config is empty", () => {
    renderPanel(makeConfig());
    expect(screen.getByText("Keine Konfiguration gefunden")).toBeTruthy();
  });

  it("keeps section content collapsed until the scope header is clicked", () => {
    renderPanel(makeConfig({ skills: [mockSkill] }));
    // Collapsed by default — section header not in the DOM
    expect(screen.queryByText("Skills")).toBeNull();
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    expect(screen.getByText("Skills")).toBeTruthy();
  });

  it("expands a section and renders its skill card", () => {
    renderPanel(makeConfig({ skills: [mockSkill] }));
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    expect(screen.getByText("implement")).toBeTruthy();
    expect(screen.getByText("Issue to PR")).toBeTruthy();
  });

  it("clicking a skill card opens the detail via the store", () => {
    renderPanel(makeConfig({ skills: [mockSkill] }));
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    fireEvent.click(screen.getByText("Skills").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: /implement/i }));
    expect(useConfigDiscoveryStore.getState().selectedDetail).toMatchObject({
      category: "skills",
    });
  });

  it("hides sections whose count is zero", () => {
    renderPanel(makeConfig({ skills: [mockSkill] }));
    fireEvent.click(screen.getByText("Global (~/.claude/)").closest("button")!);
    expect(screen.getByText("Skills")).toBeTruthy();
    expect(screen.queryByText("Agents")).toBeNull();
    expect(screen.queryByText("Hooks")).toBeNull();
  });
});
