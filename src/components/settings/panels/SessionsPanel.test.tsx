import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionsPanel } from "./SessionsPanel";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));

/**
 * Guard für die Tab-Konsolidierung (Issue #52): der Sessions-Tab komponiert
 * die früheren Einzel-Tabs "Sessions" und "Terminal" — kein Feld und kein
 * Text darf dabei verloren gehen.
 */
describe("SessionsPanel", () => {
  it("rendert Panel-Header und beide Sektionen (happy path)", () => {
    render(<SessionsPanel />);
    expect(screen.getByRole("heading", { level: 3, name: "Sessions" })).toBeTruthy();
    expect(
      screen.getByText(
        "Defaults für neue Sessions und wie viel Terminal-Verlauf im Speicher gehalten wird.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Neue Session" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Terminal-Verlauf" })).toBeTruthy();
  });

  it("behält die früheren Panel-Beschreibungen als Sektions-Absätze (kein Textverlust)", () => {
    render(<SessionsPanel />);
    // Ex-Beschreibung des Sessions-Tabs (inkl. Inline-Span "+ Neue Session").
    expect(
      screen.getByText(/Diese Werte starten beim Klick auf/),
    ).toBeTruthy();
    // Ex-Beschreibung des Terminal-Tabs.
    expect(
      screen.getByText(/Wie viele Zeilen pro Terminal im Speicher gehalten werden/),
    ).toBeTruthy();
    // Kernfelder beider Sektionen sind erreichbar.
    expect(screen.getByLabelText(/Standard-Shell/i)).toBeTruthy();
    expect(screen.getByLabelText(/Permission-Modus/i)).toBeTruthy();
    expect(screen.getByText("Standard-Projektordner")).toBeTruthy();
    expect(screen.getByLabelText(/Scrollback-Zeilen/i)).toBeTruthy();
  });
});
