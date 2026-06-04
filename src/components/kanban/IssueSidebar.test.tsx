import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueSidebar } from "./IssueSidebar";
import type { KanbanLabel } from "./KanbanCard";

// ── Helpers ───────────────────────────────────────────────────────────

const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString("de-DE") : "";

const defaultLabels: KanbanLabel[] = [
  { name: "bug", color: "d73a4a" },
];

// ── Tests ─────────────────────────────────────────────────────────────

describe("IssueSidebar", () => {
  it("renders author", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("shows 'Niemand zugewiesen' when assignees is empty", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Niemand zugewiesen")).toBeTruthy();
  });

  it("renders a single assignee", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={["bob"]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.queryByText("Niemand zugewiesen")).toBeNull();
  });

  it("renders all assignees when multiple are present", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={["bob", "carol", "dave"]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("carol")).toBeTruthy();
    expect(screen.getByText("dave")).toBeTruthy();
  });

  it("renders labels with names", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={defaultLabels}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("bug")).toBeTruthy();
  });

  it("hides labels section when labels is empty", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText("Labels")).toBeNull();
  });

  it("renders milestone when present", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone="v2.0"
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("v2.0")).toBeTruthy();
  });

  it("hides milestone section when milestone is null", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText("Milestone")).toBeNull();
  });

  it("renders created date via formatDate", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    // formatDate renders as "15.03.2026" with de-DE locale
    expect(screen.getByText(/Erstellt:/)).toBeTruthy();
  });

  it("renders closed date when closedAt is set", () => {
    render(
      <IssueSidebar
        state="CLOSED"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-20T14:00:00Z"
        closedAt="2026-03-20T14:00:00Z"
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText(/Geschlossen:/)).toBeTruthy();
  });

  it("hides closed date when closedAt is empty", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText(/Geschlossen:/)).toBeNull();
  });

  // ── Author branch ────────────────────────────────────────────────────

  it("hides author section when author is empty", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author=""
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText("Autor")).toBeNull();
  });

  it("renders the 'Autor' section header when author is present", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Autor")).toBeTruthy();
  });

  // ── Dates branch ─────────────────────────────────────────────────────

  it("always renders the 'Datum' section header", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt=""
        updatedAt=""
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Datum")).toBeTruthy();
  });

  it("hides created date when createdAt is empty", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt=""
        updatedAt=""
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText(/Erstellt:/)).toBeNull();
  });

  it("renders updated date when updatedAt differs from createdAt", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-18T12:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText(/Geändert:/)).toBeTruthy();
  });

  it("hides updated date when updatedAt equals createdAt", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText(/Geändert:/)).toBeNull();
  });

  it("formats the created date via the provided formatDate fn", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={() => "FORMATTED_STAMP"}
      />,
    );

    expect(screen.getByText("Erstellt: FORMATTED_STAMP")).toBeTruthy();
  });

  // ── Assignees branch ─────────────────────────────────────────────────

  it("always renders the 'Zugewiesen' section header", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Zugewiesen")).toBeTruthy();
  });

  it("renders one row per assignee", () => {
    const { container } = render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={["bob", "carol"]}
        labels={[]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("bob")).toBeTruthy();
    expect(screen.getByText("carol")).toBeTruthy();
    expect(container.querySelector("p.italic")).toBeNull();
  });

  // ── Labels branch ────────────────────────────────────────────────────

  it("renders the 'Labels' section header when labels exist", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={defaultLabels}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Labels")).toBeTruthy();
  });

  it("renders multiple labels each with its name", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[
          { name: "bug", color: "d73a4a" },
          { name: "enhancement", color: "a2eeef" },
        ]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("enhancement")).toBeTruthy();
  });

  it("applies labelStyle colors to label spans", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[{ name: "bug", color: "d73a4a" }]}
        milestone={null}
        formatDate={formatDate}
      />,
    );

    const span = screen.getByText("bug").closest("span")!;
    expect(span.style.color).toBe("rgb(215, 58, 74)");
  });

  // ── Milestone branch ─────────────────────────────────────────────────

  it("renders the 'Milestone' section header when milestone is present", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone="Sprint 5"
        formatDate={formatDate}
      />,
    );

    expect(screen.getByText("Milestone")).toBeTruthy();
    expect(screen.getByText("Sprint 5")).toBeTruthy();
  });

  it("hides milestone section when milestone is an empty string", () => {
    render(
      <IssueSidebar
        state="OPEN"
        author="alice"
        createdAt="2026-03-15T10:00:00Z"
        updatedAt="2026-03-15T10:00:00Z"
        closedAt=""
        assignees={[]}
        labels={[]}
        milestone=""
        formatDate={formatDate}
      />,
    );

    expect(screen.queryByText("Milestone")).toBeNull();
  });
});
