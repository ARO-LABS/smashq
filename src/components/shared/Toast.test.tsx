import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Toast } from "./Toast";
import { ToastContainer } from "./ToastContainer";
import { useUIStore } from "../../store/uiStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: () => {
        return ({ children, ...props }: { children?: React.ReactNode }) => {
          const filteredProps: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) {
            // Drop framer-motion-only props that React complains about
            if (
              ![
                "layout",
                "initial",
                "animate",
                "exit",
                "transition",
                "whileHover",
                "whileTap",
              ].includes(k)
            ) {
              filteredProps[k] = v;
            }
          }
          return <div {...filteredProps}>{children}</div>;
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUIStore.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders title and message for success toast", () => {
    render(
      <Toast
        toast={{
          id: "t1",
          type: "success",
          title: "Gespeichert",
          message: "Datei wurde erfolgreich gespeichert",
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Gespeichert")).toBeTruthy();
    expect(screen.getByText("Datei wurde erfolgreich gespeichert")).toBeTruthy();
  });

  it("auto-dismisses after default 5000ms", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ id: "t1", type: "info", title: "Hi" }}
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("does not auto-dismiss when duration is 0", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ id: "t1", type: "info", title: "Persistent", duration: 0 }}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss when close button clicked", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ id: "t1", type: "error", title: "Oops" }}
        onDismiss={onDismiss}
      />,
    );
    // Close button = the button containing the X icon (no aria-label in source)
    const buttons = screen.getAllByRole("button");
    fireEvent.click(buttons[0]);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("ToastContainer renders only last 5 toasts from uiStore", () => {
    useUIStore.setState({
      toasts: [
        { id: "1", type: "info", title: "T1", duration: 0 },
        { id: "2", type: "info", title: "T2", duration: 0 },
        { id: "3", type: "info", title: "T3", duration: 0 },
        { id: "4", type: "info", title: "T4", duration: 0 },
        { id: "5", type: "info", title: "T5", duration: 0 },
        { id: "6", type: "info", title: "T6", duration: 0 },
        { id: "7", type: "info", title: "T7", duration: 0 },
      ],
    });
    render(<ToastContainer />);
    // First two should be clipped (slice(-5)) → T3..T7 visible
    expect(screen.queryByText("T1")).toBeNull();
    expect(screen.queryByText("T2")).toBeNull();
    expect(screen.getByText("T3")).toBeTruthy();
    expect(screen.getByText("T4")).toBeTruthy();
    expect(screen.getByText("T5")).toBeTruthy();
    expect(screen.getByText("T6")).toBeTruthy();
    expect(screen.getByText("T7")).toBeTruthy();
  });

  it("ToastContainer subscribes to store updates (adding toast appears)", () => {
    render(<ToastContainer />);
    expect(screen.queryByText("Hello")).toBeNull();
    act(() => {
      useUIStore.getState().addToast({
        type: "success",
        title: "Hello",
        duration: 0,
      });
    });
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("does not render message paragraph when message is omitted", () => {
    render(
      <Toast
        toast={{ id: "t1", type: "info", title: "Nur Titel", duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Nur Titel")).toBeTruthy();
    // Only one button (the close button) — no action button
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("renders action button and calls action then dismisses on click", () => {
    const onDismiss = vi.fn();
    const actionClick = vi.fn();
    render(
      <Toast
        toast={{
          id: "t1",
          type: "error",
          title: "Fehler",
          duration: 0,
          action: { label: "Wiederholen", onClick: actionClick },
        }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText("Wiederholen"));
    expect(actionClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("dismisses even when the action callback throws", () => {
    const onDismiss = vi.fn();
    const actionClick = vi.fn(() => {
      throw new Error("boom");
    });
    render(
      <Toast
        toast={{
          id: "t1",
          type: "error",
          title: "Fehler",
          duration: 0,
          action: { label: "Wiederholen", onClick: actionClick },
        }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText("Wiederholen"));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("dismisses immediately when a rejecting promise action is clicked", () => {
    const onDismiss = vi.fn();
    const actionClick = vi.fn(() => Promise.reject(new Error("async boom")));
    render(
      <Toast
        toast={{
          id: "t1",
          type: "info",
          title: "Async",
          duration: 0,
          action: { label: "Tun", onClick: actionClick },
        }}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByText("Tun"));
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("close button carries the German aria-label", () => {
    render(
      <Toast
        toast={{ id: "t1", type: "info", title: "X", duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Benachrichtigung schließen")).toBeTruthy();
  });

  it("respects a custom positive duration", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        toast={{ id: "t1", type: "info", title: "Kurz", duration: 1000 }}
        onDismiss={onDismiss}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("clears the timer on unmount (no dismiss after unmount)", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(
      <Toast
        toast={{ id: "t1", type: "info", title: "Weg", duration: 5000 }}
        onDismiss={onDismiss}
      />,
    );
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("has role=alert for accessibility", () => {
    render(
      <Toast
        toast={{ id: "t1", type: "achievement", title: "Erfolg", duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("renders achievement with a sanctioned token class, not hue 300", () => {
    render(
      <Toast
        toast={{ id: "a1", type: "achievement", title: "Erfolg", duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    const alert = screen.getByRole("alert");
    // Border uses the sanctioned warning token, never the out-of-palette info hue.
    expect(alert.className).toContain("border-warning");
    // Glow must not leak the purple hue 300 that was outside the palette.
    expect(alert.getAttribute("style") ?? "").not.toContain("300");
    // Title text uses the sanctioned warning token.
    expect(screen.getByText("Erfolg").className).toContain("text-warning");
  });

  it("renders distinct types (achievement) with its title", () => {
    render(
      <Toast
        toast={{
          id: "t1",
          type: "achievement",
          title: "Meilenstein",
          message: "Erreicht",
          duration: 0,
        }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("Meilenstein")).toBeTruthy();
    expect(screen.getByText("Erreicht")).toBeTruthy();
  });

  it("ToastContainer renders nothing visible when there are no toasts", () => {
    useUIStore.setState({ toasts: [] });
    render(<ToastContainer />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a progress bar + percentage when progress is set", () => {
    render(
      <Toast
        toast={{ id: "p1", type: "info", title: "Update wird geladen", progress: 45, duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("45 %")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("45");
  });

  it("renders no progress bar when progress is undefined", () => {
    render(
      <Toast
        toast={{ id: "p2", type: "info", title: "Kein Balken", duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("clamps out-of-range progress to 0..100", () => {
    render(
      <Toast
        toast={{ id: "p3", type: "info", title: "Clamp", progress: 130, duration: 0 }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("100 %")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });

  it("ToastContainer passes progress through to the Toast", () => {
    useUIStore.setState({
      toasts: [{ id: "p4", type: "info", title: "DL", progress: 70 }],
    });
    render(<ToastContainer />);
    expect(screen.getByText("70 %")).toBeTruthy();
  });
});
