/**
 * ProjectScopeDropdown — header control that focuses the task list on a single
 * project (or shows all). Because `projectKey === null` is already the "Global"
 * bucket in the data model, "show all" needs its own sentinel (ALL_SCOPE) that
 * can never collide with a real projectKey.
 *
 * Dismiss behaviour (Escape / outside click) mirrors SessionAccentMenu — the
 * codebase's established popover idiom (no shared hook exists).
 */

import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { ICONS } from "../../utils/icons";
import type { ProjectOption } from "../shared/tasks/useTasksContext";

/**
 * Scope sentinel meaning "no project filter". Reuses the `\0`-prefixed sentinel
 * idiom already used for React keys in TaskMasterList (`"\0global"`) — a
 * normalized projectKey (a folder path) can never equal this.
 */
export const ALL_SCOPE = "\0all";

export interface ProjectScopeDropdownProps {
  /** Current scope: ALL_SCOPE | null (Global) | a projectKey. */
  scope: string | null;
  onScopeChange: (scope: string | null) => void;
  availableProjects: ProjectOption[];
  /** Open-task count per scope, for the trailing badge. */
  openCountForProject: (key: string | null) => number;
}

export function ProjectScopeDropdown({
  scope,
  onScopeChange,
  availableProjects,
  openCountForProject,
}: ProjectScopeDropdownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ChevronIcon = ICONS.action.collapse;
  const CheckIcon = ICONS.tasks.check;

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

  const isAll = scope === ALL_SCOPE;
  const currentLabel = isAll
    ? "Alle Projekte"
    : (availableProjects.find((p) => p.key === scope)?.label ?? "Alle Projekte");

  const select = (next: string | null): void => {
    onScopeChange(next);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 bg-surface-raised shadow-hairline rounded-md px-2.5 py-1.5 text-xs text-neutral-200 hover:bg-hover-overlay transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 max-w-[170px]"
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${isAll ? "bg-neutral-500" : "bg-accent"}`}
          aria-hidden="true"
        />
        <span className="truncate">{currentLabel}</span>
        <ChevronIcon className="w-3 h-3 text-neutral-500 shrink-0" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Projekt-Scope"
          className="absolute left-0 top-full mt-1 z-30 min-w-[210px] max-h-[320px] overflow-y-auto bg-surface-overlay border border-neutral-700 rounded-lg shadow-modal p-1"
        >
          <ScopeOption
            label="Alle Projekte"
            selected={isAll}
            onSelect={() => select(ALL_SCOPE)}
            dotClass="bg-neutral-500"
            CheckIcon={CheckIcon}
          />
          {availableProjects.map((p) => (
            <ScopeOption
              key={p.key ?? "\0global"}
              label={p.label}
              count={openCountForProject(p.key)}
              selected={!isAll && scope === p.key}
              onSelect={() => select(p.key)}
              dotClass={p.key === null ? "bg-neutral-500" : "bg-accent"}
              CheckIcon={CheckIcon}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Option row ─────────────────────────────────────────────────────────────

function ScopeOption({
  label,
  count,
  selected,
  onSelect,
  dotClass,
  CheckIcon,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
  dotClass: string;
  CheckIcon: (typeof ICONS.tasks)["check"];
}): JSX.Element {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs text-neutral-200 hover:bg-hover-overlay transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && count > 0 && (
        <span className="font-mono text-[10px] text-neutral-500">{count}</span>
      )}
      {selected && <CheckIcon className="w-3.5 h-3.5 text-accent shrink-0" aria-hidden="true" />}
    </button>
  );
}
