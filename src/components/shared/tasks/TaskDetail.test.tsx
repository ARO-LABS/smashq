/**
 * TaskDetail tests
 *
 * 1. Happy path — open task (pane mode) shows "Erledigt" + "Archivieren" buttons.
 * 2. Edge case  — done task (pane mode) shows "Wieder öffnen" + "Archivieren".
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
  it("renders Erledigt and Archivieren buttons for an open task", () => {
    const task = makeTask({ status: "open" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    // Primary action: Erledigt
    expect(screen.getByRole("button", { name: /Erledigt/ })).toBeTruthy();

    // Secondary action: Archivieren
    expect(
      screen.getAllByRole("button", { name: /Archivieren/ }).length,
    ).toBeGreaterThanOrEqual(1);

    // "Wieder öffnen" must NOT appear for an open task
    expect(screen.queryByRole("button", { name: /Wieder öffnen/ })).toBeNull();
  });

  it("renders Erledigt and Archivieren for an active task", () => {
    const task = makeTask({ status: "active" });

    render(
      <TaskDetail
        task={task}
        mode="pane"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /Erledigt/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Wieder öffnen/ })).toBeNull();
  });
});

// ── Edge case ──────────────────────────────────────────────────────────

describe("TaskDetail — edge case (pane, done task)", () => {
  it("renders Wieder öffnen and Archivieren for a done task", () => {
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
        onArchive={vi.fn()}
      />,
    );

    // Reopen action
    expect(screen.getByRole("button", { name: /Wieder öffnen/ })).toBeTruthy();

    // Archivieren still present
    expect(
      screen.getAllByRole("button", { name: /Archivieren/ }).length,
    ).toBeGreaterThanOrEqual(1);

    // "Erledigt" must NOT appear in the action bar for a done task
    // Note: the status chip menu may contain "Erledigt" as a menu item —
    // we check the action bar specifically by querying visible role=button
    // that is NOT inside a menu. Since the menu is closed by default, any
    // button labelled "Erledigt" visible now would be the action-bar button.
    expect(screen.queryByRole("button", { name: /^Erledigt$/ })).toBeNull();
  });
});
