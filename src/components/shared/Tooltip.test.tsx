import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

function renderTooltip() {
  return render(
    <Tooltip content="Einstellungen (eigenes Fenster)">
      <button aria-label="Einstellungen">X</button>
    </Tooltip>,
  );
}

describe("Tooltip", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("erscheint erst nach dem Delay, nicht sofort", () => {
    vi.useFakeTimers();
    renderTooltip();

    fireEvent.mouseEnter(screen.getByRole("button").parentElement!);
    // Vor Ablauf des Delays kein Tooltip — sonst flackert jede Mausbewegung.
    expect(screen.queryByRole("tooltip")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Einstellungen (eigenes Fenster)",
    );
  });

  it("verschwindet beim Verlassen sofort und bricht wartende Timer ab", () => {
    vi.useFakeTimers();
    renderTooltip();
    const wrapper = screen.getByRole("button").parentElement!;

    // Kurzes Ueberstreichen: Enter + Leave vor Ablauf des Delays → nie sichtbar.
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.mouseLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();

    // Sichtbarer Tooltip verschwindet beim Verlassen ohne Verzoegerung.
    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.mouseLeave(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("reagiert auch auf Tastatur-Fokus des Triggers", () => {
    vi.useFakeTimers();
    renderTooltip();

    fireEvent.focus(screen.getByRole("button"));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.blur(screen.getByRole("button"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
