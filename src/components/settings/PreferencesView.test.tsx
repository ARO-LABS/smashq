import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { PreferencesView } from "./PreferencesView";
import { useSettingsStore } from "../../store/settingsStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

describe("PreferencesView", () => {
  it("renders the page header and the CategoryNav with all 7 categories", () => {
    render(<PreferencesView />);
    expect(screen.getByRole("heading", { level: 2, name: /Einstellungen/i })).toBeTruthy();
    // The left nav exposes all 7 category labels at all times.
    expect(screen.getByRole("button", { name: /Darstellung/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sessions/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Terminal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Benachrichtigungen/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /System/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Erweitert/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Über/i })).toBeTruthy();
  });

  it("loads the default active panel (Darstellung) on initial render", async () => {
    render(<PreferencesView />);
    // ThemePanel renders an h3 with "Darstellung" — confirms the lazy panel
    // for the first category resolves and mounts.
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /^Darstellung$/i })).toBeTruthy();
    });
  });

  it("renders the terminal-theme-sync toggle (default off) and wires it to setTheme", async () => {
    // Ensure a known default before rendering.
    act(() => {
      useSettingsStore.setState((s) => ({ theme: { ...s.theme, syncTerminalTheme: false } }));
    });
    render(<PreferencesView />);

    const toggle = await screen.findByRole("switch", {
      name: /Terminal-Farben an App-Theme koppeln/i,
    });
    // Default off — the reported collision stays disabled until opted in.
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    act(() => {
      fireEvent.click(toggle);
    });
    expect(useSettingsStore.getState().theme.syncTerminalTheme).toBe(true);

    // Reset so later tests see the default.
    act(() => {
      useSettingsStore.setState((s) => ({ theme: { ...s.theme, syncTerminalTheme: false } }));
    });
  });

  it("switches the active panel when a different category is clicked", async () => {
    render(<PreferencesView />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /^Darstellung$/i })).toBeTruthy();
    });

    // Navigate to "Sessions" → NewSessionDefaultsPanel mounts via lazy.
    fireEvent.click(screen.getByRole("button", { name: /^Sessions$/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /Neue Session/i })).toBeTruthy();
    });
    // Old panel is gone — only one panel renders at a time.
    expect(screen.queryByRole("heading", { level: 3, name: /^Darstellung$/i })).toBeNull();
  });

  describe("SaveStatusIndicator", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("zeigt nach einer Settings-Aenderung 'Speichern…', dann 'Gespeichert', dann nichts", () => {
      vi.useFakeTimers();
      render(<PreferencesView />);

      // Kein Status vor der ersten Aenderung.
      expect(screen.queryByText(/Speichern…|Gespeichert/)).toBeNull();

      act(() => {
        useSettingsStore.setState({ defaultShell: "powershell" });
      });
      expect(screen.getByText("Speichern…")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByText("Gespeichert")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText("Gespeichert")).toBeNull();
    });

    it("haelt bei schnellen Folge-Aenderungen 'Speichern…' und meldet erst danach", () => {
      vi.useFakeTimers();
      render(<PreferencesView />);

      act(() => {
        useSettingsStore.setState({ defaultShell: "cmd" });
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      // Zweite Aenderung innerhalb des Fensters resettet den Timer.
      act(() => {
        useSettingsStore.setState({ defaultShell: "auto" });
      });
      expect(screen.getByText("Speichern…")).toBeTruthy();
      expect(screen.queryByText("Gespeichert")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.getByText("Gespeichert")).toBeTruthy();
    });
  });
});
