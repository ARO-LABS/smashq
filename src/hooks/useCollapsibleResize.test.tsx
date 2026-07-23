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
      <span data-testid="rail" {...r.handleProps} onClick={r.onClick}>
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

  it("the synthetic click after a drag-to-collapse does not re-open", () => {
    // Regression: pointerdown+up on one element fires a trailing click event.
    // Without suppression, that click would call restore() and undo the collapse.
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="left" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // left width = clientX - 0. Drag to clientX 100 → raw 100 < (180 - 40)? here
    // min is 250 so 100 < 210 → collapse.
    fireEvent.pointerDown(rail, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 100, pointerId: 1 });
    fireEvent.click(rail); // the trailing synthetic click
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ collapsed: true }),
    );
  });

  it("a genuine click on the collapsed rail restores the last width", () => {
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="left" collapsed={true} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    fireEvent.click(getByTestId("rail"));
    expect(onCommit).toHaveBeenCalledWith({ width: 300, collapsed: false });
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

  it("(happy) click on expanded rail collapses with the current width", () => {
    // Harness has width=300 and collapsed=false → click must commit collapsed:true
    // preserving the pre-click width (300) so a subsequent restore gets back there.
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="left" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    fireEvent.click(getByTestId("rail"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ width: 300, collapsed: true });
  });

  it("(edge) drag ending beyond threshold does NOT collapse via the trailing click", () => {
    // After a committed drag the suppressClickRef swallows the next click.
    // Now that the else-branch would collapse an expanded panel, we must verify the
    // suppressed click is still harmless even with the new toggle logic.
    const onCommit = vi.fn();
    const { getByTestId } = render(
      <Harness side="left" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });
    const rail = getByTestId("rail");
    // Drag to a valid expanded width (350 > min 250).
    fireEvent.pointerDown(rail, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 350, pointerId: 1 });
    fireEvent.pointerUp(rail, { clientX: 350, pointerId: 1 });
    fireEvent.click(rail); // trailing synthetic click after drag — must be swallowed
    // Only the drag commit must have fired; the click must not trigger a second commit.
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ width: 350, collapsed: false });
  });

  it("(edge) click-toggle roundtrip: collapse then restore to same width", () => {
    // First click on expanded (collapsed=false) → commit collapsed:true with width=300.
    // After the component is re-rendered with collapsed=true the next click restores.
    const onCommit = vi.fn();
    // Start expanded.
    const { getByTestId, rerender } = render(
      <Harness side="left" collapsed={false} onCommit={onCommit} />,
    );
    stubRect(getByTestId("container"), { left: 0, right: 1000 });

    // Click 1: collapse.
    fireEvent.click(getByTestId("rail"));
    expect(onCommit).toHaveBeenNthCalledWith(1, { width: 300, collapsed: true });

    // Simulate the store applying the collapse — re-render with collapsed=true.
    rerender(<Harness side="left" collapsed={true} onCommit={onCommit} />);

    // Click 2: restore.
    fireEvent.click(getByTestId("rail"));
    expect(onCommit).toHaveBeenNthCalledWith(2, { width: 300, collapsed: false });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
});
