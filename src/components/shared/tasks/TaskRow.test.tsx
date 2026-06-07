/**
 * TaskRow tests
 *
 * 1. Happy path — renders title and deadline chip for a manual open task.
 * 2. Edge case  — isNext marker is shown; done task gets strikethrough in compact density.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskRow } from "./TaskRow";
import type { TaskItem } from "../../../store/tasksStore";

// ── Helpers ────────────────────────────────────────────────────────────

/** Tomorrow in epoch ms — keeps the deadline chip in "soon" (warning) state. */
function tomorrow(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

const SLOT_MS = 30 * 60_000;

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  const startsAt = overrides.startsAt ?? tomorrow();
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

// ── Tests ──────────────────────────────────────────────────────────────

describe("TaskRow", () => {
  // ── Happy path ───────────────────────────────────────────────────────

  it("renders the task title and a deadline chip for a task with a slot", () => {
    const task = makeTask({ startsAt: tomorrow() });
    const onSelect = vi.fn();

    render(
      <TaskRow task={task} onSelect={onSelect} showSource density="comfortable" />,
    );

    // Title is visible
    expect(screen.getByText("Beispiel-Aufgabe")).toBeTruthy();

    // TaskDeadlineChip is rendered — label is "heute" or "morgen" depending on
    // wall-clock. Either way the chip contains an icon + relative text; we
    // assert the chip is present by checking for the "morgen"/"heute" label.
    const chip = screen.queryByText(/^(heute|morgen|\d+ Tage)$/);
    expect(chip).toBeTruthy();

    // Source label "manuell" is shown for a manual open task
    expect(screen.getByText("manuell")).toBeTruthy();
  });

  it("calls onSelect with the task id when clicked", () => {
    const task = makeTask();
    const onSelect = vi.fn();

    render(<TaskRow task={task} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("task-1");
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("never renders a 'nächste' label", () => {
    render(<TaskRow task={makeTask()} onSelect={() => {}} />);
    expect(screen.queryByText("nächste")).toBeNull();
  });

  it("applies line-through to the title in compact density when task is done", () => {
    const task = makeTask({ status: "done", completedAt: Date.now() });

    render(<TaskRow task={task} onSelect={vi.fn()} density="compact" />);

    const titleEl = screen.getByText("Beispiel-Aufgabe");
    // Compact + done: line-through class must be present
    expect(titleEl.className).toContain("line-through");
  });

  it("does NOT apply line-through to done title in comfortable density", () => {
    const task = makeTask({ status: "done", completedAt: Date.now() });

    render(<TaskRow task={task} onSelect={vi.fn()} density="comfortable" />);

    const titleEl = screen.getByText("Beispiel-Aufgabe");
    expect(titleEl.className).not.toContain("line-through");
    // But still muted color
    expect(titleEl.className).toContain("text-neutral-500");
  });

  it("shows 'in Arbeit' source label when task status is active", () => {
    const task = makeTask({ status: "active" });

    render(<TaskRow task={task} onSelect={vi.fn()} showSource />);

    expect(screen.getByText("in Arbeit")).toBeTruthy();
    // Source-specific labels must NOT appear
    expect(screen.queryByText("manuell")).toBeNull();
    expect(screen.queryByText("via Session")).toBeNull();
  });

  it("shows 'via Session' pill when source is session and status is not active", () => {
    const task = makeTask({ source: "session", status: "open" });

    render(<TaskRow task={task} onSelect={vi.fn()} showSource />);

    expect(screen.getByText("via Session")).toBeTruthy();
  });

  it("does not render the footer in compact density", () => {
    const task = makeTask({ source: "session", startsAt: tomorrow() });

    render(<TaskRow task={task} onSelect={vi.fn()} density="compact" showSource />);

    // In compact mode: no source label and no deadline chip rendered
    expect(screen.queryByText("via Session")).toBeNull();
    expect(screen.queryByText(/^(heute|morgen|\d+ Tage)$/)).toBeNull();
  });

  it("applies selected styling (bg-accent-a05 + border-accent)", () => {
    const task = makeTask();
    const { container } = render(
      <TaskRow task={task} onSelect={vi.fn()} selected />,
    );

    const btn = container.querySelector("button");
    expect(btn?.className).toContain("bg-accent-a05");
    expect(btn?.className).toContain("border-accent");
  });

  it("applies error border for overdue non-done non-selected task", () => {
    const yesterday = Date.now() - 86_400_000;
    const task = makeTask({ startsAt: yesterday, status: "open" });

    const { container } = render(
      <TaskRow task={task} onSelect={vi.fn()} selected={false} />,
    );

    const btn = container.querySelector("button");
    expect(btn?.className).toContain("border-error");
  });

  it("does NOT apply error border when task is overdue but selected", () => {
    const yesterday = Date.now() - 86_400_000;
    const task = makeTask({ startsAt: yesterday, status: "open" });

    const { container } = render(
      <TaskRow task={task} onSelect={vi.fn()} selected />,
    );

    const btn = container.querySelector("button");
    // Selected state wins: accent border, not error
    expect(btn?.className).toContain("border-accent");
    expect(btn?.className).not.toContain("border-error");
  });
});
