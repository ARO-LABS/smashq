import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PreferencesView } from "./PreferencesView";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

describe("PreferencesView", () => {
  it("renders the page header and the CategoryNav with all 6 categories", () => {
    render(<PreferencesView />);
    expect(screen.getByRole("heading", { level: 2, name: /Einstellungen/i })).toBeTruthy();
    // The left nav exposes all 6 category labels at all times.
    expect(screen.getByRole("button", { name: /Darstellung/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sessions/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Terminal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Benachrichtigungen/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Sidebar/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Erweitert/i })).toBeTruthy();
  });

  it("loads the default active panel (Darstellung) on initial render", async () => {
    render(<PreferencesView />);
    // ThemePanel renders an h3 with "Darstellung" — confirms the lazy panel
    // for the first category resolves and mounts.
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: /^Darstellung$/i })).toBeTruthy();
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
});
