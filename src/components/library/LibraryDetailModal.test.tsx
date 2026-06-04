import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryDetailModal } from "./LibraryDetailModal";
import {
  useConfigDiscoveryStore,
  type DiscoveredKnowledge,
} from "../../store/configDiscoveryStore";

const knowledge: DiscoveredKnowledge = {
  name: "frontend-xss",
  filename: "frontend-xss.md",
  category: "security",
  relativePath: "knowledge/security/frontend-xss.md",
  body: "knowledge body content",
  fileType: "md",
};

beforeEach(() => {
  useConfigDiscoveryStore.setState({ selectedDetail: null });
});

describe("LibraryDetailModal", () => {
  it("does not render the detail when nothing is selected", () => {
    render(<LibraryDetailModal />);
    expect(screen.queryByText("frontend-xss")).toBeNull();
  });

  it("renders the detail header title when a detail is selected", () => {
    useConfigDiscoveryStore.setState({
      selectedDetail: { category: "knowledge", item: knowledge },
    });
    render(<LibraryDetailModal />);
    expect(screen.getByText("frontend-xss")).toBeTruthy();
  });

  it("renders the category as the scope badge for knowledge details", () => {
    useConfigDiscoveryStore.setState({
      selectedDetail: { category: "knowledge", item: knowledge },
    });
    render(<LibraryDetailModal />);
    expect(screen.getByText("security")).toBeTruthy();
  });

  it("derives the scope badge from the category for any knowledge item", () => {
    useConfigDiscoveryStore.setState({
      selectedDetail: {
        category: "knowledge",
        item: { ...knowledge, category: "templates", name: "tmpl-entry" },
      },
    });
    render(<LibraryDetailModal />);
    expect(screen.getByText("tmpl-entry")).toBeTruthy();
    expect(screen.getByText("templates")).toBeTruthy();
  });
});
