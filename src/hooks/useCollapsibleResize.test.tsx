import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useCollapsibleResize } from "./useCollapsibleResize";

// Test harness: a container (fixed rect) + a rail carrying the hook's handlers.
function Harness(props: {
  side: "left" | "right";
  collapsed: boolean;
  collapsible?: boolean;
  onCommit: (s: { width: number; collapsed: boolean }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const r = useCollapsibleResize({
    side: props.side,
    width: 300,
    collapsed: props.collapsed,
    min: 250,
    max: 800,
    railWidth: 8,
    collapsible: props.collapsible ?? true,
    containerRef,
    onCommit: props.onCommit,
  });
  return (
    <div ref={containerRef} data-testid="container">
      <span data-testid="rail" {...r.handleProps}>
        {r.renderWidth}/{String(r.renderCollapsed)}
      </span>
    </div>
  );
}

function stubRect(el: HTMLElement, rect: Partial<DOMRect>): void {
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      right: 1000,
      top: 0,
      bottom: 500,
      width: 1000,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
      ...rect,
    }) as DOMRect;
}

describe("useCollapsibleResize", () => {
  it("right side: drag inward increases width (clamped to max)", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="right" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // right width = containerRight(1000) - clientX. clientX 600 → 400.
    fireEvent.pointerDown(rail, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 600, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 600, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ width: 400, collapsed: false });
  });

  it("right side: drag below (min - 40) snaps to collapsed", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="right" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // width = 1000 - 795 = 205 < (250 - 40 = 210) → collapse.
    fireEvent.pointerDown(rail, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 795, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 795, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ collapsed: true }),
    );
  });

  it("collapsible:false never collapses, only clamps to min", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness
        side="right"
        collapsed={false}
        collapsible={false}
        onCommit={onCommit}
      />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // width = 1000 - 900 = 100 → clamp to min 250.
    fireEvent.pointerDown(rail, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 900, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ width: 250, collapsed: false });
  });

  it("drag out from collapsed reopens to the dragged width", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="right" collapsed={true} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // Drag out: clientX 700 → width 300 (>= min) → reopened.
    fireEvent.pointerDown(rail, { clientX: 950, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 700, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ width: 300, collapsed: false });
  });

  it("left side: drag outward increases width (clientX - left)", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="left" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // left width = clientX - containerLeft(0). clientX 350 → 350.
    fireEvent.pointerDown(rail, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 350, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 350, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledWith({ width: 350, collapsed: false });
  });

  it("a click without movement does not commit (no accidental resize)", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="right" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    fireEvent.pointerDown(rail, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 700, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
