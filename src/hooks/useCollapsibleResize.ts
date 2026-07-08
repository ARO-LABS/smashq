import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useRef, useState } from "react";

export interface CollapsibleResizeState {
  width: number;
  collapsed: boolean;
}

export interface UseCollapsibleResizeOptions {
  /** Which edge the panel is docked to. Determines the width math. */
  side: "left" | "right";
  /** Current (expanded) width from the store — render source when idle. */
  width: number;
  /** Current collapsed flag from the store — render source when idle. */
  collapsed: boolean;
  min: number;
  max: number;
  /** Visible width of the collapsed rail in px. */
  railWidth: number;
  /** When false, dragging below min just clamps (never collapses). */
  collapsible?: boolean;
  /** The flex-row element whose fixed edge anchors the width math. */
  containerRef: RefObject<HTMLElement>;
  /** Fired once on pointerup (real drag) or from restore() — persist here. */
  onCommit: (state: CollapsibleResizeState) => void;
}

export interface CollapsibleResizeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
}

export interface UseCollapsibleResizeResult {
  /** Width to render right now (live during drag, store value when idle). */
  renderWidth: number;
  /** Collapsed state to render right now. */
  renderCollapsed: boolean;
  /** True while a pointer drag is active — gate the width CSS transition off. */
  isDragging: boolean;
  handleProps: CollapsibleResizeHandlers;
  /** Click-to-restore: reopen to the last expanded width. */
  restore: () => void;
}

/** Cursor must move this far before a pointerdown counts as a drag (vs a click). */
const DRAG_THRESHOLD = 4;
/** Dead-band below `min` before a drag snaps to collapsed. */
const COLLAPSE_HYSTERESIS = 40;

/**
 * Pointer-drag resize + collapse-to-rail for a docked side panel.
 *
 * Both the left nav and the right config panel share this. The panel is
 * anchored to one edge of a flex row (`containerRef`); dragging the inner
 * rail changes the width, and — when `collapsible` — dragging past
 * `min - 40` snaps to a collapsed rail. `restore()` (wired to the rail's
 * onClick when collapsed) reopens to the last expanded width.
 *
 * Live width lives in local state during a drag so the panel tracks the
 * cursor without writing to the store on every move; the store (and thus
 * localStorage) is touched exactly once, on pointerup, via `onCommit`.
 * Mirrors the setPointerCapture + commit-on-up pattern of useDraggableWindow.
 */
export function useCollapsibleResize(
  opts: UseCollapsibleResizeOptions,
): UseCollapsibleResizeResult {
  const {
    side,
    width,
    collapsed,
    min,
    max,
    collapsible = true,
    containerRef,
    onCommit,
  } = opts;

  const [live, setLive] = useState<CollapsibleResizeState | null>(null);
  const [dragging, setDragging] = useState(false);
  const startXRef = useRef(0);
  const movedRef = useRef(false);
  // Remember the last expanded width so a collapsed rail can restore to it.
  const lastWidthRef = useRef(width);
  if (!dragging && !collapsed) lastWidthRef.current = width;

  const compute = useCallback(
    (clientX: number): CollapsibleResizeState => {
      const rect = containerRef.current?.getBoundingClientRect();
      const anchor = rect ? (side === "left" ? rect.left : rect.right) : 0;
      const raw = side === "left" ? clientX - anchor : anchor - clientX;
      if (collapsible && raw < min - COLLAPSE_HYSTERESIS) {
        return { width: lastWidthRef.current, collapsed: true };
      }
      return {
        width: Math.max(min, Math.min(max, Math.round(raw))),
        collapsed: false,
      };
    },
    [side, min, max, collapsible, containerRef],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    movedRef.current = false;
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      if (
        !movedRef.current &&
        Math.abs(e.clientX - startXRef.current) < DRAG_THRESHOLD
      ) {
        return;
      }
      movedRef.current = true;
      setLive(compute(e.clientX));
    },
    [dragging, compute],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!dragging) return;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const wasDrag = movedRef.current;
      const final = live;
      setLive(null);
      // A pointerdown with no movement is a click, not a resize — leave state
      // untouched (the rail's onClick handles restore when collapsed).
      if (wasDrag && final) {
        if (!final.collapsed) lastWidthRef.current = final.width;
        onCommit(final);
      }
    },
    [dragging, live, onCommit],
  );

  const restore = useCallback(() => {
    onCommit({ width: lastWidthRef.current, collapsed: false });
  }, [onCommit]);

  return {
    renderWidth: live?.width ?? width,
    renderCollapsed: live?.collapsed ?? collapsed,
    isDragging: dragging,
    handleProps: { onPointerDown, onPointerMove, onPointerUp },
    restore,
  };
}
