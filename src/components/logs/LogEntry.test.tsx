import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogEntryRow, LOG_ROW_HEIGHT } from "./LogEntry";
import type { GroupedLogEntry } from "../../store/logViewerStore";

const entry = (over: Partial<GroupedLogEntry> = {}): GroupedLogEntry => ({
  id: 1,
  timestamp: "2026-05-19T14:05:09.123Z",
  severity: "info",
  source: "frontend",
  message: "something happened",
  count: 1,
  ...over,
});

describe("LOG_ROW_HEIGHT", () => {
  it("exposes a fixed positive row height for virtualization", () => {
    expect(LOG_ROW_HEIGHT).toBeGreaterThan(0);
  });
});

describe("LogEntryRow", () => {
  it("renders the log message", () => {
    render(<LogEntryRow entry={entry({ message: "boot complete" })} />);
    expect(screen.getByText("boot complete")).toBeTruthy();
  });

  it("renders the severity label", () => {
    render(<LogEntryRow entry={entry({ severity: "error" })} />);
    expect(screen.getByText("error")).toBeTruthy();
  });

  it("renders the source label", () => {
    render(<LogEntryRow entry={entry({ source: "backend" })} />);
    expect(screen.getByText("backend")).toBeTruthy();
  });

  it("shows a count badge when the entry is grouped", () => {
    render(<LogEntryRow entry={entry({ count: 4 })} />);
    expect(screen.getByText("×4")).toBeTruthy();
  });

  it("hides the count badge for a single entry", () => {
    render(<LogEntryRow entry={entry({ count: 1 })} />);
    expect(screen.queryByText("×1")).toBeNull();
  });

  it("renders the module name when present", () => {
    render(<LogEntryRow entry={entry({ module: "sessionStore" })} />);
    expect(screen.getByText("sessionStore")).toBeTruthy();
  });

  it("does not render a stack trace until expanded", () => {
    const { container } = render(
      <LogEntryRow entry={entry({ stack: "at foo()\nat bar()" })} />,
    );
    expect(container.querySelector("pre")).toBeNull();
  });

  it("reveals the stack trace when a row with a stack is clicked", () => {
    const { container } = render(
      <LogEntryRow
        entry={entry({ message: "crash", stack: "at foo()\nat bar()" })}
      />,
    );
    fireEvent.click(screen.getByText("crash"));
    expect(container.querySelector("pre")?.textContent).toContain("at foo()");
  });

  it("collapses the stack trace again on a second click", () => {
    const { container } = render(
      <LogEntryRow entry={entry({ message: "crash", stack: "at foo()" })} />,
    );
    fireEvent.click(screen.getByText("crash"));
    fireEvent.click(screen.getByText("crash"));
    expect(container.querySelector("pre")).toBeNull();
  });
});
