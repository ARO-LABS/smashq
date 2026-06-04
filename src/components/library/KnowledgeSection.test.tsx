import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KnowledgeSection } from "./KnowledgeSection";
import { useUIStore } from "../../store/uiStore";
import type { DiscoveredKnowledge } from "../../store/configDiscoveryStore";

const writeText = vi.fn().mockResolvedValue(undefined);

const entry = (over: Partial<DiscoveredKnowledge> = {}): DiscoveredKnowledge => ({
  name: "frontend-xss",
  filename: "frontend-xss.md",
  category: "general",
  relativePath: "knowledge/frontend-xss.md",
  body: "knowledge body",
  fileType: "md",
  ...over,
});

beforeEach(() => {
  useUIStore.setState({ librarySectionOpen: {} });
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe("KnowledgeSection", () => {
  it("renders nothing when there is no knowledge", () => {
    const { container } = render(
      <KnowledgeSection knowledge={[]} sectionKey="k" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Knowledge label and entry count", () => {
    render(
      <KnowledgeSection
        knowledge={[entry(), entry({ relativePath: "b.md" })]}
        sectionKey="k"
      />,
    );
    expect(screen.getByText("Knowledge")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("keeps the section collapsed by default", () => {
    render(
      <KnowledgeSection
        knowledge={[entry({ name: "hidden-entry" })]}
        sectionKey="k"
      />,
    );
    expect(screen.queryByText("hidden-entry")).toBeNull();
  });

  it("expands the section when the header is clicked", () => {
    render(
      <KnowledgeSection
        knowledge={[entry({ name: "shown-entry" })]}
        sectionKey="k"
      />,
    );
    fireEvent.click(screen.getByText("Knowledge"));
    expect(screen.getByText("shown-entry")).toBeTruthy();
  });

  it("persists the open state into the UI store", () => {
    render(<KnowledgeSection knowledge={[entry()]} sectionKey="key-x" />);
    fireEvent.click(screen.getByText("Knowledge"));
    expect(useUIStore.getState().librarySectionOpen["key-x"]).toBe(true);
  });

  it("groups entries under their category headings", () => {
    useUIStore.setState({ librarySectionOpen: { k: true } });
    render(
      <KnowledgeSection
        knowledge={[
          entry({ category: "security", relativePath: "s.md" }),
          entry({ category: "templates", relativePath: "t.md" }),
        ]}
        sectionKey="k"
      />,
    );
    expect(screen.getByText("Security Checklists")).toBeTruthy();
    expect(screen.getByText("Templates")).toBeTruthy();
  });

  it("reveals an entry body when its card is expanded", () => {
    useUIStore.setState({ librarySectionOpen: { k: true } });
    const { container } = render(
      <KnowledgeSection
        knowledge={[entry({ name: "e1", body: "the entry detail body" })]}
        sectionKey="k"
      />,
    );
    fireEvent.click(screen.getByText("e1"));
    expect(container.querySelector("pre")?.textContent).toBe(
      "the entry detail body",
    );
  });

  it("copies the entry body to the clipboard via the copy button", () => {
    useUIStore.setState({ librarySectionOpen: { k: true } });
    render(
      <KnowledgeSection
        knowledge={[entry({ name: "e1", body: "copy me" })]}
        sectionKey="k"
      />,
    );
    fireEvent.click(
      screen.getByLabelText("e1 in Zwischenablage kopieren"),
    );
    expect(writeText).toHaveBeenCalledWith("copy me");
  });
});
