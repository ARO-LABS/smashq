import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Stage } from "./Stage";

describe("Stage", () => {
  it("renders label, child and stable data attributes (happy path)", () => {
    render(
      <Stage id="button-primary" label="Primary" state="default" interactive>
        <button>Klick</button>
      </Stage>,
    );
    const el = screen.getByTestId("stage-button-primary");
    expect(el).toHaveAttribute("data-dg-id", "button-primary");
    expect(el).toHaveAttribute("data-dg-state", "default");
    expect(el).toHaveAttribute("data-dg-interactive", "true");
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Klick" })).toBeInTheDocument();
  });

  it("catches a throwing child and shows an error card (edge case)", () => {
    const Boom = (): JSX.Element => {
      throw new Error("boom");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <Stage id="broken" label="Broken">
        <Boom />
      </Stage>,
    );
    expect(screen.getByTestId("stage-broken")).toHaveAttribute("data-dg-error", "true");
    expect(screen.getByText(/Render-Fehler/i)).toBeInTheDocument();
  });
});
