import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { IssueComments, type IssueComment } from "./IssueComments";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("../editor/MarkdownPreview", () => ({
  MarkdownBody: ({ content }: { content: string }) => (
    <span data-testid="markdown-body">{content}</span>
  ),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makeComment(overrides: Partial<IssueComment> = {}): IssueComment {
  return {
    id: "IC_kwDODefault",
    author: "alice",
    body: "Default body",
    created_at: "2024-01-15T10:00:00Z",
    ...overrides,
  };
}

const formatDate = (iso: string) => iso;

// ── Tests ─────────────────────────────────────────────────────────────

describe("IssueComments", () => {
  it("renders nothing when comments array is empty", () => {
    const { container } = render(
      <IssueComments comments={[]} formatDate={formatDate} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the correct comment count for a single comment", () => {
    const { getByText } = render(
      <IssueComments
        comments={[makeComment()]}
        formatDate={formatDate}
      />,
    );
    expect(getByText(/1 Kommentar/)).toBeTruthy();
  });

  it("renders the correct comment count for multiple comments", () => {
    const comments = [
      makeComment({ id: "IC_kwDO001" }),
      makeComment({ id: "IC_kwDO002" }),
      makeComment({ id: "IC_kwDO003" }),
    ];
    const { getByText } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );
    expect(getByText(/3 Kommentare/)).toBeTruthy();
  });

  it("uses comment.id as React key — two comments from same author at same time both render", () => {
    // Bug-Szenario: gleicher Author, gleicher Timestamp, aber unterschiedliche IDs.
    // Ohne id-basierten Key wuerden React-Key-Kollisionen entstehen.
    const comments: IssueComment[] = [
      {
        id: "IC_kwDOFirst111",
        author: "bob",
        body: "First comment",
        created_at: "2024-01-15T10:00:00Z",
      },
      {
        id: "IC_kwDOSecond222",
        author: "bob",
        body: "Second comment",
        created_at: "2024-01-15T10:00:00Z",
      },
    ];

    const { getAllByTestId, getByText } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );

    // Beide Kommentare muessen im DOM erscheinen
    const bodies = getAllByTestId("markdown-body");
    expect(bodies).toHaveLength(2);
    expect(getByText("First comment")).toBeTruthy();
    expect(getByText("Second comment")).toBeTruthy();
  });

  it("renders author name and formatted date for each comment", () => {
    const comment = makeComment({
      id: "IC_kwDOTest",
      author: "charlie",
      created_at: "2026-04-16T12:30:00Z",
    });
    const { getByText } = render(
      <IssueComments comments={[comment]} formatDate={(iso) => `formatted:${iso}`} />,
    );
    expect(getByText("charlie")).toBeTruthy();
    expect(getByText("formatted:2026-04-16T12:30:00Z")).toBeTruthy();
  });

  it("renders the MessageSquare icon in the header", () => {
    const { container } = render(
      <IssueComments comments={[makeComment()]} formatDate={formatDate} />,
    );
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("passes comment.body to MarkdownBody verbatim", () => {
    const comment = makeComment({ body: "## Heading\n\n- item" });
    const { getByTestId } = render(
      <IssueComments comments={[comment]} formatDate={formatDate} />,
    );
    expect(getByTestId("markdown-body").textContent).toBe("## Heading\n\n- item");
  });

  it("renders one MarkdownBody per comment", () => {
    const comments = [
      makeComment({ id: "IC_a" }),
      makeComment({ id: "IC_b" }),
      makeComment({ id: "IC_c" }),
      makeComment({ id: "IC_d" }),
    ];
    const { getAllByTestId } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );
    expect(getAllByTestId("markdown-body")).toHaveLength(4);
  });

  it("calls formatDate once per comment with the raw created_at", () => {
    const fmt = vi.fn((iso: string) => `D:${iso}`);
    const comments = [
      makeComment({ id: "IC_1", created_at: "2024-02-01T00:00:00Z" }),
      makeComment({ id: "IC_2", created_at: "2024-03-02T00:00:00Z" }),
    ];
    render(<IssueComments comments={comments} formatDate={fmt} />);
    expect(fmt).toHaveBeenCalledTimes(2);
    expect(fmt).toHaveBeenCalledWith("2024-02-01T00:00:00Z");
    expect(fmt).toHaveBeenCalledWith("2024-03-02T00:00:00Z");
  });

  it("renders distinct authors for each comment", () => {
    const comments = [
      makeComment({ id: "IC_x", author: "dave" }),
      makeComment({ id: "IC_y", author: "erin" }),
    ];
    const { getByText } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );
    expect(getByText("dave")).toBeTruthy();
    expect(getByText("erin")).toBeTruthy();
  });

  it("renders an empty author string without crashing", () => {
    const comment = makeComment({ author: "" });
    const { getAllByTestId } = render(
      <IssueComments comments={[comment]} formatDate={formatDate} />,
    );
    expect(getAllByTestId("markdown-body")).toHaveLength(1);
  });

  it("renders an empty body string without crashing", () => {
    const comment = makeComment({ body: "" });
    const { getByTestId } = render(
      <IssueComments comments={[comment]} formatDate={formatDate} />,
    );
    expect(getByTestId("markdown-body").textContent).toBe("");
  });

  it("uses singular 'Kommentar' label only at exactly one comment", () => {
    const { queryByText } = render(
      <IssueComments comments={[makeComment()]} formatDate={formatDate} />,
    );
    expect(queryByText(/Kommentare/)).toBeNull();
    expect(queryByText(/1 Kommentar/)).toBeTruthy();
  });

  it("uses plural 'Kommentare' label for two comments", () => {
    const comments = [makeComment({ id: "IC_p1" }), makeComment({ id: "IC_p2" })];
    const { queryByText } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );
    expect(queryByText(/2 Kommentare/)).toBeTruthy();
  });

  it("renders each comment inside a bordered surface card", () => {
    const { container } = render(
      <IssueComments comments={[makeComment()]} formatDate={formatDate} />,
    );
    expect(container.querySelector(".bg-surface-raised")).toBeTruthy();
  });

  it("preserves comment order in the DOM", () => {
    const comments = [
      makeComment({ id: "IC_o1", body: "alpha" }),
      makeComment({ id: "IC_o2", body: "beta" }),
      makeComment({ id: "IC_o3", body: "gamma" }),
    ];
    const { getAllByTestId } = render(
      <IssueComments comments={comments} formatDate={formatDate} />,
    );
    const bodies = getAllByTestId("markdown-body").map((n) => n.textContent);
    expect(bodies).toEqual(["alpha", "beta", "gamma"]);
  });
});
