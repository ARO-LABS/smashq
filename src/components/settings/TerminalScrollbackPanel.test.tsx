import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalScrollbackPanel } from "./TerminalScrollbackPanel";
import { useSettingsStore } from "../../store/settingsStore";

function setScrollback(lines: number) {
  useSettingsStore.setState((s) => ({
    preferences: { ...s.preferences, scrollbackLines: lines },
  }));
}

beforeEach(() => {
  setScrollback(25_000);
});

describe("TerminalScrollbackPanel", () => {
  it("renders the panel heading", () => {
    render(<TerminalScrollbackPanel />);
    expect(screen.getByText("Terminal-Verlauf")).toBeTruthy();
  });

  it("reflects the persisted scrollback value in the select", () => {
    setScrollback(10_000);
    render(<TerminalScrollbackPanel />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Number(select.value)).toBe(10_000);
  });

  it("writes the new value to settings when the select changes", () => {
    render(<TerminalScrollbackPanel />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "50000" } });
    expect(useSettingsStore.getState().preferences.scrollbackLines).toBe(
      50_000,
    );
  });

  it("shows a RAM warning when the value reaches 50 000 lines", () => {
    setScrollback(50_000);
    render(<TerminalScrollbackPanel />);
    expect(screen.getByText(/125 MB pro Terminal/)).toBeTruthy();
  });

  it("does not show the RAM warning below 50 000 lines", () => {
    setScrollback(10_000);
    render(<TerminalScrollbackPanel />);
    expect(screen.queryByText(/125 MB pro Terminal/)).toBeNull();
  });

  it("labels the 25 000 preset as the standard option", () => {
    render(<TerminalScrollbackPanel />);
    expect(screen.getByText(/\(Standard\)/)).toBeTruthy();
  });
});
