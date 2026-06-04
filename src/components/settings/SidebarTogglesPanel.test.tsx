import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SidebarTogglesPanel } from "./SidebarTogglesPanel";
import { useSettingsStore } from "../../store/settingsStore";

describe("SidebarTogglesPanel", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
        showProtokolleTab: false,
        scrollbackLines: 25_000,
      },
    });
  });

  it("renders the Protokolle toggle unchecked by default", () => {
    render(<SidebarTogglesPanel />);
    const checkbox = screen.getByRole("checkbox", { name: /Protokolle-Tab anzeigen/i });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("flips preferences.showProtokolleTab when toggled", () => {
    render(<SidebarTogglesPanel />);
    const checkbox = screen.getByRole("checkbox", { name: /Protokolle-Tab anzeigen/i });
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().preferences.showProtokolleTab).toBe(true);
    fireEvent.click(checkbox);
    expect(useSettingsStore.getState().preferences.showProtokolleTab).toBe(false);
  });
});
