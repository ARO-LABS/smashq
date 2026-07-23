import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DebugLoggingPanel } from "./DebugLoggingPanel";
import { useSettingsStore } from "../../store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

describe("DebugLoggingPanel", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
  });

  it("renders Komplett-aus radio selected by default", () => {
    render(<DebugLoggingPanel />);
    const offRadio = screen.getByRole("radio", { name: /Komplett aus/i });
    expect((offRadio as HTMLInputElement).checked).toBe(true);
  });

  it("disables sub-checkboxes while master is off", () => {
    render(<DebugLoggingPanel />);
    const sub = screen.getByRole("switch", { name: /Frontend-Errors/i });
    expect(sub).toBeDisabled();
  });

  it("enables frontendLogging when master is switched on", () => {
    render(<DebugLoggingPanel />);
    const onRadio = screen.getByRole("radio", { name: /Aktiviert/i });
    fireEvent.click(onRadio);
    expect(useSettingsStore.getState().preferences.frontendLogging).toBe(true);
  });

  it("toggles a sub-checkbox independently while master is on", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    const backendBox = screen.getByRole("switch", { name: /Log-Datei/i });
    fireEvent.click(backendBox);
    expect(useSettingsStore.getState().preferences.backendFileLogging).toBe(true);
  });

  it("clears all sub-toggles when master is switched off", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: true,
        performanceProfiler: true,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    const offRadio = screen.getByRole("radio", { name: /Komplett aus/i });
    fireEvent.click(offRadio);
    const prefs = useSettingsStore.getState().preferences;
    expect(prefs.frontendLogging).toBe(false);
    expect(prefs.backendFileLogging).toBe(false);
    expect(prefs.performanceProfiler).toBe(false);
  });

  it("renders the panel heading and all three sub-toggle labels", () => {
    render(<DebugLoggingPanel />);
    // "Debug-Logging" existiert vorübergehend doppelt (Panel-h3 + Sektions-h4);
    // die Tab-Konsolidierung (Task 7) löst die Dopplung im selben PR auf —
    // daher Heading-Level-Query statt getByText.
    expect(screen.getByRole("heading", { level: 3, name: "Debug-Logging" })).toBeTruthy();
    expect(screen.getByText("Frontend-Errors")).toBeTruthy();
    expect(screen.getByText("Log-Datei (NDJSON)")).toBeTruthy();
    expect(screen.getByText("Performance-Profiler")).toBeTruthy();
  });

  it("shows Aktiviert radio unselected by default", () => {
    render(<DebugLoggingPanel />);
    const onRadio = screen.getByRole("radio", { name: /Aktiviert/i }) as HTMLInputElement;
    expect(onRadio.checked).toBe(false);
  });

  it("treats any single enabled flag as master-on", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: false,
        backendFileLogging: true,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    const onRadio = screen.getByRole("radio", { name: /Aktiviert/i }) as HTMLInputElement;
    const offRadio = screen.getByRole("radio", { name: /Komplett aus/i }) as HTMLInputElement;
    expect(onRadio.checked).toBe(true);
    expect(offRadio.checked).toBe(false);
  });

  it("master-on resets to frontend-only even from a mixed sub-toggle state", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Aktiviert/i }));
    const prefs = useSettingsStore.getState().preferences;
    expect(prefs.frontendLogging).toBe(true);
    expect(prefs.backendFileLogging).toBe(false);
    expect(prefs.performanceProfiler).toBe(false);
  });

  it("enables all sub-checkboxes once master is on", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    for (const name of [/Frontend-Errors/i, /Log-Datei/i, /Performance-Profiler/i]) {
      const box = screen.getByRole("switch", { name });
      expect(box).not.toBeDisabled();
    }
  });

  it("reflects a sub-checkbox checked state from the store", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: true,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    const profiler = screen.getByRole("switch", { name: /Performance-Profiler/i });
    expect(profiler).toBeChecked();
  });

  it("unchecking the last enabled sub-toggle flips master back to off", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    const frontendBox = screen.getByRole("switch", { name: /Frontend-Errors/i });
    fireEvent.click(frontendBox);
    // No flags left enabled — anyEnabled is false, Komplett-aus is now selected
    expect(useSettingsStore.getState().preferences.frontendLogging).toBe(false);
    const offRadio = screen.getByRole("radio", { name: /Komplett aus/i }) as HTMLInputElement;
    expect(offRadio.checked).toBe(true);
  });

  it("toggling a sub-checkbox does not disturb other flags", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: true,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 25_000,
      },
    });
    render(<DebugLoggingPanel />);
    fireEvent.click(screen.getByRole("switch", { name: /Performance-Profiler/i }));
    const prefs = useSettingsStore.getState().preferences;
    expect(prefs.frontendLogging).toBe(true);
    expect(prefs.performanceProfiler).toBe(true);
    expect(prefs.backendFileLogging).toBe(false);
  });

  it("preserves unrelated preferences when master is toggled", () => {
    useSettingsStore.setState({
      preferences: {
        frontendLogging: false,
        backendFileLogging: false,
        performanceProfiler: false,
        scrollbackLines: 12_345,
      },
    });
    render(<DebugLoggingPanel />);
    fireEvent.click(screen.getByRole("radio", { name: /Aktiviert/i }));
    const prefs = useSettingsStore.getState().preferences;
    // scrollbackLines is unrelated to the logging master toggle and must survive.
    expect(prefs.scrollbackLines).toBe(12_345);
  });
});
