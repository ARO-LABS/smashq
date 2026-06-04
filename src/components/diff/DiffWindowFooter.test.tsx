import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiffWindowFooter } from "./DiffWindowFooter";
import type { SessionDiff } from "./types";

const diff = (over: Partial<SessionDiff> = {}): SessionDiff => ({
  sessionId: "s1",
  snapshotCommit: "abc123",
  snapshotAt: "2026-05-19T08:30:00Z",
  computedAt: "2026-05-19T08:31:00Z",
  computeMs: 42,
  files: [],
  truncated: false,
  ...over,
});

const baseProps = {
  diff: null as SessionDiff | null,
  mode: "side" as const,
  onModeChange: vi.fn(),
  onRefresh: vi.fn(),
  refreshing: false,
  frozen: false,
};

describe("DiffWindowFooter", () => {
  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(<DiffWindowFooter {...baseProps} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByLabelText("Diff neu laden"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("disables the refresh button while refreshing", () => {
    render(<DiffWindowFooter {...baseProps} refreshing={true} />);
    expect(
      screen.getByLabelText("Diff neu laden").hasAttribute("disabled"),
    ).toBe(true);
  });

  it("disables the refresh button when the session is frozen", () => {
    render(<DiffWindowFooter {...baseProps} frozen={true} />);
    expect(
      screen.getByLabelText("Diff neu laden").hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows a placeholder snapshot time when there is no diff", () => {
    render(<DiffWindowFooter {...baseProps} diff={null} />);
    expect(screen.getByText("Snapshot —")).toBeTruthy();
  });

  it("formats the snapshot time as HH:MM", () => {
    render(
      <DiffWindowFooter
        {...baseProps}
        diff={diff({ snapshotAt: "2026-05-19T14:05:00Z" })}
      />,
    );
    // formatTime uses local time — assert the colon-separated shape only.
    expect(screen.getByText(/Snapshot \d{2}:\d{2}/)).toBeTruthy();
  });

  it("renders the compute duration in milliseconds", () => {
    render(
      <DiffWindowFooter {...baseProps} diff={diff({ computeMs: 137 })} />,
    );
    expect(screen.getByText("137 ms")).toBeTruthy();
  });

  it("uses the singular noun for exactly one file", () => {
    render(
      <DiffWindowFooter
        {...baseProps}
        diff={diff({ files: [{} as never] })}
      />,
    );
    expect(screen.getByText("1 Datei")).toBeTruthy();
  });

  it("uses the plural noun for multiple files", () => {
    render(
      <DiffWindowFooter
        {...baseProps}
        diff={diff({ files: [{}, {}] as never })}
      />,
    );
    expect(screen.getByText("2 Dateien")).toBeTruthy();
  });

  it("shows a truncation warning when the diff is truncated", () => {
    render(
      <DiffWindowFooter {...baseProps} diff={diff({ truncated: true })} />,
    );
    expect(screen.getByText("Gekuerzt — Budget erreicht")).toBeTruthy();
  });

  it("shows a frozen-session note when frozen", () => {
    render(<DiffWindowFooter {...baseProps} frozen={true} />);
    expect(screen.getByText("Session beendet")).toBeTruthy();
  });

  it("marks the active view mode with aria-checked", () => {
    render(<DiffWindowFooter {...baseProps} mode="inline" />);
    const inline = screen.getByText("Inline");
    expect(inline.getAttribute("aria-checked")).toBe("true");
  });

  it("calls onModeChange when a different mode is selected", () => {
    const onModeChange = vi.fn();
    render(
      <DiffWindowFooter
        {...baseProps}
        mode="side"
        onModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByText("Inline"));
    expect(onModeChange).toHaveBeenCalledWith("inline");
  });
});
