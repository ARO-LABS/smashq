import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RulesSection } from "./RulesSection";
import { useUIStore } from "../../store/uiStore";
import type { DiscoveredRule } from "../../store/configDiscoveryStore";

const rule = (over: Partial<DiscoveredRule> = {}): DiscoveredRule => ({
  name: "code-quality",
  filename: "code-quality.md",
  glob: null,
  body: "Rule body text",
  ...over,
});

beforeEach(() => {
  useUIStore.setState({ librarySectionOpen: {} });
});

describe("RulesSection", () => {
  it("renders nothing when there are no rules", () => {
    const { container } = render(
      <RulesSection rules={[]} sectionKey="proj" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Rules label and the rule count", () => {
    render(
      <RulesSection
        rules={[rule(), rule({ filename: "b.md" })]}
        sectionKey="proj"
      />,
    );
    expect(screen.getByText("Rules")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("keeps rule cards collapsed by default", () => {
    render(
      <RulesSection
        rules={[rule({ name: "secret-rule" })]}
        sectionKey="proj"
      />,
    );
    expect(screen.queryByText("secret-rule")).toBeNull();
  });

  it("expands the section when the header is clicked", () => {
    render(
      <RulesSection
        rules={[rule({ name: "shown-rule" })]}
        sectionKey="proj"
      />,
    );
    fireEvent.click(screen.getByText("Rules"));
    expect(screen.getByText("shown-rule")).toBeTruthy();
  });

  it("persists the open state into the UI store", () => {
    render(<RulesSection rules={[rule()]} sectionKey="my-key" />);
    fireEvent.click(screen.getByText("Rules"));
    expect(useUIStore.getState().librarySectionOpen["my-key"]).toBe(true);
  });

  it("shows a 'global' badge for a rule without a glob", () => {
    useUIStore.setState({ librarySectionOpen: { proj: true } });
    render(
      <RulesSection rules={[rule({ glob: null })]} sectionKey="proj" />,
    );
    expect(screen.getByText("global")).toBeTruthy();
  });

  it("shows the glob pattern for a scoped rule", () => {
    useUIStore.setState({ librarySectionOpen: { proj: true } });
    render(
      <RulesSection
        rules={[rule({ glob: "*.ts" })]}
        sectionKey="proj"
      />,
    );
    expect(screen.getByText("*.ts")).toBeTruthy();
  });

  it("reveals the rule body when a rule card is expanded", () => {
    useUIStore.setState({ librarySectionOpen: { proj: true } });
    const { container } = render(
      <RulesSection
        rules={[rule({ name: "r1", body: "the detailed rule body" })]}
        sectionKey="proj"
      />,
    );
    fireEvent.click(screen.getByText("r1"));
    expect(container.querySelector("pre")?.textContent).toBe(
      "the detailed rule body",
    );
  });
});
