/**
 * TaskDeadlineChip tests
 *
 * 1. Happy path — renders a relative label for a set Termin.
 * 2. Edge case  — renders NOTHING for a task without Termin (startsAt null).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskDeadlineChip } from "./TaskDeadlineChip";

describe("TaskDeadlineChip", () => {
  it("renders a relative label for a task with a set Termin", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(12, 0, 0, 0);

    render(<TaskDeadlineChip task={{ startsAt: tomorrow.getTime() }} />);

    expect(screen.getByText(/^(heute|morgen|\d+ Tage)$/)).toBeTruthy();
  });

  it("renders 'überfällig' with error styling for a past Termin", () => {
    render(<TaskDeadlineChip task={{ startsAt: Date.now() - 86_400_000 }} />);

    const label = screen.getByText("überfällig");
    expect(label.className).toContain("text-error");
  });

  it("renders nothing for a task without Termin (startsAt null)", () => {
    const { container } = render(<TaskDeadlineChip task={{ startsAt: null }} />);

    expect(container.firstChild).toBeNull();
  });
});
