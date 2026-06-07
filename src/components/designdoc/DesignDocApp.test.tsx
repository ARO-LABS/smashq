import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DesignDocApp } from "./DesignDocApp";

describe("DesignDocApp", () => {
  it("renders the design doc root", () => {
    render(<DesignDocApp />);
    expect(screen.getByTestId("designdoc-root")).toBeInTheDocument();
  });
});
