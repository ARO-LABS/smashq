import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  // ── Happy path ────────────────────────────────────────────────────

  it("renders active dot with accent background and pulse animation", () => {
    const { container } = render(<StatusDot status="active" />);
    const dot = screen.getByRole("img", { name: "in Arbeit" });
    // Active state must carry bg-accent and the design-token pulse (exponential easing, matches StatusBadge)
    expect(dot.className).toContain("bg-accent");
    expect(dot.className).toContain("status-pulse-animation");
    // Confirm no border class is applied (distinguishes it from open ring)
    expect(dot.className).not.toContain("border");
    // Size defaults to 8px
    expect((dot as HTMLElement).style.width).toBe("8px");
    expect(container.firstChild).toBeTruthy();
  });

  // ── Edge cases ────────────────────────────────────────────────────

  it("renders done dot with success background and no pulse", () => {
    const { container } = render(<StatusDot status="done" size={14} />);
    const dot = screen.getByRole("img", { name: "erledigt" });
    expect(dot.className).toContain("bg-success");
    expect(dot.className).not.toContain("status-pulse-animation");
    // Custom size is applied
    expect((dot as HTMLElement).style.width).toBe("14px");
    expect(container.firstChild).toBeTruthy();
  });

  it("renders open dot as hollow ring (border, no bg fill) at size+1", () => {
    render(<StatusDot status="open" size={8} />);
    const dot = screen.getByRole("img", { name: "offen" });
    // Hollow ring: border present, no filled background classes
    expect(dot.className).toContain("border-neutral-500");
    expect(dot.className).not.toContain("bg-accent");
    expect(dot.className).not.toContain("bg-success");
    // Open ring is rendered 1px larger than the passed size (visual weight balance)
    expect((dot as HTMLElement).style.width).toBe("9px");
  });
});
