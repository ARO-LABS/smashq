/**
 * TaskMetaChips tests
 *
 * Happy path: all three chips render with correct labels.
 * Edge case:  selecting "Erledigt" from the status menu calls onComplete,
 *             not onUpdate.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskMetaChips } from "./TaskMetaChips";
import type { TaskItem } from "../../../store/tasksStore";
import type { ProjectOption } from "./TaskMetaChips";

// ── Factory ───────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    projectKey: "c:/proj/alpha",
    title: "Test Aufgabe",
    status: "open",
    deadline: null,
    deadlineHasTime: false,
    subtasks: [],
    source: "manual",
    sortIndex: 1000,
    createdAt: Date.now(),
    completedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const PROJECTS: ProjectOption[] = [
  { key: null, label: "Global" },
  { key: "c:/proj/alpha", label: "Alpha" },
];

// ── Happy path ────────────────────────────────────────────────────────

describe("TaskMetaChips — happy path", () => {
  it("renders three chips (Status, Deadline, Projekt) in chiprow layout", () => {
    const task = makeTask();
    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    // Status chip shows current status label
    expect(screen.getByText("Offen")).toBeTruthy();

    // Deadline chip shows placeholder when no deadline set
    expect(screen.getByText("Deadline setzen")).toBeTruthy();

    // Projekt chip shows matched project label
    expect(screen.getByText("Alpha")).toBeTruthy();

    // "In Kalender" button is present (disabled because deadline is null)
    const calBtn = screen.getByRole("button", { name: /In Kalender exportieren/ });
    expect(calBtn).toBeTruthy();
    expect((calBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders three rows in fields layout with mono uppercase labels", () => {
    const task = makeTask({ projectKey: null });
    render(
      <TaskMetaChips
        task={task}
        layout="fields"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    // Each labeled row is present
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Deadline")).toBeTruthy();
    expect(screen.getByText("Projekt")).toBeTruthy();

    // Global project label shown when projectKey is null
    expect(screen.getByText("Global")).toBeTruthy();
  });

  it("enables the In-Kalender button when deadline is set", () => {
    const task = makeTask({ deadline: Date.now() + 86_400_000 });
    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const calBtn = screen.getByRole("button", { name: /In Kalender exportieren/ });
    expect((calBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── Edge case ─────────────────────────────────────────────────────────

describe("TaskMetaChips — edge cases", () => {
  it("selecting Erledigt from the status menu calls onComplete, not onUpdate", () => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const task = makeTask({ status: "open" });

    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={onComplete}
        onReopen={vi.fn()}
      />,
    );

    // Status chip is the first button that contains the "Offen" text
    const allButtons = screen.getAllByRole("button");
    const statusBtn = allButtons.find((btn) => btn.textContent?.includes("Offen"));
    expect(statusBtn).toBeTruthy();
    fireEvent.click(statusBtn!);

    // The menu should now be open — find and click "Erledigt"
    const erledigtBtn = screen.getByRole("menuitem", { name: /Erledigt/ });
    fireEvent.click(erledigtBtn);

    // onComplete must have been called
    expect(onComplete).toHaveBeenCalledTimes(1);
    // onUpdate must NOT have been called for the done transition
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("selecting Offen from the status menu calls onUpdate with status:open", () => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    const task = makeTask({ status: "active" });

    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={onComplete}
        onReopen={vi.fn()}
      />,
    );

    // Click the status chip (currently shows "In Arbeit")
    const allButtons = screen.getAllByRole("button");
    const statusBtn = allButtons.find((btn) => btn.textContent?.includes("In Arbeit"));
    expect(statusBtn).toBeTruthy();
    fireEvent.click(statusBtn!);

    // Click "Offen" in the menu
    const offenBtn = screen.getByRole("menuitem", { name: /Offen/ });
    fireEvent.click(offenBtn);

    expect(onUpdate).toHaveBeenCalledWith({ status: "open" });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("selecting a project calls onUpdate with the correct projectKey", () => {
    const onUpdate = vi.fn();
    const task = makeTask({ projectKey: null });

    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    // Open the project menu — the chip shows "Global"
    const allButtons = screen.getAllByRole("button");
    const projBtn = allButtons.find((btn) => btn.textContent?.includes("Global"));
    expect(projBtn).toBeTruthy();
    fireEvent.click(projBtn!);

    // Select "Alpha"
    const alphaItem = screen.getByRole("menuitem", { name: /Alpha/ });
    fireEvent.click(alphaItem);

    expect(onUpdate).toHaveBeenCalledWith({ projectKey: "c:/proj/alpha" });
  });

  it("Escape key closes the open editor", () => {
    const task = makeTask({ status: "open" });

    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    // Open status menu
    const allButtons = screen.getAllByRole("button");
    const statusBtn = allButtons.find((btn) => btn.textContent?.includes("Offen"));
    fireEvent.click(statusBtn!);

    // Menu should be visible
    expect(screen.getByRole("menu")).toBeTruthy();

    // Press Escape
    fireEvent.keyDown(document, { key: "Escape" });

    // Menu should be gone
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
