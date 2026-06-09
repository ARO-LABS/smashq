import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get: () => {
        return React.forwardRef<
          HTMLDivElement,
          { children?: React.ReactNode }
        >(({ children, ...props }, ref) => {
          const filtered: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(props)) {
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
              filtered[k] = v;
            }
          }
          return (
            <div ref={ref} {...filtered}>
              {children}
            </div>
          );
        });
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("Modal", () => {
  it("renders children when open", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Inhalt</p>
      </Modal>,
    );
    expect(screen.getByText("Inhalt")).toBeTruthy();
  });

  it("does not render children when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()}>
        <p>Versteckt</p>
      </Modal>,
    );
    expect(screen.queryByText("Versteckt")).toBeNull();
  });

  it("renders title with close button when title is provided", () => {
    render(
      <Modal
        open
        onClose={vi.fn()}
        title={<span>Mein Titel</span>}
      >
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByText("Mein Titel")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Schliessen" }),
    ).toBeTruthy();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title={<span>Titel</span>}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Schliessen" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    // The outermost fixed div is the backdrop click target
    const backdrop = container.querySelector(".fixed.inset-0");
    if (backdrop) {
      fireEvent.click(backdrop);
    }
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close when clicking inside modal content", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Klick hier</p>
      </Modal>,
    );
    fireEvent.click(screen.getByText("Klick hier"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has dialog role and aria-modal", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>A11y</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("applies size classes", () => {
    render(
      <Modal open onClose={vi.fn()} size="lg">
        <p>Large</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-w-lg");
  });

  it("applies md size classes by default", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Default</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).toContain("max-w-md");
  });

  it("applies sm size classes", () => {
    render(
      <Modal open onClose={vi.fn()} size="sm">
        <p>Small</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).toContain("max-w-sm");
  });

  it("applies no max-width class for size none", () => {
    render(
      <Modal open onClose={vi.fn()} size="none">
        <p>None</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).not.toContain("max-w-");
  });

  it("merges custom className onto the dialog", () => {
    render(
      <Modal open onClose={vi.fn()} className="my-modal">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").className).toContain("my-modal");
  });

  it("does not render header when no title", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(
      screen.queryByRole("button", { name: "Schliessen" }),
    ).toBeNull();
  });

  it("renders header when title is empty string", () => {
    render(
      <Modal open onClose={vi.fn()} title="">
        <p>Body</p>
      </Modal>,
    );
    expect(
      screen.getByRole("button", { name: "Schliessen" }),
    ).toBeTruthy();
  });

  it("sets aria-labelledby on dialog when title is provided", () => {
    render(
      <Modal open onClose={vi.fn()} title={<span>Titel</span>}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toBeTruthy();
  });

  it("does not set aria-labelledby when no title", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(
      screen.getByRole("dialog").getAttribute("aria-labelledby"),
    ).toBeNull();
  });

  it("dialog has tabIndex -1 for focus trap", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog").getAttribute("tabindex")).toBe("-1");
  });

  it("focuses dialog content on open", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("does not call onClose for non-Escape keys", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Enter" });
    fireEvent.keyDown(window, { key: "a" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose on Escape when closed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes Escape listener after unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Modal open onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close when clicking the dialog container itself", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <p>Body</p>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders title content inside the header region", () => {
    render(
      <Modal open onClose={vi.fn()} title={<span>Kopfzeile</span>}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Kopfzeile");
  });

  it("renders close button with X icon in header", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()} title={<span>T</span>}>
        <p>Body</p>
      </Modal>,
    );
    const closeBtn = screen.getByRole("button", { name: "Schliessen" });
    expect(closeBtn.querySelector("svg")).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("does not apply backdrop-blur (no glassmorphism)", () => {
    const { container } = render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    const backdrop = container.querySelector(".bg-black\\/70");
    expect(backdrop).toBeTruthy();
    expect(backdrop?.className).not.toContain("backdrop-blur");
  });

  it("traps Tab focus within the dialog (wraps last to first)", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <button>Erste</button>
        <button>Letzte</button>
      </Modal>,
    );
    const last = screen.getByRole("button", { name: "Letzte" });
    const first = screen.getByRole("button", { name: "Erste" });
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from first focusable back to last", () => {
    render(
      <Modal open onClose={vi.fn()}>
        <button>Erste</button>
        <button>Letzte</button>
      </Modal>,
    );
    const last = screen.getByRole("button", { name: "Letzte" });
    const first = screen.getByRole("button", { name: "Erste" });
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("restores focus to the previously focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Ausloeser";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <Modal open onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={vi.fn()}>
        <p>Body</p>
      </Modal>,
    );
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });
});
