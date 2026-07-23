import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToggleSwitch } from "./ToggleSwitch";

describe("ToggleSwitch", () => {
  it("toggelt beim Klick und meldet den neuen Wert", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Sound aktiviert" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Sound aktiviert" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("ignoriert Klicks im disabled-Zustand", () => {
    const onChange = vi.fn();
    render(<ToggleSwitch label="Pipeline-Fehler" checked disabled onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Pipeline-Fehler" });
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("rendert optionale Beschreibung", () => {
    render(
      <ToggleSwitch label="Log-Datei (NDJSON)" description="Schreibt app-log.ndjson" checked onChange={() => {}} />,
    );
    expect(screen.getByText("Schreibt app-log.ndjson")).toBeInTheDocument();
  });
});
