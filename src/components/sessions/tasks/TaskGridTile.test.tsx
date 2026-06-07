/**
 * TaskGridTile tests
 *
 * 1. Happy path — popover shows open tasks for the session's project key,
 *    highlights the "next" task with accent styling, and renders the footer.
 * 2. Edge case  — empty state message when no open tasks exist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskGridTile } from "./TaskGridTile";
import { useTasksStore } from "../../../store/tasksStore";
import type { TaskItem } from "../../../store/tasksStore";

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// ── Factory ────────────────────────────────────────────────────────────

const SLOT_MS = 30 * 60_000;

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const startsAt = overrides.startsAt ?? Date.now() + 86_400_000;
  return {
    id: "task-1",
    projectKey: "c:/projects/demo",
    title: "Standardaufgabe",
    status: "open",
    startsAt,
    endsAt: overrides.endsAt ?? startsAt + SLOT_MS,
    subtasks: [],
    source: "manual",
    sortIndex: 1000,
    createdAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("TaskGridTile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTasksStore.setState({ tasks: [] });
  });

  // ── Happy path ─────────────────────────────────────────────────────

  it("renders open tasks for the project and highlights the next task", () => {
    // Seed two open tasks: t1 (lower sortIndex = next), t2
    const t1 = makeTask({ id: "task-1", title: "Erste Aufgabe", sortIndex: 1000 });
    const t2 = makeTask({ id: "task-2", title: "Zweite Aufgabe", sortIndex: 2000 });
    useTasksStore.setState({ tasks: [t1, t2] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={true}
        onClose={vi.fn()}
        onOpenLarge={vi.fn()}
      />,
    );

    // Popover is rendered
    expect(screen.getByTestId("task-grid-tile")).toBeTruthy();

    // Header shows the open count
    expect(screen.getByText("2 offen")).toBeTruthy();

    // Both task titles are visible
    expect(screen.getByText("Erste Aufgabe")).toBeTruthy();
    expect(screen.getByText("Zweite Aufgabe")).toBeTruthy();

    // The next task row (lowest sortIndex) has accent highlight
    const firstRow = screen.getByText("Erste Aufgabe").closest("div");
    expect(firstRow?.className).toContain("bg-accent-a05");
    expect(firstRow?.className).toContain("border-accent");

    // The second task row does NOT have accent highlight
    const secondRow = screen.getByText("Zweite Aufgabe").closest("div");
    expect(secondRow?.className).not.toContain("bg-accent-a05");

    // Footer "In großer Ansicht öffnen" button is present
    expect(screen.getByText("In großer Ansicht öffnen")).toBeTruthy();
  });

  it("calls onOpenLarge when the footer button is clicked", () => {
    const onOpenLarge = vi.fn();
    const t1 = makeTask();
    useTasksStore.setState({ tasks: [t1] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={true}
        onClose={vi.fn()}
        onOpenLarge={onOpenLarge}
      />,
    );

    fireEvent.click(screen.getByText("In großer Ansicht öffnen"));
    expect(onOpenLarge).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    const t1 = makeTask();
    useTasksStore.setState({ tasks: [t1] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={true}
        onClose={onClose}
        onOpenLarge={vi.fn()}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Edge case: empty state ─────────────────────────────────────────

  it("shows empty state when no open tasks exist for the project", () => {
    // No tasks seeded → store is empty
    useTasksStore.setState({ tasks: [] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={true}
        onClose={vi.fn()}
        onOpenLarge={vi.fn()}
      />,
    );

    expect(screen.getByTestId("task-grid-tile")).toBeTruthy();
    expect(screen.getByText("0 offen")).toBeTruthy();
    expect(screen.getByText("Keine offenen Aufgaben")).toBeTruthy();

    // Task list items should not be present
    expect(screen.queryByText("Standardaufgabe")).toBeNull();
  });

  it("does not render when open is false", () => {
    const t1 = makeTask();
    useTasksStore.setState({ tasks: [t1] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={false}
        onClose={vi.fn()}
        onOpenLarge={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("task-grid-tile")).toBeNull();
  });

  it("does not show done tasks in the list", () => {
    // One done task — should not appear in the open list
    const done = makeTask({ id: "done-1", title: "Erledigte Aufgabe", status: "done", completedAt: Date.now() });
    useTasksStore.setState({ tasks: [done] });

    render(
      <TaskGridTile
        sessionId="sess-1"
        folder="C:/Projects/Demo"
        open={true}
        onClose={vi.fn()}
        onOpenLarge={vi.fn()}
      />,
    );

    // No task in the open list → empty state
    expect(screen.getByText("Keine offenen Aufgaben")).toBeTruthy();
    expect(screen.queryByText("Erledigte Aufgabe")).toBeNull();
  });
});
