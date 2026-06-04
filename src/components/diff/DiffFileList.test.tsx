import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffFileList } from "./DiffFileList";
import type { DiffFile } from "./types";

const file = (over: Partial<DiffFile> = {}): DiffFile => ({
  path: "src/a.ts",
  status: "modified",
  additions: 0,
  deletions: 0,
  oversize: false,
  ...over,
});

describe("DiffFileList", () => {
  it("shows the file count in the header", () => {
    render(
      <DiffFileList
        files={[file(), file({ path: "src/b.ts" })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Dateien (2)")).toBeTruthy();
  });

  it("shows an empty-state message when there are no files", () => {
    render(<DiffFileList files={[]} selectedIndex={0} onSelect={vi.fn()} />);
    expect(
      screen.getByText("Keine Aenderungen seit Session-Start."),
    ).toBeTruthy();
  });

  it("renders one row per file with its path", () => {
    render(
      <DiffFileList
        files={[file({ path: "x.ts" }), file({ path: "y.ts" })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("x.ts")).toBeTruthy();
    expect(screen.getByText("y.ts")).toBeTruthy();
  });

  it("calls onSelect with the row index when a file is clicked", () => {
    const onSelect = vi.fn();
    render(
      <DiffFileList
        files={[file({ path: "x.ts" }), file({ path: "y.ts" })]}
        selectedIndex={0}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("y.ts"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("marks the selected row with aria-current", () => {
    render(
      <DiffFileList
        files={[file({ path: "x.ts" }), file({ path: "y.ts" })]}
        selectedIndex={1}
        onSelect={vi.fn()}
      />,
    );
    const selected = screen.getByText("y.ts").closest("button");
    expect(selected?.getAttribute("aria-current")).toBe("true");
  });

  it("renders the status glyph for a file", () => {
    render(
      <DiffFileList
        files={[file({ status: "added" })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("shows additions and deletions counts when non-zero", () => {
    render(
      <DiffFileList
        files={[file({ additions: 5, deletions: 3 })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("+5")).toBeTruthy();
    expect(screen.getByText("-3")).toBeTruthy();
  });

  it("hides the counts when both additions and deletions are zero", () => {
    render(
      <DiffFileList
        files={[file({ additions: 0, deletions: 0 })]}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByText("+0")).toBeNull();
  });
});
