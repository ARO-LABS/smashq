import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResizeHandle } from "./useResizeHandle";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockSetConfigPanelWidth = vi.fn();

vi.mock("../../../store/uiStore", () => ({
  useUIStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setConfigPanelWidth: mockSetConfigPanelWidth }),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("useResizeHandle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("returns containerRef and handleResizeStart", () => {
    const { result } = renderHook(() => useResizeHandle());

    expect(result.current.containerRef).toBeDefined();
    expect(typeof result.current.handleResizeStart).toBe("function");
  });

  it("sets col-resize cursor on drag start", () => {
    const { result } = renderHook(() => useResizeHandle());

    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("calculates width from mouse position on drag", () => {
    const { result } = renderHook(() => useResizeHandle());

    // Simulate a container element with getBoundingClientRect
    const fakeContainer = document.createElement("div");
    vi.spyOn(fakeContainer, "getBoundingClientRect").mockReturnValue({
      right: 1000,
      left: 0,
      top: 0,
      bottom: 0,
      width: 1000,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    // Assign containerRef
    Object.defineProperty(result.current.containerRef, "current", {
      value: fakeContainer,
      writable: true,
    });

    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    // Simulate mousemove
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 600 }));
    });

    // 1000 (right) - 600 (clientX) = 400
    expect(mockSetConfigPanelWidth).toHaveBeenCalledWith(400);
  });

  it("resets cursor on mouseup", () => {
    const { result } = renderHook(() => useResizeHandle());

    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    expect(document.body.style.cursor).toBe("col-resize");

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("stops updating width after mouseup", () => {
    const { result } = renderHook(() => useResizeHandle());

    const fakeContainer = document.createElement("div");
    vi.spyOn(fakeContainer, "getBoundingClientRect").mockReturnValue({
      right: 1000,
      left: 0,
      top: 0,
      bottom: 0,
      width: 1000,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    Object.defineProperty(result.current.containerRef, "current", {
      value: fakeContainer,
      writable: true,
    });

    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    mockSetConfigPanelWidth.mockClear();

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 600 }));
    });

    // Should NOT be called after mouseup
    expect(mockSetConfigPanelWidth).not.toHaveBeenCalled();
  });
});
