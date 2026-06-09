import type { Dispatch, PointerEvent, SetStateAction } from "react";
import { useState, useRef, useEffect, useCallback } from "react";

export interface WindowPos {
  x: number;
  y: number;
}

export interface WindowSize {
  w: number;
  h: number;
}

export interface UseDraggableWindowOptions {
  initialSize: WindowSize;
  minSize?: WindowSize;
  onResizeEnd?: (size: WindowSize) => void;
}

/** Pointer-event handlers to spread onto a drag- or resize-handle element. */
export interface PointerDragHandlers {
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLDivElement>) => void;
}

export interface UseDraggableWindowResult {
  pos: WindowPos | null;
  setPos: Dispatch<SetStateAction<WindowPos | null>>;
  size: WindowSize;
  clamp: (p: WindowPos) => WindowPos;
  dragHandlers: PointerDragHandlers;
  resizeHandlers: PointerDragHandlers;
}

const DEFAULT_MIN_SIZE: WindowSize = { w: 280, h: 200 };
const EDGE_MARGIN = 8;

/**
 * Pointer-drag + pointer-resize for a fixed-position floating window.
 *
 * Spread `dragHandlers` onto the title bar to enable move; spread
 * `resizeHandlers` onto a corner element to enable resize. Both use
 * setPointerCapture so the gestures keep tracking when the cursor leaves
 * the handle, and they do not register any global listeners (nothing to
 * leak on unmount mid-gesture).
 *
 * `pos` starts as `null`; the consumer picks an initial position on first
 * open via `setPos(clamp(initial))`. Both `pos` and `size` are clamped:
 *   - position: against viewport so the title bar stays reachable
 *   - size: against minSize floor and viewport-from-pos ceiling
 *
 * `onResizeEnd` (if provided) fires exactly once per drag-cycle on
 * pointerup with the final size, suitable for persisting to a store
 * without trashing localStorage on every move event.
 */
export function useDraggableWindow(
  opts: UseDraggableWindowOptions,
): UseDraggableWindowResult {
  const { initialSize, minSize = DEFAULT_MIN_SIZE, onResizeEnd } = opts;

  const [pos, setPos] = useState<WindowPos | null>(null);
  // Mirror of `pos` for use inside long-lived listener closures. Reading the
  // ref lets the resize effect subscribe once instead of re-subscribing on
  // every pointer move (which would otherwise need `pos` in its deps).
  const posRef = useRef<WindowPos | null>(null);
  const setPosTracked = useCallback<Dispatch<SetStateAction<WindowPos | null>>>(
    (update) => {
      setPos((prev) => {
        const nextPos =
          typeof update === "function"
            ? (update as (p: WindowPos | null) => WindowPos | null)(prev)
            : update;
        posRef.current = nextPos;
        return nextPos;
      });
    },
    [],
  );
  const [size, setSize] = useState<WindowSize>(initialSize);
  const dragRef = useRef<{
    px: number;
    py: number;
    ox: number;
    oy: number;
  } | null>(null);
  const resizeRef = useRef<{
    px: number;
    py: number;
    sw: number;
    sh: number;
  } | null>(null);

  const clamp = useCallback(
    (p: WindowPos): WindowPos => ({
      x: Math.min(Math.max(0, p.x), Math.max(0, window.innerWidth - size.w)),
      // Keep at least the title bar on screen vertically.
      y: Math.min(Math.max(0, p.y), Math.max(0, window.innerHeight - 80)),
    }),
    [size.w],
  );

  const clampSize = useCallback(
    (s: WindowSize, atPos: WindowPos | null): WindowSize => {
      const anchor = atPos ?? { x: 0, y: 0 };
      const maxW = Math.max(minSize.w, window.innerWidth - anchor.x - EDGE_MARGIN);
      const maxH = Math.max(minSize.h, window.innerHeight - anchor.y - EDGE_MARGIN);
      return {
        w: Math.max(minSize.w, Math.min(maxW, Math.floor(s.w))),
        h: Math.max(minSize.h, Math.min(maxH, Math.floor(s.h))),
      };
    },
    [minSize.w, minSize.h],
  );

  // ── Drag handlers (attached to an explicit drag-handle) ──────────────
  // Drag is invoked via a dedicated handle (e.g. a small bottom-left corner
  // element), mirroring the resize-handle. The guard skips drag when a
  // <button> sits inside the handle subtree — defensive against future
  // markup with buttons-in-handle, but normally a no-op because the handle
  // is a plain span/svg.
  const onDragPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const cur = posRef.current ?? { x: 0, y: 0 };
      dragRef.current = { px: e.clientX, py: e.clientY, ox: cur.x, oy: cur.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onDragPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      setPosTracked(
        clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }),
      );
    },
    [clamp, setPosTracked],
  );

  const onDragPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  // ── Resize handlers (corner element) ──────────────────────────────────
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      resizeRef.current = { px: e.clientX, py: e.clientY, sw: size.w, sh: size.h };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [size.w, size.h],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      setSize(
        clampSize(
          { w: r.sw + (e.clientX - r.px), h: r.sh + (e.clientY - r.py) },
          posRef.current,
        ),
      );
    },
    [clampSize],
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (resizeRef.current) {
        resizeRef.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        onResizeEnd?.(size);
      }
    },
    [onResizeEnd, size],
  );

  // Re-clamp pos and size when the viewport shrinks so the window stays
  // reachable. Both clamps must run together because shrinking the window
  // can put pos out of the viewport AND can put size past the new
  // available room from pos.
  useEffect(() => {
    const onResize = () => {
      // Capture the pre-clamp position BEFORE setPosTracked mutates posRef:
      // the size clamp must measure against where the window currently is,
      // not where pos gets pushed after the viewport shrank.
      const at = posRef.current;
      setPosTracked((p) => (p ? clamp(p) : p));
      setSize((s) => clampSize(s, at));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp, clampSize, setPosTracked]);

  return {
    pos,
    setPos: setPosTracked,
    size,
    clamp,
    dragHandlers: {
      onPointerDown: onDragPointerDown,
      onPointerMove: onDragPointerMove,
      onPointerUp: onDragPointerUp,
    },
    resizeHandlers: {
      onPointerDown: onResizePointerDown,
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
    },
  };
}
