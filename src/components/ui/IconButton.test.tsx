import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconButton } from "./IconButton";
import { ICONS } from "../../utils/icons";

const X = ICONS.action.close;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("IconButton", () => {
  it("renders with aria-label", () => {
    render(<IconButton icon={<X />} label="Schliessen" />);
    expect(screen.getByRole("button", { name: "Schliessen" })).toBeTruthy();
  });

  it("renders with title attribute", () => {
    render(<IconButton icon={<X />} label="Schliessen" />);
    expect(screen.getByRole("button").getAttribute("title")).toBe("Schliessen");
  });

  it("calls onClick handler", () => {
    const onClick = vi.fn();
    render(<IconButton icon={<X />} label="Close" onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop set", () => {
    render(<IconButton icon={<X />} label="Close" disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("applies size classes", () => {
    render(<IconButton icon={<X />} label="Close" size="lg" />);
    expect(screen.getByRole("button").className).toContain("p-2");
  });

  it("merges custom className", () => {
    render(<IconButton icon={<X />} label="Close" className="extra" />);
    expect(screen.getByRole("button").className).toContain("extra");
  });

  it("renders the icon node", () => {
    render(<IconButton icon={<X data-testid="x-icon" />} label="Close" />);
    expect(screen.getByTestId("x-icon")).toBeTruthy();
  });

  it("applies md size classes by default", () => {
    render(<IconButton icon={<X />} label="Close" />);
    expect(screen.getByRole("button").className).toContain("p-1.5");
  });

  it("applies sm size classes", () => {
    render(<IconButton icon={<X />} label="Close" size="sm" />);
    expect(screen.getByRole("button").className).toContain("p-0.5");
  });

  it("applies base classes including focus-visible ring", () => {
    render(<IconButton icon={<X />} label="Close" />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("inline-flex");
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <IconButton icon={<X />} label="Close" disabled onClick={onClick} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("title and aria-label both reflect the label prop", () => {
    render(<IconButton icon={<X />} label="Loeschen" />);
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("title")).toBe("Loeschen");
    expect(btn.getAttribute("aria-label")).toBe("Loeschen");
  });

  it("has no explicit type attribute by default", () => {
    render(<IconButton icon={<X />} label="Close" />);
    expect(screen.getByRole("button").getAttribute("type")).toBeNull();
  });

  it("forwards type=button attribute", () => {
    render(<IconButton icon={<X />} label="Close" type="button" />);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("forwards arbitrary HTML attributes via rest props", () => {
    render(
      <IconButton icon={<X />} label="Close" data-testid="rest-icon-btn" />,
    );
    expect(screen.getByTestId("rest-icon-btn")).toBeTruthy();
  });

  it("forwards ref to the button element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<IconButton ref={ref} icon={<X />} label="Close" />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("has displayName IconButton", () => {
    expect(IconButton.displayName).toBe("IconButton");
  });

  it("fires onClick multiple times", () => {
    const onClick = vi.fn();
    render(<IconButton icon={<X />} label="Close" onClick={onClick} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
