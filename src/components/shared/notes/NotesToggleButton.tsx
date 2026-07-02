import type { JSX } from "react";
import { ICONS } from "../../../utils/icons";
import { Tooltip } from "../Tooltip";

type NotesVariant = "header" | "sidebar" | "dock";

/**
 * The notes trigger button. Three visual variants share one element:
 *  - `header`: a labelled chip in the top bar (label hidden below `lg`)
 *  - `sidebar`: an icon-only 56px rail item with a left accent border (legacy rail)
 *  - `dock`: a compact icon button matching the SessionPanelDock grammar —
 *    uniform with its sibling launchers. NO "has notes" indicator: the accent
 *    dot was deliberately removed in 1ac5556 ("visually noisy, not learnable")
 *    and must not be reintroduced — keep the dock icon plain.
 */
export function NotesToggleButton({
  variant,
  open,
  hasAnyNotes,
  onToggle,
}: {
  variant: NotesVariant;
  open: boolean;
  hasAnyNotes: boolean;
  onToggle: () => void;
}): JSX.Element {
  const className =
    variant === "sidebar"
      ? `relative flex items-center justify-center w-full h-9 rounded-none border-l-2 transition-all duration-150 ${
          open
            ? "text-accent bg-accent-a10 border-accent"
            : hasAnyNotes
              ? "text-accent hover:bg-hover-overlay border-transparent"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay border-transparent"
        }`
      : variant === "dock"
        ? `relative flex items-center justify-center w-8 h-8 rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 ${
            open
              ? "text-accent bg-accent-a10"
              : "text-neutral-400 hover:text-accent hover:bg-accent-a05"
          }`
        : `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
            open
              ? "bg-accent-a10 text-accent"
              : hasAnyNotes
                ? "text-accent hover:bg-hover-overlay"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
          }`;

  const iconClass = variant === "sidebar" ? "w-5 h-5 shrink-0" : "w-4 h-4 shrink-0";

  // Legacy-Sidebar-Variante ist w-full — der inline-flex-Wrapper des Tooltips
  // wuerde die Breite kollabieren, dort bleibt das native title-Attribut.
  if (variant === "sidebar") {
    return (
      <button onClick={onToggle} className={className} aria-label="Notizen" title="Notizen">
        <ICONS.notes className={iconClass} aria-hidden="true" />
      </button>
    );
  }

  return (
    <Tooltip content="Notizen">
      <button onClick={onToggle} className={className} aria-label="Notizen">
        <ICONS.notes className={iconClass} aria-hidden="true" />
        {/* Label only in the header variant — narrow shells stay icon-only with tooltip. */}
        {variant === "header" && <span className="text-xs hidden lg:inline">Notizen</span>}
      </button>
    </Tooltip>
  );
}
