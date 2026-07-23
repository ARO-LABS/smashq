import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TerminalScrollbackSection } from "./TerminalScrollbackPanel";
import { useSettingsStore } from "../../store/settingsStore";

function setScrollback(lines: number) {
  useSettingsStore.setState((s) => ({
    preferences: { ...s.preferences, scrollbackLines: lines },
  }));
}

beforeEach(() => {
  setScrollback(25_000);
});

describe("TerminalScrollbackSection", () => {
  it("renders the section heading and the description", () => {
    render(<TerminalScrollbackSection />);
    expect(
      screen.getByRole("heading", { level: 4, name: "Terminal-Verlauf" }),
    ).toBeTruthy();
    // Frühere Panel-Header-Beschreibung lebt als erster Absatz in der Sektion weiter.
    expect(
      screen.getByText(/Wie viele Zeilen pro Terminal im Speicher gehalten werden/),
    ).toBeTruthy();
  });

  it("reflects the persisted scrollback value in the select", () => {
    setScrollback(10_000);
    render(<TerminalScrollbackSection />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(Number(select.value)).toBe(10_000);
  });

  it("writes the new value to settings when the select changes", () => {
    render(<TerminalScrollbackSection />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "50000" } });
    expect(useSettingsStore.getState().preferences.scrollbackLines).toBe(
      50_000,
    );
  });

  it("shows a RAM warning when the value reaches 50 000 lines", () => {
    setScrollback(50_000);
    render(<TerminalScrollbackSection />);
    expect(screen.getByText(/125 MB pro Terminal/)).toBeTruthy();
  });

  it("does not show the RAM warning below 50 000 lines", () => {
    setScrollback(10_000);
    render(<TerminalScrollbackSection />);
    expect(screen.queryByText(/125 MB pro Terminal/)).toBeNull();
  });

  it("labels the 25 000 preset as the standard option", () => {
    render(<TerminalScrollbackSection />);
    expect(screen.getByText(/\(Standard\)/)).toBeTruthy();
  });
});
