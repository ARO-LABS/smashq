/**
 * ViewOptionsPopover — the "Ansicht" popover holding the set-once view controls
 * (grouping + sort) that don't warrant permanent header space. Frequent controls
 * (status filter, project scope, search) stay visible in the toolbar; these two
 * live one click away.
 *
 * Dismiss behaviour mirrors SessionAccentMenu / ProjectScopeDropdown.
 */

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { ICONS } from "../../utils/icons";
import type { TaskGrouping, TaskSort } from "../shared/tasks/useTasksContext";

export interface ViewOptionsPopoverProps {
  grouping: TaskGrouping;
  onGroupingChange: (g: TaskGrouping) => void;
  sort: TaskSort;
  onSortChange: (s: TaskSort) => void;
}

const GROUPINGS: { value: TaskGrouping; label: string }[] = [
  { value: "project", label: "Projekt" },
  { value: "deadline", label: "Termin" },
];

const SORTS: { value: TaskSort; label: string }[] = [
  { value: "manual", label: "Manuell" },
  { value: "recent", label: "Zuletzt erstellt" },
];

export function ViewOptionsPopover({
  grouping,
  onGroupingChange,
  sort,
  onSortChange,
}: ViewOptionsPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ViewIcon = ICONS.action.listView;
  const ChevronIcon = ICONS.action.collapse;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 bg-surface-raised shadow-hairline rounded-md px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-hover-overlay transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <ViewIcon className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-hidden="true" />
        Ansicht
        <ChevronIcon className="w-3 h-3 text-neutral-500 shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Ansichtsoptionen"
          className="absolute right-0 top-full mt-1 z-30 min-w-[210px] bg-surface-overlay border border-neutral-700 rounded-lg shadow-modal p-2 flex flex-col gap-2.5"
        >
          <Segment label="Gruppierung" options={GROUPINGS} value={grouping} onChange={onGroupingChange} />
          <Segment label="Sortierung" options={SORTS} value={sort} onChange={onSortChange} />
        </div>
      )}
    </div>
  );
}

// ── Segmented control ────────────────────────────────────────────────────────

function Segment<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div>
      <div className="text-[9.5px] tracking-wide uppercase text-neutral-500 mb-1 px-0.5">{label}</div>
      <div className="flex gap-1 p-0.5 rounded-md bg-surface-base shadow-hairline">
        {options.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={[
                "flex-1 text-[11px] px-2 py-1 rounded transition-colors",
                "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
                active
                  ? "bg-surface-overlay text-neutral-100"
                  : "text-neutral-400 hover:text-neutral-200",
              ].join(" ")}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
