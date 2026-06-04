import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  MasterDetailViewer,
  DetailSectionHeading,
  DetailBody,
} from "./masterDetailViewer";

const baseProps = {
  title: "Agents",
  count: 3,
  onReload: vi.fn(),
  search: "",
  onSearchChange: vi.fn(),
  filteredEmpty: false,
  filteredEmptyText: "Keine Agents gefunden",
  cards: <div data-testid="cards">card list</div>,
  detail: null as React.ReactNode,
  detailPlaceholder: "Agent waehlen",
};

describe("MasterDetailViewer", () => {
  it("renders the title with the item count", () => {
    render(<MasterDetailViewer {...baseProps} />);
    expect(screen.getByText("Agents (3)")).toBeTruthy();
  });

  it("calls onReload when the reload button is clicked", () => {
    const onReload = vi.fn();
    render(<MasterDetailViewer {...baseProps} onReload={onReload} />);
    fireEvent.click(screen.getByTitle("Neu laden"));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("shows the current search term in the input", () => {
    render(<MasterDetailViewer {...baseProps} search="lint" />);
    expect(screen.getByPlaceholderText("Suchen...")).toHaveValue("lint");
  });

  it("calls onSearchChange when the search input changes", () => {
    const onSearchChange = vi.fn();
    render(
      <MasterDetailViewer {...baseProps} onSearchChange={onSearchChange} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Suchen..."), {
      target: { value: "deploy" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("deploy");
  });

  it("renders the optional filter bar when provided", () => {
    render(
      <MasterDetailViewer
        {...baseProps}
        filterBar={<div data-testid="filter">filter</div>}
      />,
    );
    expect(screen.getByTestId("filter")).toBeTruthy();
  });

  it("renders the cards when the filtered list is not empty", () => {
    render(<MasterDetailViewer {...baseProps} filteredEmpty={false} />);
    expect(screen.getByTestId("cards")).toBeTruthy();
  });

  it("shows the empty-filter message and hides cards when filtered empty", () => {
    render(<MasterDetailViewer {...baseProps} filteredEmpty={true} />);
    expect(screen.getByText("Keine Agents gefunden")).toBeTruthy();
    expect(screen.queryByTestId("cards")).toBeNull();
  });

  it("renders the detail pane content when a detail is provided", () => {
    render(
      <MasterDetailViewer
        {...baseProps}
        detail={<div data-testid="detail">detail content</div>}
      />,
    );
    expect(screen.getByTestId("detail")).toBeTruthy();
  });

  it("shows the placeholder when no detail is selected", () => {
    render(<MasterDetailViewer {...baseProps} detail={null} />);
    expect(screen.getByText("Agent waehlen")).toBeTruthy();
  });
});

describe("DetailSectionHeading", () => {
  it("renders its children as a heading", () => {
    render(<DetailSectionHeading>Metadaten</DetailSectionHeading>);
    expect(screen.getByText("Metadaten").tagName).toBe("H3");
  });
});

describe("DetailBody", () => {
  it("renders the Inhalt label and the body text", () => {
    render(<DetailBody body="the body content" />);
    expect(screen.getByText("Inhalt")).toBeTruthy();
    expect(screen.getByText("the body content")).toBeTruthy();
  });

  it("renders the body inside a pre element", () => {
    const { container } = render(<DetailBody body="mono text" />);
    expect(container.querySelector("pre")?.textContent).toBe("mono text");
  });
});
