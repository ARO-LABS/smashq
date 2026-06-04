import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LibraryDetailContent } from "./LibraryDetailContent";
import type { SelectedDetail } from "../../store/configDiscoveryStore";

const mockSkill = {
  name: "weather-fetcher",
  dirName: "weather-fetcher",
  description: "Fetches weather data",
  args: [
    { name: "city", description: "City name", required: true },
    { name: "unit", description: "Celsius or Fahrenheit", required: false },
  ],
  hasReference: true,
  scope: "global" as const,
  body: "# Instructions\nCall Open-Meteo API with the given city.",
};

const skillDetail: SelectedDetail = { category: "skills", item: mockSkill };

// ── Tests ─────────────────────────────────────────────────────────────

describe("LibraryDetailContent", () => {
  it("renders skill name in frontmatter table", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("weather-fetcher")).toBeTruthy();
  });

  it("renders skill description in frontmatter table", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("Fetches weather data")).toBeTruthy();
  });

  it("renders required arg with asterisk badge", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("city*")).toBeTruthy();
  });

  it("renders optional arg without asterisk", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("unit")).toBeTruthy();
  });

  it("renders scope badge", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("global")).toBeTruthy();
  });

  it("renders markdown body via MarkdownPreview", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    // markdown-it renders "# Instructions" as an h1
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Instructions");
  });

  it("renders InstancePanel placeholder in right column", () => {
    render(<LibraryDetailContent detail={skillDetail} />);
    expect(screen.getByText("Best Practices")).toBeTruthy();
  });

  it("renders placeholder for non-skill categories in M1", () => {
    const agentDetail: SelectedDetail = {
      category: "agents",
      item: { name: "test-agent", model: "opus", description: "", scope: "global" },
    };
    render(<LibraryDetailContent detail={agentDetail} />);
    expect(screen.getByText(/kommt in M2/)).toBeTruthy();
  });

  it("renders description as body fallback when body is empty", () => {
    const emptyBodyDetail: SelectedDetail = {
      category: "skills",
      item: { ...mockSkill, body: "" },
    };
    render(<LibraryDetailContent detail={emptyBodyDetail} />);
    // description ("Fetches weather data") is used as markdown fallback — rendered via MarkdownPreview
    expect(screen.getAllByText("Fetches weather data").length).toBeGreaterThan(0);
    expect(screen.queryByText("Kein Inhalt vorhanden")).toBeNull();
  });

  it("renders empty body placeholder only when both body and description are empty", () => {
    const noContentDetail: SelectedDetail = {
      category: "skills",
      item: { ...mockSkill, body: "", description: "" },
    };
    render(<LibraryDetailContent detail={noContentDetail} />);
    expect(screen.getByText("Kein Inhalt vorhanden")).toBeTruthy();
  });
});
