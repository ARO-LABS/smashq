/**
 * TasksPanel — Tasks feature shell (two variants).
 *
 * variant="window"
 *   Owns open/close state + window geometry. Derives useTasksContext(open),
 *   renders a terminal-toolbar toggle button (pill grammar, ICONS.tasks.panel
 *   + open-count badge) and a portal-mounted floating TasksWindow. Initial
 *   placement: top-right corner. Escape closes.
 *
 * variant="grid-tile"
 *   Renders the tasks icon button (with open-count badge) + a TaskGridTile
 *   popover. Owns popover open state. onOpenLarge → invokes
 *   open_detached_window so the full TasksView opens in its own Tauri window.
 *
 * The "global" variant (full-bleed TasksView) is intentionally NOT implemented
 * here — it is rendered directly by DetachedViewApp via TasksView.
 */

import type { JSX } from "react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore, normalizeProjectKey } from "../../store/settingsStore";
import { useTasksStore, selectOpenTasksForProject } from "../../store/tasksStore";
import { useDraggableWindow } from "../../hooks/useDraggableWindow";
import { useTasksContext } from "./tasks/useTasksContext";
import { TasksWindow } from "./tasks/TasksWindow";
import { TaskGridTile } from "../sessions/tasks/TaskGridTile";
import { ICONS } from "../../utils/icons";
import { logError } from "../../utils/errorLogger";

// ── Props ──────────────────────────────────────────────────────────────

export interface TasksPanelProps {
  variant: "window" | "grid-tile";
  folder?: string;
  sessionId?: string;
}

// ── Badge ──────────────────────────────────────────────────────────────

/**
 * Numeric open-task badge, positioned absolute over the icon.
 * Only rendered when count > 0.
 */
function TasksBadge({ count }: { count: number }): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} offene Aufgaben`}
      className="absolute -top-1 -right-0.5 min-w-[14px] h-3.5 px-1 rounded-full bg-accent text-surface-base font-mono text-[8.5px] flex items-center justify-center pointer-events-none"
    >
      {count}
    </span>
  );
}

// ── WindowVariant ──────────────────────────────────────────────────────

function WindowVariant({
  folder,
  sessionId,
}: {
  folder?: string;
  sessionId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);

  const tasksWindowSize = useSettingsStore((s) => s.tasksWindowSize);
  const setTasksWindowSize = useSettingsStore((s) => s.setTasksWindowSize);

  const { pos, setPos, size, clamp, dragHandlers, resizeHandlers } =
    useDraggableWindow({
      initialSize: tasksWindowSize,
      onResizeEnd: setTasksWindowSize,
    });

  const ctx = useTasksContext(open);

  // Badge: open count for the folder's project key (or global when no folder).
  const projectKey = folder ? normalizeProjectKey(folder) : null;
  const openCount = useTasksStore(selectOpenTasksForProject(projectKey)).length;

  // Place the window near the top-right corner the first time it is opened.
  useEffect(() => {
    if (open && pos === null) {
      setPos(clamp({ x: window.innerWidth - size.w - 24, y: 52 }));
    }
  }, [open, pos, clamp, setPos, size.w]);

  // Escape closes the window (windowed behaviour — stays put while user works).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Open the full TasksView in its own window and close the floating one —
  // same affordance the grid-tile already offers (consistency gap).
  const handleOpenLarge = (): void => {
    invoke("open_detached_window", { view: "tasks", title: "Aufgaben" }).catch(
      (err: unknown) => logError("TasksPanel.openDetachedTasks", err),
    );
    setOpen(false);
  };

  const PanelIcon = ICONS.tasks.panel;

  // Suppress unused-prop warning — sessionId is accepted for future use (IPC
  // context) but is not needed for the window variant's own rendering logic.
  void sessionId;

  return (
    <>
      {/* Toggle button — terminal-toolbar pill grammar */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Aufgaben schliessen" : "Aufgaben öffnen"}
        aria-expanded={open}
        className={[
          "relative p-1 rounded-md transition-colors",
          "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
          open
            ? "text-accent bg-accent-a10"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay",
        ].join(" ")}
      >
        <PanelIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <TasksBadge count={openCount} />
      </button>

      {/* Portal-mounted floating window */}
      {open && (
        <TasksWindow
          ctx={ctx}
          pos={pos}
          size={size}
          dragHandlers={dragHandlers}
          resizeHandlers={resizeHandlers}
          onClose={() => setOpen(false)}
          onOpenLarge={handleOpenLarge}
        />
      )}
    </>
  );
}

// ── GridTileVariant ────────────────────────────────────────────────────

function GridTileVariant({
  folder,
  sessionId,
}: {
  folder?: string;
  sessionId?: string;
}): JSX.Element {
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Badge: open count for the folder's project key.
  const projectKey = folder ? normalizeProjectKey(folder) : null;
  const openCount = useTasksStore(selectOpenTasksForProject(projectKey)).length;

  const handleOpenLarge = (): void => {
    invoke("open_detached_window", { view: "tasks", title: "Aufgaben" }).catch(
      (err: unknown) => logError("TasksPanel.openDetachedTasks", err),
    );
    setPopoverOpen(false);
  };

  const PanelIcon = ICONS.tasks.panel;

  return (
    <>
      {/* Icon button with badge */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setPopoverOpen((v) => !v);
        }}
        aria-label={popoverOpen ? "Aufgaben schliessen" : "Aufgaben öffnen"}
        aria-expanded={popoverOpen}
        className={[
          "relative p-1 rounded-md transition-colors",
          "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
          popoverOpen
            ? "text-accent bg-accent-a10"
            : "text-neutral-400 hover:text-accent hover:bg-accent-a05",
        ].join(" ")}
      >
        <PanelIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <TasksBadge count={openCount} />
      </button>

      {/* Anchored popover — the cell wrapper is `position: relative` */}
      <TaskGridTile
        sessionId={sessionId ?? ""}
        folder={folder}
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        onOpenLarge={handleOpenLarge}
      />
    </>
  );
}

// ── TasksPanel ─────────────────────────────────────────────────────────

/**
 * Public entry point. Dispatches to the correct variant sub-component so
 * each variant can own its own state without cluttering a single function body.
 */
export function TasksPanel({
  variant,
  folder,
  sessionId,
}: TasksPanelProps): JSX.Element {
  if (variant === "grid-tile") {
    return <GridTileVariant folder={folder} sessionId={sessionId} />;
  }

  // variant === "window"
  return <WindowVariant folder={folder} sessionId={sessionId} />;
}
