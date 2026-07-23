/**
 * TaskMetaChips — three editable meta chips (Status / Deadline / Projekt)
 * rendered in two layouts:
 *
 * - "chiprow"  → inline pill row, appended by "In Kalender" calmini button
 * - "fields"   → labeled rows (mono uppercase key + hoverable value cell)
 *
 * Each chip opens a self-contained popover editor. Only one editor is open at
 * a time, tracked by a single `openEditor` state discriminant.
 *
 * Why a single openEditor string instead of three booleans?
 * Mutual exclusion is free: setting one editor name closes the others without
 * any coordination logic between the three chips.
 *
 * Click-outside and Escape close the active editor (local effect).
 */

import type { JSX } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { ICONS } from "../../../utils/icons";
import type { TaskItem, UpdateTaskFields } from "../../../store/tasksStore";
import { SLOT_MS, defaultSlot } from "../../../store/tasksStore";
import { StatusDot } from "./StatusDot";

// ── Types ─────────────────────────────────────────────────────────────

export interface ProjectOption {
  key: string | null;
  label: string;
}

export interface TaskMetaChipsProps {
  task: TaskItem;
  layout: "chiprow" | "fields";
  availableProjects: ProjectOption[];
  onUpdate: (fields: UpdateTaskFields) => void;
  onComplete: () => void;
  onReopen: () => void;
  /** Called when the user clicks the "In Kalender" calmini button (chiprow only). */
  onExportIcs?: () => void;
}

type OpenEditor = "status" | "slot" | "project" | null;

// ── Helpers ───────────────────────────────────────────────────────────

/** Format an epoch-ms deadline as a "YYYY-MM-DD" string for <input type="date">. */
function epochToDateInput(epoch: number): string {
  const d = new Date(epoch);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Format an epoch-ms deadline as "HH:MM" for <input type="time">. */
function epochToTimeInput(epoch: number): string {
  const d = new Date(epoch);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Parse a date-input string + optional time-input string to epoch-ms.
 * When timeStr is absent or empty, midnight local time is used.
 */
function dateTimeInputToEpoch(dateStr: string, timeStr: string): number {
  if (!dateStr) return Date.now();
  const [hours, minutes] = timeStr
    ? timeStr.split(":").map(Number)
    : [0, 0];
  const d = new Date(dateStr);
  d.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return d.getTime();
}

/** Return a human-readable label for the slot: "DD.MM. HH:MM–HH:MM" — or "Kein Termin". */
function slotDisplayLabel(task: TaskItem): string {
  if (task.startsAt === null || task.endsAt === null) return "Kein Termin";
  const datePart = new Date(task.startsAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
  const startTime = new Date(task.startsAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const endTime = new Date(task.endsAt).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${datePart} ${startTime}–${endTime}`;
}

/** Find the label for the current project key. */
function projectLabel(task: TaskItem, projects: ProjectOption[]): string {
  const match = projects.find((p) => p.key === task.projectKey);
  return match?.label ?? "Global";
}

// ── Status menu items ─────────────────────────────────────────────────

const STATUS_ITEMS = [
  { value: "open" as const, label: "Offen" },
  { value: "active" as const, label: "In Arbeit" },
  { value: "done" as const, label: "Erledigt" },
] as const;

// ── Click-outside hook ────────────────────────────────────────────────

/**
 * Attaches a document-level pointerdown listener that calls `onOutside` when
 * the event target is outside `containerRef`. Returns a ref that the container
 * must attach via ref={ref}.
 */
function useClickOutside<T extends HTMLElement>(
  active: boolean,
  onOutside: () => void,
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onOutside();
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [active, onOutside]);

  return ref;
}

// ── Shared popover wrapper ────────────────────────────────────────────

interface PopoverProps {
  children: React.ReactNode;
}

function Popover({ children }: PopoverProps): JSX.Element {
  return (
    <div
      className="absolute top-full left-0 mt-1 z-10 bg-surface-overlay shadow-lift rounded-md p-1 min-w-[158px]"
      role="dialog"
    >
      {children}
    </div>
  );
}

// ── Status chip + editor ──────────────────────────────────────────────

interface StatusChipProps {
  task: TaskItem;
  layout: "chiprow" | "fields";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onUpdate: (fields: UpdateTaskFields) => void;
  onComplete: () => void;
  onReopen: () => void;
}

function StatusChip({
  task,
  layout,
  open,
  onToggle,
  onClose,
  onUpdate,
  onComplete,
  onReopen,
}: StatusChipProps): JSX.Element {
  const containerRef = useClickOutside<HTMLDivElement>(open, onClose);
  const ChevronDown = ICONS.action.collapse;
  const CheckIcon = ICONS.tasks.check;

  const handleSelect = useCallback(
    (value: (typeof STATUS_ITEMS)[number]["value"]): void => {
      if (value === "done") {
        onComplete();
      } else if (task.status === "done") {
        // Leaving done status: reopen semantics (clears completedAt)
        onReopen();
        if (value === "active") {
          // After reopen the status is "open"; apply active in a follow-up update
          onUpdate({ status: "active" });
        }
      } else {
        onUpdate({ status: value });
      }
      onClose();
    },
    [task.status, onComplete, onReopen, onUpdate, onClose],
  );

  const statusLabel =
    STATUS_ITEMS.find((s) => s.value === task.status)?.label ?? "Offen";

  const chipContent = (
    <>
      <StatusDot status={task.status} size={8} />
      <span>{statusLabel}</span>
      <ChevronDown className="w-2.5 h-2.5 text-neutral-500" aria-hidden="true" />
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      {layout === "chiprow" ? (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] text-neutral-300 cursor-pointer hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {chipContent}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 w-[66px] shrink-0">
            Status
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            {chipContent}
          </button>
        </div>
      )}

      {open && (
        <Popover>
          <div role="menu" aria-label="Status wählen">
            {STATUS_ITEMS.map((item) => {
              const isCurrent = task.status === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(item.value)}
                  className={[
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors",
                    isCurrent
                      ? "bg-accent-a05 text-neutral-200"
                      : "text-neutral-300 hover:bg-hover-overlay",
                  ].join(" ")}
                >
                  <StatusDot status={item.value} size={8} />
                  <span className="flex-1 text-left">{item.label}</span>
                  {isCurrent && (
                    <CheckIcon
                      className="w-3 h-3 text-accent shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ── Slot chip + editor ────────────────────────────────────────────────

interface SlotChipProps {
  task: TaskItem;
  layout: "chiprow" | "fields";
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onUpdate: (fields: UpdateTaskFields) => void;
}

function SlotChip({
  task,
  layout,
  open,
  onToggle,
  onClose,
  onUpdate,
}: SlotChipProps): JSX.Element {
  const containerRef = useClickOutside<HTMLDivElement>(open, onClose);
  const SlotIcon = ICONS.tasks.deadline;
  const ChevronDown = ICONS.action.collapse;
  const CloseIcon = ICONS.action.close;

  const hasTermin = task.startsAt !== null && task.endsAt !== null;

  // Local editor state — initialized from task when popover opens
  const [vonDate, setVonDate] = useState<string>("");
  const [vonTime, setVonTime] = useState<string>("");
  const [bisTime, setBisTime] = useState<string>("");
  const [bisHint, setBisHint] = useState<boolean>(false);

  // Kein Termin → default duration; sonst bestehende Dauer beibehalten.
  const slotDuration =
    task.startsAt !== null && task.endsAt !== null
      ? task.endsAt - task.startsAt
      : SLOT_MS;

  // Sync local state when the popover opens (kein Termin → empty inputs)
  useEffect(() => {
    if (!open) return;
    setVonDate(task.startsAt === null ? "" : epochToDateInput(task.startsAt));
    setVonTime(task.startsAt === null ? "" : epochToTimeInput(task.startsAt));
    setBisTime(task.endsAt === null ? "" : epochToTimeInput(task.endsAt));
    setBisHint(false);
  }, [open, task.startsAt, task.endsAt]);

  const handleVonDateChange = (newDate: string): void => {
    setVonDate(newDate);
    if (!newDate) return;
    if (!vonTime) {
      // Datum ohne Uhrzeit gewählt (Termin wird gerade erst angelegt):
      // Start-Zeit-Default herleiten. Heute → nächste halbe Stunde
      // (defaultSlot rundet Date.now() auf die kommende :00/:30 auf), sonst
      // 09:00 lokal. Warum defaultSlot statt fixer Zeit: eine 09:00 am
      // heutigen Nachmittag läge in der Vergangenheit und wäre sofort
      // „überfällig". (Randfall kurz vor Mitternacht: defaultSlot kann auf
      // den Folgetag überlaufen — der Sync-Effect zieht die Inputs dann vom
      // aktualisierten Task nach.)
      const isToday = newDate === epochToDateInput(Date.now());
      const newStartsAt = isToday
        ? defaultSlot().startsAt
        : dateTimeInputToEpoch(newDate, "09:00");
      const newEndsAt = newStartsAt + SLOT_MS;
      setVonTime(epochToTimeInput(newStartsAt));
      setBisTime(epochToTimeInput(newEndsAt));
      setBisHint(false);
      onUpdate({ startsAt: newStartsAt, endsAt: newEndsAt });
      return;
    }
    const newStartsAt = dateTimeInputToEpoch(newDate, vonTime);
    // Preserve the existing duration when the user shifts the start.
    const newEndsAt = newStartsAt + slotDuration;
    setBisTime(epochToTimeInput(newEndsAt));
    setBisHint(false);
    onUpdate({ startsAt: newStartsAt, endsAt: newEndsAt });
  };

  const handleVonTimeChange = (newTime: string): void => {
    setVonTime(newTime);
    if (!vonDate) return;
    const newStartsAt = dateTimeInputToEpoch(vonDate, newTime);
    // Preserve the existing duration when the user shifts the start.
    const newEndsAt = newStartsAt + slotDuration;
    setBisTime(epochToTimeInput(newEndsAt));
    setBisHint(false);
    onUpdate({ startsAt: newStartsAt, endsAt: newEndsAt });
  };

  const handleBisTimeChange = (newBisTime: string): void => {
    setBisTime(newBisTime);
    if (!vonDate) return;
    const startsAt = dateTimeInputToEpoch(vonDate, vonTime);
    let endsAt = dateTimeInputToEpoch(vonDate, newBisTime);
    if (endsAt < startsAt) {
      endsAt = startsAt + SLOT_MS;
      setBisTime(epochToTimeInput(endsAt));
      setBisHint(true);
    } else {
      setBisHint(false);
    }
    onUpdate({ startsAt, endsAt });
  };

  const handleRemoveTermin = (): void => {
    onUpdate({ startsAt: null, endsAt: null });
    onClose();
  };

  const displayLabel = slotDisplayLabel(task);

  // Leerzustand: gestrichelter neutraler Chip in sans — „Kein Termin" ist
  // Platzhalter-Text, kein Zeitwert, deshalb bewusst KEIN mono.
  const chipContent = (
    <>
      <SlotIcon className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      <span className={hasTermin ? "font-mono" : undefined}>{displayLabel}</span>
      <ChevronDown className="w-2.5 h-2.5 text-neutral-500" aria-hidden="true" />
    </>
  );

  const emptyChipClasses = "border border-dashed border-neutral-700 text-neutral-500";

  return (
    <div ref={containerRef} className="relative">
      {layout === "chiprow" ? (
        <button
          type="button"
          onClick={onToggle}
          className={[
            "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] cursor-pointer hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
            hasTermin ? "text-neutral-300" : emptyChipClasses,
          ].join(" ")}
          aria-expanded={open}
          aria-haspopup="dialog"
        >
          {chipContent}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 w-[66px] shrink-0">
            Termin
          </span>
          <button
            type="button"
            onClick={onToggle}
            className={[
              "flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
              hasTermin ? "" : emptyChipClasses,
            ].join(" ")}
            aria-expanded={open}
            aria-haspopup="dialog"
          >
            {chipContent}
          </button>
        </div>
      )}

      {open && (
        <Popover>
          <div className="flex flex-col gap-2 p-1.5">
            {/* Von: date + time */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[9.5px] tracking-wide uppercase text-neutral-500">
                Von
              </label>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={vonDate}
                  onChange={(e) => handleVonDateChange(e.target.value)}
                  className="bg-surface-base rounded-md px-2 py-1 text-xs text-neutral-200 font-mono shadow-hairline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                />
                <input
                  type="time"
                  value={vonTime}
                  onChange={(e) => handleVonTimeChange(e.target.value)}
                  className="bg-surface-base rounded-md px-2 py-1 text-xs text-neutral-200 font-mono shadow-hairline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 w-[80px]"
                />
              </div>
            </div>

            {/* Bis: time only (same calendar day) */}
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[9.5px] tracking-wide uppercase text-neutral-500">
                Bis
              </label>
              <input
                type="time"
                value={bisTime}
                onChange={(e) => handleBisTimeChange(e.target.value)}
                className="bg-surface-base rounded-md px-2 py-1 text-xs text-neutral-200 font-mono shadow-hairline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 w-[80px]"
              />
              {bisHint && (
                <span className="text-[9.5px] text-warning">
                  Bis muss nach Von liegen
                </span>
              )}
            </div>

            {/* Leerzustand-Hint: nur solange kein Termin gesetzt ist */}
            {!hasTermin && (
              <span className="text-[10px] text-neutral-500">
                Datum wählen legt den Termin an.
              </span>
            )}

            {/* Footer: Termin entfernen — nur bei gesetztem Termin */}
            {hasTermin && (
              <button
                type="button"
                onClick={handleRemoveTermin}
                className="flex items-center gap-1.5 self-start bg-error/10 text-error hover:bg-error/20 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
              >
                <CloseIcon className="w-3 h-3 shrink-0" aria-hidden="true" />
                Termin entfernen
              </button>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ── Projekt chip + editor ─────────────────────────────────────────────

interface ProjektChipProps {
  task: TaskItem;
  layout: "chiprow" | "fields";
  availableProjects: ProjectOption[];
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onUpdate: (fields: UpdateTaskFields) => void;
}

function ProjektChip({
  task,
  layout,
  availableProjects,
  open,
  onToggle,
  onClose,
  onUpdate,
}: ProjektChipProps): JSX.Element {
  const containerRef = useClickOutside<HTMLDivElement>(open, onClose);
  const ChevronDown = ICONS.action.collapse;
  const CheckIcon = ICONS.tasks.check;

  const handleSelect = useCallback(
    (key: string | null): void => {
      onUpdate({ projectKey: key });
      onClose();
    },
    [onUpdate, onClose],
  );

  const label = projectLabel(task, availableProjects);
  const isGlobal = task.projectKey === null;

  const swatchClass = isGlobal
    ? "w-2 h-2 rounded-full bg-neutral-600 shrink-0"
    : "w-2 h-2 rounded-full bg-accent shrink-0";

  const chipContent = (
    <>
      <span className={swatchClass} aria-hidden="true" />
      <span>{label}</span>
      <ChevronDown className="w-2.5 h-2.5 text-neutral-500" aria-hidden="true" />
    </>
  );

  return (
    <div ref={containerRef} className="relative">
      {layout === "chiprow" ? (
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10.5px] text-neutral-300 cursor-pointer hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          aria-expanded={open}
          aria-haspopup="menu"
        >
          {chipContent}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-wide uppercase text-neutral-500 w-[66px] shrink-0">
            Projekt
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs hover:bg-hover-overlay focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-expanded={open}
            aria-haspopup="menu"
          >
            {chipContent}
          </button>
        </div>
      )}

      {open && (
        <Popover>
          <div role="menu" aria-label="Projekt wählen">
            {availableProjects.map((proj) => {
              const isCurrent = task.projectKey === proj.key;
              const projSwatchClass =
                proj.key === null
                  ? "w-2 h-2 rounded-full bg-neutral-600 shrink-0"
                  : "w-2 h-2 rounded-full bg-accent shrink-0";

              return (
                <button
                  key={proj.key ?? "__global__"}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(proj.key)}
                  className={[
                    "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors",
                    isCurrent
                      ? "bg-accent-a05 text-neutral-200"
                      : "text-neutral-300 hover:bg-hover-overlay",
                  ].join(" ")}
                >
                  <span className={projSwatchClass} aria-hidden="true" />
                  <span className="flex-1 text-left truncate">{proj.label}</span>
                  {isCurrent && (
                    <CheckIcon
                      className="w-3 h-3 text-accent shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Popover>
      )}
    </div>
  );
}

// ── TaskMetaChips ─────────────────────────────────────────────────────

export function TaskMetaChips({
  task,
  layout,
  availableProjects,
  onUpdate,
  onComplete,
  onReopen,
  onExportIcs,
}: TaskMetaChipsProps): JSX.Element {
  const [openEditor, setOpenEditor] = useState<OpenEditor>(null);

  const toggle = useCallback(
    (editor: Exclude<OpenEditor, null>): void => {
      setOpenEditor((prev) => (prev === editor ? null : editor));
    },
    [],
  );

  const close = useCallback((): void => {
    setOpenEditor(null);
  }, []);

  // Escape closes the active popover
  useEffect(() => {
    if (openEditor === null) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpenEditor(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [openEditor]);

  const CalendarAddIcon = ICONS.tasks.calendarAdd;

  if (layout === "chiprow") {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <StatusChip
          task={task}
          layout="chiprow"
          open={openEditor === "status"}
          onToggle={() => toggle("status")}
          onClose={close}
          onUpdate={onUpdate}
          onComplete={onComplete}
          onReopen={onReopen}
        />
        <SlotChip
          task={task}
          layout="chiprow"
          open={openEditor === "slot"}
          onToggle={() => toggle("slot")}
          onClose={close}
          onUpdate={onUpdate}
        />
        <ProjektChip
          task={task}
          layout="chiprow"
          availableProjects={availableProjects}
          open={openEditor === "project"}
          onToggle={() => toggle("project")}
          onClose={close}
          onUpdate={onUpdate}
        />

        {/* "In Kalender" calmini — ohne Termin gibt es kein Zeitfenster zu exportieren */}
        <button
          type="button"
          onClick={onExportIcs}
          disabled={task.startsAt === null}
          title={task.startsAt === null ? "Erst Termin setzen" : "In Kalender exportieren"}
          aria-label="In Kalender exportieren"
          className="flex items-center justify-center w-[26px] h-6 rounded-md shadow-hairline bg-surface-base text-neutral-400 hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          <CalendarAddIcon className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // fields layout — labeled rows
  return (
    <div className="flex flex-col gap-0.5">
      <StatusChip
        task={task}
        layout="fields"
        open={openEditor === "status"}
        onToggle={() => toggle("status")}
        onClose={close}
        onUpdate={onUpdate}
        onComplete={onComplete}
        onReopen={onReopen}
      />
      <SlotChip
        task={task}
        layout="fields"
        open={openEditor === "slot"}
        onToggle={() => toggle("slot")}
        onClose={close}
        onUpdate={onUpdate}
      />
      <ProjektChip
        task={task}
        layout="fields"
        availableProjects={availableProjects}
        open={openEditor === "project"}
        onToggle={() => toggle("project")}
        onClose={close}
        onUpdate={onUpdate}
      />
    </div>
  );
}
