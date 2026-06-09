import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";
import { Plus } from "lucide-react";
import { ICONS } from "../../utils/icons";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("Button", () => {
  it("renders children text", () => {
    render(<Button>Klick mich</Button>);
    expect(screen.getByRole("button", { name: "Klick mich" })).toBeTruthy();
  });

  it("calls onClick handler", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Test</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled when disabled prop is set", () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("is disabled when loading", () => {
    render(<Button loading>Laden</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows spinner when loading", () => {
    const { container } = render(<Button loading>Laden</Button>);
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the registry loading icon (ICONS.action.loading) when loading", () => {
    const LoadingIcon = ICONS.action.loading;
    const { container: refContainer } = render(
      <LoadingIcon data-testid="ref-loading" />,
    );
    const refIcon = refContainer.querySelector("svg");
    const { container } = render(<Button loading>Laden</Button>);
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();
    // Same Lucide glyph class as the registry icon -> identical icon used.
    expect(spinner?.getAttribute("class")).toContain(
      refIcon?.getAttribute("class")?.split(" ").find((c) => c.startsWith("lucide-")) ?? "lucide",
    );
  });

  it("renders no spinner glyph when not loading (edge: idle state)", () => {
    const { container } = render(<Button>Bereit</Button>);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("renders icon when provided", () => {
    render(<Button icon={<Plus data-testid="icon" />}>Mit Icon</Button>);
    expect(screen.getByTestId("icon")).toBeTruthy();
  });

  it("does not show icon when loading (spinner replaces it)", () => {
    render(
      <Button loading icon={<Plus data-testid="icon" />}>
        Laden
      </Button>,
    );
    expect(screen.queryByTestId("icon")).toBeNull();
  });

  it("applies primary variant classes", () => {
    render(<Button variant="primary">Primary</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("bg-accent");
  });

  it("applies danger variant classes", () => {
    render(<Button variant="danger">Danger</Button>);
    const btn = screen.getByRole("button");
    // Concept B: danger uses bg-error tint instead of border-red-500 outline.
    expect(btn.className).toContain("bg-error");
  });

  it("applies size classes", () => {
    render(<Button size="sm">Klein</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("py-1");
  });

  it("merges custom className", () => {
    render(<Button className="my-custom">Custom</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("my-custom");
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not fire onClick when loading", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Laden
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies secondary variant classes by default", () => {
    render(<Button>Default</Button>);
    // Concept B: secondary uses bg-surface-raised + shadow-hairline (no border).
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("bg-surface-raised");
    expect(cls).toContain("shadow-hairline");
  });

  it("applies ghost variant classes", () => {
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("text-neutral-400");
    expect(btn.className).not.toContain("bg-accent");
  });

  it("applies md size classes by default", () => {
    render(<Button>Medium</Button>);
    // Concept B retuned paddings to feel right against rounded-md radius:
    // sm px-2.5 py-1, md px-3 py-1.5, lg px-4 py-2.
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("px-3");
    expect(btn.className).toContain("py-1.5");
  });

  it("applies lg size classes", () => {
    render(<Button size="lg">Gross</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("px-4");
    expect(btn.className).toContain("text-sm");
  });

  it("applies base classes including focus-visible ring", () => {
    render(<Button>Base</Button>);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("inline-flex");
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("disabled:cursor-not-allowed");
  });

  it("does not render icon span when no icon and not loading", () => {
    const { container } = render(<Button>Plain</Button>);
    expect(container.querySelector(".shrink-0")).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("wraps icon in a shrink-0 span", () => {
    const { container } = render(
      <Button icon={<Plus data-testid="icon" />}>Mit Icon</Button>,
    );
    const span = container.querySelector("span.shrink-0");
    expect(span).toBeTruthy();
    expect(span?.querySelector('[data-testid="icon"]')).toBeTruthy();
  });

  it("renders icon alongside children text", () => {
    render(<Button icon={<Plus data-testid="icon" />}>Hinzufuegen</Button>);
    expect(screen.getByTestId("icon")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hinzufuegen" })).toBeTruthy();
  });

  it("has no explicit type attribute by default", () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBeNull();
  });

  it("forwards type=button attribute", () => {
    render(<Button type="button">Button</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });

  it("forwards arbitrary HTML attributes via rest props", () => {
    render(
      <Button data-testid="rest-btn" aria-label="Aktion">
        Rest
      </Button>,
    );
    const btn = screen.getByTestId("rest-btn");
    expect(btn.getAttribute("aria-label")).toBe("Aktion");
  });

  it("forwards ref to the button element", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it("has displayName Button", () => {
    expect(Button.displayName).toBe("Button");
  });

  it("renders without children", () => {
    render(<Button icon={<Plus data-testid="icon" />} aria-label="Nur Icon" />);
    expect(screen.getByRole("button", { name: "Nur Icon" })).toBeTruthy();
  });

  it("fires onClick multiple times", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Multi</Button>);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(3);
  });
});
