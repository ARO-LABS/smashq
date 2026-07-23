/**
 * TaskMetaChips tests
 *
 * Happy path: all three chips render with correct labels.
 * Edge case:  selecting "Erledigt" from the status menu calls onComplete,
 *             not onUpdate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskMetaChips } from "./TaskMetaChips";
import type { TaskItem } from "../../../store/tasksStore";
import type { ProjectOption } from "./TaskMetaChips";

// ── Factory ───────────────────────────────────────────────────────────

const SLOT_MS = 30 * 60_000;
const BASE_STARTS_AT = new Date("2026-06-07T10:00:00").getTime();

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: "task-1",
    projectKey: "c:/proj/alpha",
    title: "Test Aufgabe",
    status: "open",
    startsAt: BASE_STARTS_AT,
    endsAt: BASE_STARTS_AT + SLOT_MS,
    subtasks: [],
    source: "manual",
    sortIndex: 1000,
    createdAt: Date.now(),
    completedAt: null,
    ...overrides,
  };
}

const PROJECTS: ProjectOption[] = [
  { key: null, label: "Global" },
  { key: "c:/proj/alpha", label: "Alpha" },
];

// ── Happy path ────────────────────────────────────────────────────────

describe("TaskMetaChips — happy path", () => {
  it("renders three chips (Status, Slot, Projekt) in chiprow layout", () => {
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

    // Slot chip shows slot label (DD.MM. HH:MM–HH:MM format)
    // The exact string depends on locale; just verify the chip button exists with slot info
    expect(screen.getByText(/\d{2}\.\d{2}\.\s+\d{2}:\d{2}–\d{2}:\d{2}/)).toBeTruthy();

    // Projekt chip shows matched project label
    expect(screen.getByText("Alpha")).toBeTruthy();

    // "In Kalender" button is present and enabled (slot always set)
    const calBtn = screen.getByRole("button", { name: /In Kalender exportieren/ });
    expect(calBtn).toBeTruthy();
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
    expect(screen.getByText("Termin")).toBeTruthy();
    expect(screen.getByText("Projekt")).toBeTruthy();

    // Global project label shown when projectKey is null
    expect(screen.getByText("Global")).toBeTruthy();
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

// ── Kein Termin (nullable slot) ───────────────────────────────────────

describe("TaskMetaChips — task without Termin", () => {
  it("shows 'Kein Termin' on the slot chip when startsAt is null", () => {
    const task = makeTask({ startsAt: null, endsAt: null });
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

    expect(screen.getByText("Kein Termin")).toBeTruthy();
  });

  it("opens the slot popover with empty date/time inputs when no Termin is set", () => {
    const task = makeTask({ startsAt: null, endsAt: null });
    const { container } = render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Kein Termin"));

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    const timeInputs = container.querySelectorAll('input[type="time"]');
    expect(dateInput.value).toBe("");
    expect(timeInputs).toHaveLength(2);
    timeInputs.forEach((input) => {
      expect((input as HTMLInputElement).value).toBe("");
    });
  });

  it("disables the 'In Kalender' calmini when the task has no Termin", () => {
    const task = makeTask({ startsAt: null, endsAt: null });
    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onExportIcs={vi.fn()}
      />,
    );

    const calBtn = screen.getByRole("button", {
      name: /In Kalender exportieren/,
    }) as HTMLButtonElement;
    expect(calBtn.disabled).toBe(true);
    expect(calBtn.title).toBe("Erst Termin setzen");
  });

  it("keeps the 'In Kalender' calmini enabled when a Termin is set", () => {
    const task = makeTask();
    render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
        onExportIcs={vi.fn()}
      />,
    );

    const calBtn = screen.getByRole("button", {
      name: /In Kalender exportieren/,
    }) as HTMLButtonElement;
    expect(calBtn.disabled).toBe(false);
  });
});

// ── SlotChip behavior ─────────────────────────────────────────────────

describe("SlotChip behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin clock to a future time so startsAt is not "overdue"
    vi.setSystemTime(new Date("2026-01-01T00:00:00").getTime());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("changing Von time preserves 30-min duration when slot was exactly SLOT_MS", () => {
    const onUpdate = vi.fn();
    const startsAt = BASE_STARTS_AT;
    const endsAt = BASE_STARTS_AT + SLOT_MS; // exactly 30 min apart
    const task = makeTask({ startsAt, endsAt });

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

    // Open the slot chip popover
    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    expect(slotBtn).toBeTruthy();
    fireEvent.click(slotBtn!);

    // The popover shows a Von time input — change it
    const timeInputs = screen.getAllByDisplayValue(/^\d{2}:\d{2}$/);
    // First time input is Von time
    const vonTimeInput = timeInputs[0];
    fireEvent.change(vonTimeInput, { target: { value: "11:00" } });

    // onUpdate should have been called; endsAt - startsAt === SLOT_MS
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { startsAt: number; endsAt: number };
    expect(lastCall.endsAt - lastCall.startsAt).toBe(SLOT_MS);
  });

  it("changing Von time preserves a non-default (90-min) duration", () => {
    const onUpdate = vi.fn();
    const startsAt = BASE_STARTS_AT;
    const endsAt = BASE_STARTS_AT + 90 * 60_000; // 90 min — not the default
    const task = makeTask({ startsAt, endsAt });

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

    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    fireEvent.click(slotBtn!);

    const timeInputs = screen.getAllByDisplayValue(/^\d{2}:\d{2}$/);
    fireEvent.change(timeInputs[0], { target: { value: "11:00" } });

    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { startsAt: number; endsAt: number };
    expect(lastCall.endsAt - lastCall.startsAt).toBe(90 * 60_000); // duration kept, not snapped to 30
  });

  it("changing the Von date with a set Termin preserves the existing duration", () => {
    const onUpdate = vi.fn();
    const startsAt = BASE_STARTS_AT; // 2026-06-07 10:00 lokal
    const endsAt = BASE_STARTS_AT + 90 * 60_000; // 90 min
    const task = makeTask({ startsAt, endsAt });

    const { container } = render(
      <TaskMetaChips
        task={task}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    fireEvent.click(slotBtn!);

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-06-08" } });

    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as {
      startsAt: number;
      endsAt: number;
    };
    // Lokale Datums-Konstruktion (kein UTC-Epoch hardcoden)
    expect(lastCall.startsAt).toBe(new Date("2026-06-08T10:00:00").getTime());
    expect(lastCall.endsAt - lastCall.startsAt).toBe(90 * 60_000);
  });

  it("setting Bis before Von clamps so endsAt >= startsAt", () => {
    const onUpdate = vi.fn();
    const startsAt = BASE_STARTS_AT; // 10:00
    const endsAt = BASE_STARTS_AT + SLOT_MS; // 10:30
    const task = makeTask({ startsAt, endsAt });

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

    // Open the slot chip popover
    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    fireEvent.click(slotBtn!);

    // Find the Bis time input (second time input) and set it before Von
    const timeInputs = screen.getAllByDisplayValue(/^\d{2}:\d{2}$/);
    const bisTimeInput = timeInputs[1]; // second time input is Bis
    fireEvent.change(bisTimeInput, { target: { value: "09:00" } }); // before 10:00

    // onUpdate must have been called with endsAt >= startsAt
    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { startsAt: number; endsAt: number };
    expect(lastCall.endsAt).toBeGreaterThanOrEqual(lastCall.startsAt);
  });
});

// ── SlotChip — Leerzustand-Stil (Task 2) ──────────────────────────────

describe("SlotChip — Leerzustand-Stil", () => {
  it("renders the empty chip dashed + sans; a set Termin stays mono without dash (regression)", () => {
    const empty = render(
      <TaskMetaChips
        task={makeTask({ startsAt: null, endsAt: null })}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const emptyLabel = screen.getByText("Kein Termin");
    expect(emptyLabel.className).not.toContain("font-mono");
    const emptyBtn = emptyLabel.closest("button")!;
    expect(emptyBtn.className).toContain("border-dashed");
    expect(emptyBtn.className).toContain("border-neutral-700");
    expect(emptyBtn.className).toContain("text-neutral-500");
    empty.unmount();

    render(
      <TaskMetaChips
        task={makeTask()}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const monoLabel = screen.getByText(/\d{2}\.\d{2}\.\s+\d{2}:\d{2}–\d{2}:\d{2}/);
    expect(monoLabel.className).toContain("font-mono");
    expect(monoLabel.closest("button")!.className).not.toContain("border-dashed");
  });

  it("shows the hint 'Datum wählen legt den Termin an.' only while no Termin is set", () => {
    const empty = render(
      <TaskMetaChips
        task={makeTask({ startsAt: null, endsAt: null })}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Kein Termin"));
    expect(screen.getByText("Datum wählen legt den Termin an.")).toBeTruthy();
    empty.unmount();

    render(
      <TaskMetaChips
        task={makeTask()}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    fireEvent.click(slotBtn!);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("Datum wählen legt den Termin an.")).toBeNull();
  });
});

// ── SlotChip — Uhrzeit-Defaults beim Datum-Wählen (Task 2) ────────────

describe("SlotChip — Uhrzeit-Defaults beim Datum-Wählen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Feste lokale Uhr: 2026-06-07 14:12 → nächste halbe Stunde = 14:30
    vi.setSystemTime(new Date("2026-06-07T14:12:00").getTime());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderEmptyTask(onUpdate: ReturnType<typeof vi.fn>): HTMLElement {
    const { container } = render(
      <TaskMetaChips
        task={makeTask({ startsAt: null, endsAt: null })}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Kein Termin"));
    return container;
  }

  it("picking a FUTURE date with empty time defaults to 09:00 local + 30 min", () => {
    const onUpdate = vi.fn();
    const container = renderEmptyTask(onUpdate);

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-06-10" } });

    const expectedStart = new Date("2026-06-10T09:00:00").getTime();
    expect(onUpdate).toHaveBeenCalledWith({
      startsAt: expectedStart,
      endsAt: expectedStart + SLOT_MS,
    });

    // Inputs füllen sich sichtbar
    const timeInputs = container.querySelectorAll('input[type="time"]');
    expect((timeInputs[0] as HTMLInputElement).value).toBe("09:00");
    expect((timeInputs[1] as HTMLInputElement).value).toBe("09:30");
  });

  it("picking TODAY with empty time defaults to the next half-hour boundary (14:12 → 14:30)", () => {
    const onUpdate = vi.fn();
    const container = renderEmptyTask(onUpdate);

    const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: "2026-06-07" } });

    const expectedStart = new Date("2026-06-07T14:30:00").getTime();
    expect(onUpdate).toHaveBeenCalledWith({
      startsAt: expectedStart,
      endsAt: expectedStart + SLOT_MS,
    });

    const timeInputs = container.querySelectorAll('input[type="time"]');
    expect((timeInputs[0] as HTMLInputElement).value).toBe("14:30");
    expect((timeInputs[1] as HTMLInputElement).value).toBe("15:00");
  });
});

// ── SlotChip — Termin entfernen (Task 2) ──────────────────────────────

describe("SlotChip — Termin entfernen", () => {
  it("click calls onUpdate with both null and closes the popover", () => {
    const onUpdate = vi.fn();
    render(
      <TaskMetaChips
        task={makeTask()}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={onUpdate}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    const allButtons = screen.getAllByRole("button");
    const slotBtn = allButtons.find((btn) => btn.textContent?.match(/\d{2}\.\d{2}\./));
    fireEvent.click(slotBtn!);

    const removeBtn = screen.getByRole("button", { name: /Termin entfernen/ });
    fireEvent.click(removeBtn);

    expect(onUpdate).toHaveBeenCalledWith({ startsAt: null, endsAt: null });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is not rendered while the task has no Termin", () => {
    render(
      <TaskMetaChips
        task={makeTask({ startsAt: null, endsAt: null })}
        layout="chiprow"
        availableProjects={PROJECTS}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
        onReopen={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Kein Termin"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText("Termin entfernen")).toBeNull();
  });
});
