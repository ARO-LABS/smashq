import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WhatsNewModal } from "./WhatsNewModal";
import type { WhatsNewEntry } from "../../whatsNew";

// ── Mocks ─────────────────────────────────────────────────────────────

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-shell", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

// ── Fixture ───────────────────────────────────────────────────────────

const ENTRY: WhatsNewEntry = {
  version: "1.0.22",
  date: "2026-07-08",
  intro: "Test-Intro fuer das Update.",
  highlights: [
    { icon: "restore", title: "Highlight Eins", text: "Beschreibung eins." },
    { icon: "edit", title: "Highlight Zwei", text: "Beschreibung zwei." },
  ],
  watchouts: ["Achtung Punkt eins.", "Achtung Punkt zwei."],
};

describe("WhatsNewModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header, version chip, intro, all highlights and watchouts", () => {
    render(<WhatsNewModal entry={ENTRY} onClose={vi.fn()} />);

    expect(screen.getByText("Was ist neu")).toBeTruthy();
    expect(screen.getByText("v1.0.22")).toBeTruthy();
    expect(screen.getByText("Test-Intro fuer das Update.")).toBeTruthy();
    expect(screen.getByText("Highlight Eins")).toBeTruthy();
    expect(screen.getByText("Beschreibung zwei.")).toBeTruthy();
    expect(screen.getByText("Worauf achten")).toBeTruthy();
    expect(screen.getByText("Achtung Punkt eins.")).toBeTruthy();
    expect(screen.getByText("Achtung Punkt zwei.")).toBeTruthy();
  });

  it("renders nothing when entry is null", () => {
    const { container } = render(<WhatsNewModal entry={null} onClose={vi.fn()} />);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("'Verstanden' calls onClose", () => {
    const onClose = vi.fn();
    render(<WhatsNewModal entry={ENTRY} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Verstanden" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("changelog link opens the GitHub changelog externally", () => {
    render(<WhatsNewModal entry={ENTRY} onClose={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Vollständiges Changelog" }),
    );
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("CHANGELOG.md"),
    );
  });

  it("feedback link opens the GitHub issues page externally", () => {
    render(<WhatsNewModal entry={ENTRY} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Feedback geben" }));
    expect(mockOpen).toHaveBeenCalledWith(expect.stringContaining("issues"));
  });
});
