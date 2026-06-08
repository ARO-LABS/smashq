/**
 * TaskDetail tests
 *
 * 1. Happy path — open task (pane mode) shows "Erledigt" + "Löschen" buttons.
 * 2. Edge case  — done task (pane mode) shows "Wieder öffnen" + "Löschen".
 * 3. Inline confirm — two-stage delete confirmation (arm + confirm).
 * 4. Inline confirm — "Abbrechen" cancels without deleting.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskDetail } from "./TaskDetail";
import type { TaskItem } from "../../../store/tasksStore";
import type { ProjectOption } from "./TaskMetaChips";

// ── Factory ────────────────────────────────────────────────────────────

const SLOT_MS = 30 * 60_000;

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const startsAt = overrides.startsAt ?? Date.now() + 86_400_000;
  return {
    id: "task-test-1",
    projectKey: null,
    title: "Testaufgabe",
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

const PROJECTS: ProjectOption[] = [{ key: null, label: "Global" }];

// ── Happy path ─────────────────────────────────────────────────────────

describe("TaskDetail — happy path (pane, open task)", () => {
  it("renders Erledigt and Löschen buttons for an open task", () => {
    const task = makeTask({ status: "open" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Primary action: Erledigt
    expect(screen.getByRole("button", { name: /Erledigt/ })).toBeTruthy();

    // Secondary action: Löschen (the initial confirm-arm button)
    expect(
      screen.getAllByRole("button", { name: /Löschen/ }).length,
    ).toBeGreaterThanOrEqual(1);

    // "Wieder öffnen" must NOT appear for an open task
    expect(screen.queryByRole("button", { name: /Wieder öffnen/ })).toBeNull();
  });

  it("renders Erledigt and Löschen for an active task", () => {
    const task = makeTask({ status: "active" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Erledigt/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Wieder öffnen/ })).toBeNull();
  });
});

// ── Add subtask UX ─────────────────────────────────────────────────────

describe("TaskDetail — add subtask (pane)", () => {
  function renderOpen(): ReturnType<typeof vi.fn> {
    const onUpdate = vi.fn();
    render(
      <TaskDetail
        task={makeTask({ status: "open", subtasks: [] })}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    return onUpdate;
  }

  it("adds a subtask when the + button is clicked", () => {
    const onUpdate = renderOpen();
    fireEvent.change(screen.getByPlaceholderText("Teilschritt"), {
      target: { value: "Recherche" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Teilschritt hinzufügen" }),
    );
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subtasks: expect.arrayContaining([
          expect.objectContaining({ title: "Recherche", done: false }),
        ]),
      }),
    );
  });

  it("adds a subtask when the input loses focus (blur saves)", () => {
    const onUpdate = renderOpen();
    const input = screen.getByPlaceholderText("Teilschritt");
    fireEvent.change(input, { target: { value: "Notizen" } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subtasks: expect.arrayContaining([
          expect.objectContaining({ title: "Notizen" }),
        ]),
      }),
    );
  });

  it("does not add an empty subtask on blur", () => {
    const onUpdate = renderOpen();
    const input = screen.getByPlaceholderText("Teilschritt");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ── Edge case ──────────────────────────────────────────────────────────

describe("TaskDetail — edge case (pane, done task)", () => {
  it("renders Wieder öffnen and Löschen for a done task", () => {
    const task = makeTask({
      status: "done",
      completedAt: Date.now(),
    });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    // Reopen action
    expect(screen.getByRole("button", { name: /Wieder öffnen/ })).toBeTruthy();

    // Löschen still present
    expect(
      screen.getAllByRole("button", { name: /Löschen/ }).length,
    ).toBeGreaterThanOrEqual(1);

    // "Erledigt" must NOT appear in the action bar for a done task
    // Note: the status chip menu may contain "Erledigt" as a menu item —
    // we check the action bar specifically by querying visible role=button
    // that is NOT inside a menu. Since the menu is closed by default, any
    // button labelled "Erledigt" visible now would be the action-bar button.
    expect(screen.queryByRole("button", { name: /^Erledigt$/ })).toBeNull();
  });
});

// ── Inline confirm — two-stage delete ─────────────────────────────────

describe("TaskDetail — inline delete confirmation (pane mode)", () => {
  it("requires confirmation before deleting", () => {
    const onDelete = vi.fn();
    const task = makeTask({ status: "open" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={onDelete}
      />,
    );

    // First click: arms the confirm — onDelete must NOT be called yet
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    expect(onDelete).not.toHaveBeenCalled();

    // Second click: confirms deletion
    fireEvent.click(screen.getByRole("button", { name: /Wirklich löschen/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("cancel keeps the task (does not delete)", () => {
    const onDelete = vi.fn();
    const task = makeTask({ status: "open" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
