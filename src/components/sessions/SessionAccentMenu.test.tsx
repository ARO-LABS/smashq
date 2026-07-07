import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionAccentMenu } from "./SessionAccentMenu";

describe("SessionAccentMenu", () => {
  const base = { x: 10, y: 10, current: "azure" as const, hasOverride: false };

  it("renders a swatch button per palette color", () => {
    render(<SessionAccentMenu {...base} onSelect={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /violet/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(5);
  });

  it("calls onSelect with the chosen accent name", () => {
    const onSelect = vi.fn();
    render(<SessionAccentMenu {...base} onSelect={onSelect} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /amber/i }));
    expect(onSelect).toHaveBeenCalledWith("amber");
  });

  it("shows reset only when an override exists", () => {
    const { rerender } = render(
      <SessionAccentMenu {...base} hasOverride={false} onSelect={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /zurücksetzen/i })).toBeNull();
    rerender(
      <SessionAccentMenu {...base} hasOverride={true} onSelect={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /zurücksetzen/i })).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<SessionAccentMenu {...base} onSelect={vi.fn()} onReset={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
