import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { KanbanCard, type KanbanIssue } from "./KanbanCard";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

vi.mock("../../utils/errorLogger", () => ({
  logWarn: vi.fn(),
}));

// ── Helpers ───────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<KanbanIssue> = {}): KanbanIssue {
  return {
    itemId: "PVTI_test42",
    number: 42,
    title: "Implement feature X",
    state: "OPEN",
    labels: [{ name: "bug", color: "d73a4a" }],
    assignee: "alice",
    url: "https://github.com/org/repo/issues/42",
    ...overrides,
  };
}

/**
 * jsdom does not propagate clientX/clientY from fireEvent.pointerMove init
 * into React's SyntheticEvent. Use native PointerEvent constructors instead.
 * Wrap in act() so React state updates (setIsDragging) are flushed synchronously.
 */
function nativePointerDown(element: Element, clientX = 0, clientY = 0) {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX, clientY, button: 0 }),
    );
  });
}

function nativePointerMove(element: Element, clientX: number, clientY = 0) {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX, clientY }),
    );
  });
}

function nativePointerUp(element: Element) {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
    );
  });
}

/** Simulate a full drag gesture beyond the 5px threshold */
function simulateDrag(element: Element, dx = 20) {
  nativePointerDown(element);
  nativePointerMove(element, dx);
  nativePointerUp(element);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("KanbanCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue(undefined);
  });

  it("renders issue number, title, labels, and assignee", () => {
    render(<KanbanCard issue={makeIssue()} />);

    expect(screen.getByText("#42")).toBeTruthy();
    expect(screen.getByText("Implement feature X")).toBeTruthy();
    expect(screen.getByText("bug")).toBeTruthy();
    expect(screen.getByText("alice")).toBeTruthy();
  });

  it("renders multiple labels with correct styling", () => {
    const issue = makeIssue({
      labels: [
        { name: "bug", color: "d73a4a" },
        { name: "priority", color: "#ff0000" },
      ],
    });
    render(<KanbanCard issue={issue} />);

    const bugLabel = screen.getByText("bug");
    expect(bugLabel).toBeTruthy();
    // jsdom normalizes hex to rgb
    expect(bugLabel.style.color).toBe("rgb(215, 58, 74)");

    const priorityLabel = screen.getByText("priority");
    expect(priorityLabel).toBeTruthy();
    expect(priorityLabel.style.color).toBe("rgb(255, 0, 0)");
  });

  it("hides assignee when empty", () => {
    render(<KanbanCard issue={makeIssue({ assignee: "" })} />);
    expect(screen.queryByText("alice")).toBeNull();
  });

  it("calls onClick when card is clicked (no drag)", () => {
    const onClick = vi.fn();
    render(<KanbanCard issue={makeIssue()} onClick={onClick} />);

    fireEvent.click(screen.getByText("Implement feature X"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("card has cursor-grab class for drag affordance", () => {
    const { container } = render(<KanbanCard issue={makeIssue()} />);
    const card = container.firstElementChild!;
    expect(card.className).toContain("cursor-grab");
  });

  it("calls onDragStart when pointer moves beyond threshold", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );

    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 10); // 10px > 5px threshold

    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("does NOT call onDragStart for sub-threshold pointer move", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );

    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 3); // 3px < 5px threshold

    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("calls onDragEnd on pointerUp after a drag", () => {
    const onDragEnd = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragEnd={onDragEnd} />,
    );

    const card = container.firstElementChild!;
    simulateDrag(card);

    expect(onDragEnd).toHaveBeenCalledOnce();
  });

  it("does NOT call onDragEnd when pointerUp follows no drag (pure click)", () => {
    const onDragEnd = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragEnd={onDragEnd} />,
    );

    const card = container.firstElementChild!;
    nativePointerDown(card);
    nativePointerUp(card);

    expect(onDragEnd).not.toHaveBeenCalled();
  });

  it("suppresses onClick during active drag", () => {
    const onClick = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onClick={onClick} />,
    );

    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 10); // drag threshold exceeded → isDraggingRef = true
    fireEvent.click(card);       // click while dragging → suppressed

    expect(onClick).not.toHaveBeenCalled();
  });

  it("opens URL in browser when external link button is clicked", async () => {
    render(<KanbanCard issue={makeIssue()} />);

    const linkButton = screen.getByTitle("Im Browser öffnen");
    fireEvent.click(linkButton);

    expect(mockOpen).toHaveBeenCalledWith(
      "https://github.com/org/repo/issues/42",
    );
  });

  it("does not render external link button when url is empty", () => {
    render(<KanbanCard issue={makeIssue({ url: "" })} />);
    expect(screen.queryByTitle("Im Browser öffnen")).toBeNull();
  });

  it("external link click does not propagate to card onClick", () => {
    const onClick = vi.fn();
    render(<KanbanCard issue={makeIssue()} onClick={onClick} />);

    const linkButton = screen.getByTitle("Im Browser öffnen");
    fireEvent.click(linkButton);

    expect(onClick).not.toHaveBeenCalled();
  });

  // ── Rendering branches ───────────────────────────────────────────────

  it("renders no label spans when labels array is empty", () => {
    const { container } = render(
      <KanbanCard issue={makeIssue({ labels: [] })} />,
    );
    // Label spans carry the rounded-sm border styling
    const labelSpans = container.querySelectorAll("span.rounded-sm");
    expect(labelSpans.length).toBe(0);
  });

  it("renders the repository badge when repository is set", () => {
    render(<KanbanCard issue={makeIssue({ repository: "org/other-repo" })} />);
    expect(screen.getByText("org/other-repo")).toBeTruthy();
  });

  it("does not render the repository badge when repository is null", () => {
    render(<KanbanCard issue={makeIssue({ repository: null })} />);
    expect(screen.queryByText(/\//)).toBeNull();
  });

  it("does not render the repository badge when repository is undefined", () => {
    const { container } = render(<KanbanCard issue={makeIssue()} />);
    // last child is labels row, not a repo badge div
    expect(container.textContent).not.toContain("org/other-repo");
  });

  it("renders a large issue number correctly", () => {
    render(<KanbanCard issue={makeIssue({ number: 99999 })} />);
    expect(screen.getByText("#99999")).toBeTruthy();
  });

  it("applies label background and border colors from hex", () => {
    render(
      <KanbanCard issue={makeIssue({ labels: [{ name: "bug", color: "d73a4a" }] })} />,
    );
    const label = screen.getByText("bug");
    // labelStyle adds 20/40 alpha suffixes → jsdom keeps rgba
    expect(label.style.backgroundColor).toBe("rgba(215, 58, 74, 0.125)");
    expect(label.style.borderColor).toBe("rgba(215, 58, 74, 0.25)");
  });

  it("renders external link button when url is present", () => {
    render(<KanbanCard issue={makeIssue()} />);
    expect(screen.getByTitle("Im Browser öffnen")).toBeTruthy();
  });

  // ── Drag affordance / classes ────────────────────────────────────────

  it("applies opacity-50 and cursor-grabbing classes while dragging", () => {
    const { container } = render(<KanbanCard issue={makeIssue()} />);
    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 20);
    expect(card.className).toContain("opacity-50");
    expect(card.className).toContain("cursor-grabbing");
    expect(card.className).toContain("pointer-events-none");
  });

  it("returns to cursor-grab after pointerUp ends a drag", () => {
    const { container } = render(<KanbanCard issue={makeIssue()} />);
    const card = container.firstElementChild!;
    simulateDrag(card);
    expect(card.className).toContain("cursor-grab");
    expect(card.className).not.toContain("opacity-50");
  });

  it("triggers drag when vertical move exceeds threshold", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );
    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 0, 10); // vertical only
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("calls onDragStart only once across multiple moves", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );
    const card = container.firstElementChild!;
    nativePointerDown(card, 0, 0);
    nativePointerMove(card, 10);
    nativePointerMove(card, 30);
    nativePointerMove(card, 50);
    expect(onDragStart).toHaveBeenCalledOnce();
  });

  it("ignores pointermove when no pointerdown happened first", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );
    const card = container.firstElementChild!;
    nativePointerMove(card, 50); // no preceding pointerdown
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("ignores non-left-button pointerdown (button !== 0)", () => {
    const onDragStart = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onDragStart={onDragStart} />,
    );
    const card = container.firstElementChild!;
    act(() => {
      card.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 0,
          button: 2, // right click
        }),
      );
    });
    nativePointerMove(card, 50);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("allows a click after a completed drag gesture (ref reset)", () => {
    const onClick = vi.fn();
    const { container } = render(
      <KanbanCard issue={makeIssue()} onClick={onClick} />,
    );
    const card = container.firstElementChild!;
    simulateDrag(card);          // full drag, pointerUp resets isDraggingRef
    fireEvent.click(card);        // a subsequent fresh click should pass
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not throw when drag callbacks are omitted", () => {
    const { container } = render(<KanbanCard issue={makeIssue()} />);
    const card = container.firstElementChild!;
    expect(() => simulateDrag(card)).not.toThrow();
  });

  it("does not throw when onClick is omitted on click", () => {
    render(<KanbanCard issue={makeIssue()} />);
    expect(() => fireEvent.click(screen.getByText("Implement feature X"))).not.toThrow();
  });

  it("logs a warning when shell.open rejects", async () => {
    const { logWarn } = await import("../../utils/errorLogger");
    mockOpen.mockRejectedValueOnce(new Error("no shell"));
    render(<KanbanCard issue={makeIssue()} />);
    fireEvent.click(screen.getByTitle("Im Browser öffnen"));
    await act(async () => {});
    expect(logWarn).toHaveBeenCalledWith(
      "KanbanCard",
      expect.stringContaining("shell.open failed"),
    );
  });
});
