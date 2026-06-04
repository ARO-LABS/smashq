import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { MockInstance } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { useUIStore } from "../../store/uiStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

// Helper component that throws on demand
function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Kaboom!");
  }
  return <div>All good</div>;
}

describe("ErrorBoundary", () => {
  let errSpy: MockInstance;

  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
    vi.clearAllMocks();
    // React logs caught errors via console.error — silence for all tests
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>child content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("child content")).toBeTruthy();
  });

  it("catches child error and shows default fallback UI with error message", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("RUNTIME ERROR")).toBeTruthy();
    expect(screen.getByText("Kaboom!")).toBeTruthy();
    expect(screen.getByText("RELOAD")).toBeTruthy();
  });

  it("adds error toast to uiStore when error caught", () => {
    render(
      <ErrorBoundary>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].title).toBe("Fehler");
    expect(toasts[0].message).toBe("Kaboom!");
    expect(toasts[0].duration).toBe(8000);
  });

  it("renders custom fallback prop when provided instead of default UI", () => {
    render(
      <ErrorBoundary fallback={<div>custom fallback here</div>}>
        <Bomb shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback here")).toBeTruthy();
    expect(screen.queryByText("RUNTIME ERROR")).toBeNull();
  });

  it("resets error state when RELOAD button clicked", () => {
    // Use a ref-controlled child so flipping its behavior doesn't require
    // passing new children through rerender (which would race with setState).
    let shouldThrow = true;
    function ControlledBomb() {
      if (shouldThrow) throw new Error("Kaboom!");
      return <div>All good</div>;
    }
    render(
      <ErrorBoundary>
        <ControlledBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("RUNTIME ERROR")).toBeTruthy();

    // Flip behavior FIRST, then click RELOAD so re-render uses new behavior
    shouldThrow = false;
    fireEvent.click(screen.getByText("RELOAD"));

    expect(screen.queryByText("RUNTIME ERROR")).toBeNull();
    expect(screen.getByText("All good")).toBeTruthy();
  });
});
