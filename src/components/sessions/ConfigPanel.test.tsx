import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfigPanel } from "./ConfigPanel";
import { useUIStore } from "../../store/uiStore";

// Mock lazy-loaded child components to avoid async loading in tests
vi.mock("./configPanelShared", () => ({
  ConfigPanelContent: ({ folder, activeTab }: { folder: string; activeTab: string }) => (
    <div data-testid="config-panel-content">{`${folder}|${activeTab}`}</div>
  ),
}));

vi.mock("./ConfigPanelTabList", () => ({
  ConfigPanelTabList: ({ folder }: { folder: string }) => (
    <div data-testid="config-panel-tab-list">{folder}</div>
  ),
}));

describe("ConfigPanel", () => {
  beforeEach(() => {
    useUIStore.setState({ configSubTab: "claude-md", configPanelOpen: true });
  });

  it("renders tab list, close button, and content", () => {
    render(<ConfigPanel folder="/test/project" />);

    expect(screen.getByTestId("config-panel-tab-list")).toBeTruthy();
    expect(screen.getByTestId("config-panel-content")).toBeTruthy();
    expect(screen.getByLabelText("Konfig-Panel schließen")).toBeTruthy();
  });

  it("calls setConfigPanelOpen(false) when close button is clicked", () => {
    render(<ConfigPanel folder="/test/project" />);

    fireEvent.click(screen.getByLabelText("Konfig-Panel schließen"));
    expect(useUIStore.getState().configPanelOpen).toBe(false);
  });

  it("applies custom width when provided", () => {
    const { container } = render(<ConfigPanel folder="/test/project" width={500} />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.width).toBe("500px");
  });

  it("uses default width of 400 when not provided", () => {
    const { container } = render(<ConfigPanel folder="/test/project" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.width).toBe("400px");
  });
});
