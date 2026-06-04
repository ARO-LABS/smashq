import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FavoritePreview } from "./FavoritePreview";
import { useUIStore } from "../../store/uiStore";

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

describe("FavoritePreview", () => {
  beforeEach(() => {
    useUIStore.setState({ configSubTab: "claude-md" });
  });

  it("renders project name extracted from folder path", () => {
    render(
      <FavoritePreview folder="C:/Projects/my-app" onClose={vi.fn()} />,
    );
    expect(screen.getByText("my-app")).toBeTruthy();
  });

  it("displays the full folder path in the header", () => {
    render(
      <FavoritePreview folder="C:/Projects/my-app" onClose={vi.fn()} />,
    );
    // Path appears in both the header span (with title attr) and the mocked tab list
    const pathSpan = screen.getByTitle("C:/Projects/my-app");
    expect(pathSpan.textContent).toBe("C:/Projects/my-app");
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <FavoritePreview folder="/test/project" onClose={onClose} />,
    );

    fireEvent.click(screen.getByLabelText("Preview schließen"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders config panel content with correct folder and tab", () => {
    useUIStore.setState({ configSubTab: "skills" });
    render(
      <FavoritePreview folder="/my/folder" onClose={vi.fn()} />,
    );

    expect(screen.getByTestId("config-panel-content").textContent).toBe("/my/folder|skills");
  });

  it("handles folder path with trailing slash", () => {
    render(
      <FavoritePreview folder="C:/Projects/test/" onClose={vi.fn()} />,
    );
    // Last non-empty segment is "test"
    expect(screen.getByText("test")).toBeTruthy();
  });
});
