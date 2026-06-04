import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders with status as aria-label when no label provided", () => {
    render(<StatusBadge status="idle" />);
    expect(screen.getByLabelText("idle")).toBeTruthy();
  });

  it("renders custom label text and uses it for aria-label", () => {
    render(<StatusBadge status="active" label="Aktiv" />);
    expect(screen.getByText("Aktiv")).toBeTruthy();
    expect(screen.getByLabelText("Aktiv")).toBeTruthy();
  });

  it("does not render label span when label is undefined", () => {
    const { container } = render(<StatusBadge status="done" />);
    // Only the dot span, no text span
    const spans = container.querySelectorAll("span > span");
    expect(spans.length).toBe(1); // just the dot
  });

  it("applies pulse animation for active status by default", () => {
    const { container } = render(<StatusBadge status="active" label="Running" />);
    const dot = container.querySelector(".status-pulse-animation");
    expect(dot).toBeTruthy();
  });

  it("applies pulse animation for running status by default", () => {
    const { container } = render(<StatusBadge status="running" />);
    const dot = container.querySelector(".status-pulse-animation");
    expect(dot).toBeTruthy();
  });

  it("does not pulse for idle status by default", () => {
    const { container } = render(<StatusBadge status="idle" />);
    const dot = container.querySelector(".status-pulse-animation");
    expect(dot).toBeNull();
  });

  it("overrides pulse with explicit pulse=true", () => {
    const { container } = render(<StatusBadge status="idle" pulse={true} />);
    const dot = container.querySelector(".status-pulse-animation");
    expect(dot).toBeTruthy();
  });

  it("overrides pulse with explicit pulse=false", () => {
    const { container } = render(<StatusBadge status="active" pulse={false} />);
    const dot = container.querySelector(".status-pulse-animation");
    expect(dot).toBeNull();
  });

  it("renders small size with correct classes", () => {
    const { container } = render(<StatusBadge status="done" size="sm" label="OK" />);
    const dot = container.querySelector(".w-1\\.5");
    expect(dot).toBeTruthy();
  });

  it("renders large size with correct classes", () => {
    const { container } = render(<StatusBadge status="error" size="lg" label="Fehler" />);
    const dot = container.querySelector(".w-2\\.5");
    expect(dot).toBeTruthy();
  });

  it("applies error dot color for error status", () => {
    const { container } = render(<StatusBadge status="error" />);
    const dot = container.querySelector(".bg-error");
    expect(dot).toBeTruthy();
  });

  it("applies success dot color for done status", () => {
    const { container } = render(<StatusBadge status="done" />);
    const dot = container.querySelector(".bg-success");
    expect(dot).toBeTruthy();
  });
});
