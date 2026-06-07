/**
 * TasksView tests (real store — no store mocks, per project convention).
 *
 * 1. Happy path — empty store renders the header + the "none" empty state.
 * 2. Edge case  — seeded tasks render a row; clicking it shows the detail pane.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TasksView } from "./TasksView";
import { useTasksStore } from "../../store/tasksStore";
import type { TaskItem } from "../../store/tasksStore";

// ── Helpers ────────────────────────────────────────────────────────────────

const SLOT_MS = 30 * 60_000;

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const startsAt = overrides.startsAt ?? Date.now() + 86_400_000;
  return {
    id: "task-1",
    projectKey: null,
    title: "Beispiel-Aufgabe",
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

beforeEach(() => {
  // Reset the persisted store to a clean slate before each test.
  useTasksStore.setState({ tasks: [] });
});

// ── Happy path ─────────────────────────────────────────────────────────────

describe("TasksView — happy path", () => {
  it("renders the header and the empty state when there are no tasks", () => {
    render(<TasksView />);

    // App header title
    expect(screen.getByText("Aufgaben")).toBeTruthy();
    // Primary action
    expect(screen.getByText("Neue Aufgabe")).toBeTruthy();
    // Empty state copy (no tasks → "none" message)
    expect(
      screen.getByText("Noch keine Aufgaben — neue Aufgabe anlegen"),
    ).toBeTruthy();
    // Empty detail pane prompt
    expect(screen.getByText("Aufgabe wählen")).toBeTruthy();
  });
});

// ── Neue Aufgabe: one-step create + open + focus title ──────────────────────

describe("TasksView — Neue Aufgabe (direct create + open)", () => {
  it("creates a task and opens its detail card directly on click", () => {
    render(<TasksView />);

    // Empty pane prompt before clicking.
    expect(screen.getByText("Aufgabe wählen")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    // A task is created in the store…
    expect(useTasksStore.getState().tasks).toHaveLength(1);
    expect(useTasksStore.getState().tasks[0].title).toBe("Neue Aufgabe");

    // …and the detail card shows it (no intermediate inline-add step).
    const titleInput = screen.getByLabelText("Aufgabentitel") as HTMLInputElement;
    expect(titleInput.value).toBe("Neue Aufgabe");
  });

  it("focuses + selects the new task's title for immediate editing", () => {
    render(<TasksView />);
    fireEvent.click(screen.getByRole("button", { name: "Neue Aufgabe" }));

    const titleInput = screen.getByLabelText("Aufgabentitel") as HTMLInputElement;
    expect(document.activeElement).toBe(titleInput);
  });
});

// ── Edge case ──────────────────────────────────────────────────────────────

describe("TasksView — with seeded tasks", () => {
  it("renders a row and shows the detail pane when the row is clicked", () => {
    useTasksStore.setState({
      tasks: [
        makeTask({ id: "task-a", title: "Erste Aufgabe", sortIndex: 1000 }),
        makeTask({ id: "task-b", title: "Zweite Aufgabe", sortIndex: 2000 }),
      ],
    });

    render(<TasksView />);

    // Both rows render in the master list.
    expect(screen.getByText("Erste Aufgabe")).toBeTruthy();
    expect(screen.getByText("Zweite Aufgabe")).toBeTruthy();

    // Default selection is the first open task → its title appears in the
    // editable detail-pane input.
    const titleInput = screen.getByLabelText("Aufgabentitel") as HTMLInputElement;
    expect(titleInput.value).toBe("Erste Aufgabe");

    // Click the second row → the detail pane reflects the new selection.
    fireEvent.click(screen.getByText("Zweite Aufgabe"));
    expect(
      (screen.getByLabelText("Aufgabentitel") as HTMLInputElement).value,
    ).toBe("Zweite Aufgabe");

    // The detail pane's action bar offers "Archivieren" for the selected task
    // (unique to the pane — the filter chips reuse the word "Erledigt").
    expect(screen.getByText("Archivieren")).toBeTruthy();
  });
});
