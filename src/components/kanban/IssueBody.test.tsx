import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IssueBody } from "./IssueBody";

describe("IssueBody", () => {
  it("shows a placeholder when the body is empty", () => {
    render(<IssueBody body="" />);
    expect(screen.getByText("Keine Beschreibung")).toBeTruthy();
  });

  it("renders the markdown body text when present", () => {
    render(<IssueBody body="Hello issue text" />);
    expect(screen.getByText("Hello issue text")).toBeTruthy();
  });

  it("does not show the placeholder when a body is present", () => {
    render(<IssueBody body="some content" />);
    expect(screen.queryByText("Keine Beschreibung")).toBeNull();
  });

  it("renders markdown headings from the body", () => {
    const { container } = render(<IssueBody body={"# Title\n\nbody"} />);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
  });
});
