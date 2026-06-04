import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDraggableWindow } from "./useDraggableWindow";

// jsdom does not implement Pointer Capture APIs. The hook calls
// setPointerCapture / releasePointerCapture inside its handlers; without
// these stubs the tests throw "not a function" before they can assert.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  // Default viewport for clamp math.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1920 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 1080 });
});

/** Build a fake PointerEvent + currentTarget that satisfies the hook's API. */
function pointer(clientX: number, clientY: number) {
  const target = document.createElement("div");
  return {
    clientX,
    clientY,
    pointerId: 1,
    currentTarget: target,
    target,
    stopPropagation: () => {},
    preventDefault: () => {},
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

describe("useDraggableWindow — size + resize", () => {
  it("starts with the provided initialSize", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 500, h: 300 } }),
    );
    expect(result.current.size).toEqual({ w: 500, h: 300 });
  });

  it("updates size when the resize handle is dragged", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 400, h: 300 } }),
    );
    act(() => result.current.setPos({ x: 100, y: 100 }));

    act(() => result.current.resizeHandlers.onPointerDown(pointer(500, 400)));
    act(() => result.current.resizeHandlers.onPointerMove(pointer(560, 450)));

    expect(result.current.size).toEqual({ w: 460, h: 350 });
  });

  it("clamps size at the minSize floor", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({
        initialSize: { w: 400, h: 300 },
        minSize: { w: 280, h: 200 },
      }),
    );
    act(() => result.current.setPos({ x: 100, y: 100 }));

    act(() => result.current.resizeHandlers.onPointerDown(pointer(500, 400)));
    // Drag far negative — should clamp at min.
    act(() => result.current.resizeHandlers.onPointerMove(pointer(0, 0)));

    expect(result.current.size).toEqual({ w: 280, h: 200 });
  });

  it("clamps size against viewport from current position", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 400, h: 300 } }),
    );
    act(() => result.current.setPos({ x: 100, y: 100 }));

    act(() => result.current.resizeHandlers.onPointerDown(pointer(500, 400)));
    // Try to drag way past viewport edges.
    act(() => result.current.resizeHandlers.onPointerMove(pointer(10000, 10000)));

    // pos.x=100, viewport.w=800 -> maxW = 800 - 100 - 8 = 692
    // pos.y=100, viewport.h=600 -> maxH = 600 - 100 - 8 = 492
    expect(result.current.size).toEqual({ w: 692, h: 492 });
  });

  it("fires onResizeEnd exactly once per drag cycle", () => {
    const onResizeEnd = vi.fn();
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 400, h: 300 }, onResizeEnd }),
    );
    act(() => result.current.setPos({ x: 100, y: 100 }));

    act(() => result.current.resizeHandlers.onPointerDown(pointer(500, 400)));
    act(() => result.current.resizeHandlers.onPointerMove(pointer(520, 410)));
    act(() => result.current.resizeHandlers.onPointerMove(pointer(540, 420)));
    act(() => result.current.resizeHandlers.onPointerMove(pointer(560, 430)));
    expect(onResizeEnd).not.toHaveBeenCalled(); // not until pointerup

    act(() => result.current.resizeHandlers.onPointerUp(pointer(560, 430)));
    expect(onResizeEnd).toHaveBeenCalledTimes(1);
    expect(onResizeEnd).toHaveBeenCalledWith({ w: 460, h: 330 });
  });

  it("re-clamps size when the viewport shrinks", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 1500, h: 900 } }),
    );
    act(() => result.current.setPos({ x: 100, y: 100 }));

    act(() => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
      window.dispatchEvent(new Event("resize"));
    });

    // maxW = 800 - 100 - 8 = 692, maxH = 500 - 100 - 8 = 392
    expect(result.current.size.w).toBe(692);
    expect(result.current.size.h).toBe(392);
  });

  it("does not move position when only the resize handle was pressed", () => {
    const { result } = renderHook(() =>
      useDraggableWindow({ initialSize: { w: 400, h: 300 } }),
    );
    act(() => result.current.setPos({ x: 200, y: 150 }));

    // Pointerdown ONLY on resize handle; drag-state should remain inert.
    act(() => result.current.resizeHandlers.onPointerDown(pointer(600, 450)));
    // A drag-move event without a drag-pointerdown is a no-op.
    act(() => result.current.dragHandlers.onPointerMove(pointer(800, 600)));

    expect(result.current.pos).toEqual({ x: 200, y: 150 });
  });
});
