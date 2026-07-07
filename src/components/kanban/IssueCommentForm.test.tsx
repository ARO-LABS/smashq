import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IssueCommentForm } from "./IssueCommentForm";
import { invoke } from "@tauri-apps/api/core";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/adpError", () => ({
  getErrorMessage: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

// ── Helpers ───────────────────────────────────────────────────────────

const mockInvoke = vi.mocked(invoke);

// ── Tests ─────────────────────────────────────────────────────────────

describe("IssueCommentForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders textarea and disabled submit button when empty", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    expect(textarea).toBeTruthy();

    const button = screen.getByText("Kommentar posten");
    expect(button).toHaveProperty("disabled", true);
  });

  it("enables submit button when body has text", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });

    const button = screen.getByText("Kommentar posten");
    expect(button).toHaveProperty("disabled", false);
  });

  it("keeps submit disabled when body is only whitespace", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "   " } });

    const button = screen.getByText("Kommentar posten");
    expect(button).toHaveProperty("disabled", true);
  });

  it("calls post_issue_comment and onCommentPosted on successful submit", async () => {
    const onCommentPosted = vi.fn();
    mockInvoke.mockResolvedValueOnce(undefined);

    render(
      <IssueCommentForm
        folder="/test"
        repository={null}
        issueNumber={42}
        onCommentPosted={onCommentPosted}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "Great fix!" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(onCommentPosted).toHaveBeenCalledOnce();
    });

    expect(mockInvoke).toHaveBeenCalledWith("post_issue_comment", {
      folder: "/test",
      repo: null,
      number: 42,
      body: "Great fix!",
    });
  });

  it("clears textarea after successful submit", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "My comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe("");
    });
  });

  it("shows error message on failed submit", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Network timeout"));

    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("Network timeout")).toBeTruthy();
    });
  });

  it("does not call onCommentPosted on failed submit", async () => {
    const onCommentPosted = vi.fn();
    mockInvoke.mockRejectedValueOnce(new Error("fail"));

    render(
      <IssueCommentForm
        folder="/test"
        repository={null}
        issueNumber={42}
        onCommentPosted={onCommentPosted}
      />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("fail")).toBeTruthy();
    });

    expect(onCommentPosted).not.toHaveBeenCalled();
  });

  it("shows submitting state while posting", async () => {
    let resolve!: (v: undefined) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );

    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    expect(screen.getByText("Wird gesendet…")).toBeTruthy();

    resolve(undefined);

    // Let the post-resolution setState settle inside act()
    await waitFor(() =>
      expect(screen.queryByText("Wird gesendet…")).toBeNull(),
    );
  });

  it("renders the 'Kommentar hinzufügen' header", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    expect(screen.getByText("Kommentar hinzufügen")).toBeTruthy();
  });

  it("does not invoke when submitting an empty body via form submit", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const form = screen.getByText("Kommentar hinzufügen").closest("form")!;
    fireEvent.submit(form);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not invoke when body is only whitespace on submit", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "   \n  " } });
    const form = screen.getByText("Kommentar hinzufügen").closest("form")!;
    fireEvent.submit(form);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("passes repository as repo when folder is null (global board mode)", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    render(
      <IssueCommentForm
        folder={null}
        repository="owner/name"
        issueNumber={7}
        onCommentPosted={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "global comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("post_issue_comment", {
        folder: null,
        repo: "owner/name",
        number: 7,
        body: "global comment",
      });
    });
  });

  it("submits via Ctrl+Enter keyboard shortcut", async () => {
    const onCommentPosted = vi.fn();
    mockInvoke.mockResolvedValueOnce(undefined);
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={onCommentPosted} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "via shortcut" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      expect(onCommentPosted).toHaveBeenCalledOnce();
    });
  });

  it("submits via Meta+Enter keyboard shortcut", async () => {
    const onCommentPosted = vi.fn();
    mockInvoke.mockResolvedValueOnce(undefined);
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={onCommentPosted} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "via meta" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(onCommentPosted).toHaveBeenCalledOnce();
    });
  });

  it("does not submit on plain Enter without a modifier", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "no submit" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not submit on Ctrl with a non-Enter key", () => {
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "no submit" } });
    fireEvent.keyDown(textarea, { key: "a", ctrlKey: true });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("disables the textarea while submitting", async () => {
    let resolve!: (v: undefined) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);

    resolve(undefined);
    await waitFor(() =>
      expect((textarea as HTMLTextAreaElement).disabled).toBe(false),
    );
  });

  it("clears a previous error after a subsequent successful submit", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("first fail"));
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "attempt one" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("first fail")).toBeTruthy();
    });

    mockInvoke.mockResolvedValueOnce(undefined);
    fireEvent.change(textarea, { target: { value: "attempt two" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.queryByText("first fail")).toBeNull();
    });
  });

  it("does not clear the textarea on a failed submit", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("boom"));
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "keep me" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("boom")).toBeTruthy();
    });
    expect((textarea as HTMLTextAreaElement).value).toBe("keep me");
  });

  it("re-enables the submit button after a failed submit", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("err"));
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "retry" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("err")).toBeTruthy();
    });
    expect(screen.getByText("Kommentar posten")).toHaveProperty("disabled", false);
  });

  it("converts a non-Error rejection to a string error message", async () => {
    mockInvoke.mockRejectedValueOnce("plain string failure");
    render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText(/Kommentar verfassen/);
    fireEvent.change(textarea, { target: { value: "A comment" } });
    fireEvent.click(screen.getByText("Kommentar posten"));

    await waitFor(() => {
      expect(screen.getByText("plain string failure")).toBeTruthy();
    });
  });

  it("does not render an error paragraph initially", () => {
    const { container } = render(
      <IssueCommentForm folder="/test" repository={null} issueNumber={42} onCommentPosted={vi.fn()} />,
    );
    expect(container.querySelector("p.text-error")).toBeNull();
  });
});
