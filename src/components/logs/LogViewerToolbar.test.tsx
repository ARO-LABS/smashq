import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogViewerToolbar, type LogViewerToolbarProps } from "./LogViewerToolbar";

function renderToolbar(overrides: Partial<LogViewerToolbarProps> = {}) {
  const props: LogViewerToolbarProps = {
    severityFilter: new Set(["error", "warn", "info"]),
    sourceFilter: new Set(["frontend", "backend"]),
    searchText: "",
    liveTail: true,
    sortOrder: "desc",
    scope: "session",
    onToggleSeverity: vi.fn(),
    onToggleSource: vi.fn(),
    onSearchChange: vi.fn(),
    onToggleLiveTail: vi.fn(),
    onSetSortOrder: vi.fn(),
    onSetScope: vi.fn(),
    onRefresh: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
  render(<LogViewerToolbar {...props} />);
  return props;
}

describe("LogViewerToolbar", () => {
  it("flips sort order to asc when currently desc", () => {
    const props = renderToolbar({ sortOrder: "desc" });
    fireEvent.click(screen.getByTitle("Sortierung umschalten"));
    expect(props.onSetSortOrder).toHaveBeenCalledWith("asc");
  });

  it("flips scope to all when currently session", () => {
    const props = renderToolbar({ scope: "session" });
    fireEvent.click(screen.getByTitle("Verlauf umschalten"));
    expect(props.onSetScope).toHaveBeenCalledWith("all");
  });

  it("fires onClear when the trash button is clicked", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByTitle("Logs leeren"));
    expect(props.onClear).toHaveBeenCalled();
  });
});
