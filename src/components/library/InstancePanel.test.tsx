import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InstancePanel } from "./InstancePanel";

describe("InstancePanel", () => {
  it("renders the Best Practices heading", () => {
    render(<InstancePanel />);
    expect(screen.getByText("Best Practices")).toBeTruthy();
  });

  it("renders the M4 placeholder note", () => {
    render(<InstancePanel />);
    expect(
      screen.getByText(/Indikator-Chips, Quotes/),
    ).toBeTruthy();
  });

  it("renders without throwing and produces output", () => {
    const { container } = render(<InstancePanel />);
    expect(container.firstChild).not.toBeNull();
  });
});
