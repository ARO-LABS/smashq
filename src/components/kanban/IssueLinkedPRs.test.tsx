import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { open } from "@tauri-apps/plugin-shell";
import { IssueLinkedPRs, type LinkedPR } from "./IssueLinkedPRs";

vi.mock("@tauri-apps/plugin-shell", () => ({
  open: vi.fn(),
}));

const mockOpen = vi.mocked(open);

const pr = (over: Partial<LinkedPR> = {}): LinkedPR => ({
  number: 42,
  title: "Fix the bug",
  state: "OPEN",
  url: "https://github.com/x/y/pull/42",
  checks: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IssueLinkedPRs", () => {
  it("renders nothing when there are no linked PRs", () => {
    const { container } = render(<IssueLinkedPRs linkedPRs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the linked-PRs header", () => {
    render(<IssueLinkedPRs linkedPRs={[pr()]} />);
    expect(screen.getByText("Verknüpfte Pull Requests")).toBeTruthy();
  });

  it("renders the PR number and title", () => {
    render(<IssueLinkedPRs linkedPRs={[pr({ number: 7, title: "Title" })]} />);
    expect(screen.getByText("#7 Title")).toBeTruthy();
  });

  it("opens the PR url in the shell when the title is clicked", () => {
    render(
      <IssueLinkedPRs linkedPRs={[pr({ url: "https://example.com/pr" })]} />,
    );
    fireEvent.click(screen.getByText("#42 Fix the bug"));
    expect(mockOpen).toHaveBeenCalledWith("https://example.com/pr");
  });

  it("labels a merged PR as Merged", () => {
    render(<IssueLinkedPRs linkedPRs={[pr({ state: "MERGED" })]} />);
    expect(screen.getByText("Merged")).toBeTruthy();
  });

  it("labels a closed PR as Closed", () => {
    render(<IssueLinkedPRs linkedPRs={[pr({ state: "CLOSED" })]} />);
    expect(screen.getByText("Closed")).toBeTruthy();
  });

  it("labels an open PR as Open", () => {
    render(<IssueLinkedPRs linkedPRs={[pr({ state: "OPEN" })]} />);
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("renders check names when the PR has checks", () => {
    render(
      <IssueLinkedPRs
        linkedPRs={[
          pr({
            checks: [
              { name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
              { name: "lint", status: "COMPLETED", conclusion: "FAILURE" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("build")).toBeTruthy();
    expect(screen.getByText("lint")).toBeTruthy();
  });

  it("renders multiple linked PRs", () => {
    render(
      <IssueLinkedPRs
        linkedPRs={[
          pr({ number: 1, title: "First" }),
          pr({ number: 2, title: "Second" }),
        ]}
      />,
    );
    expect(screen.getByText("#1 First")).toBeTruthy();
    expect(screen.getByText("#2 Second")).toBeTruthy();
  });
});
