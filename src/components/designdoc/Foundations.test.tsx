import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Foundations } from "./Foundations";

describe("Foundations", () => {
  it("renders a swatch for the accent token (happy path)", () => {
    render(<Foundations />);
    expect(screen.getByTestId("token-color-accent")).toBeInTheDocument();
  });
});
