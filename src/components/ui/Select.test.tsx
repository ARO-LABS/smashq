import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";

const OPTIONS = [
  { value: "5000", label: "5 000 Zeilen" },
  { value: "10000", label: "10 000 Zeilen" },
];

describe("Select", () => {
  it("rendert Label + Optionen und meldet Auswahl", () => {
    const onChange = vi.fn();
    render(<Select label="Scrollback-Zeilen" value="5000" options={OPTIONS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Scrollback-Zeilen"), { target: { value: "10000" } });
    expect(onChange).toHaveBeenCalledWith("10000");
  });

  it("respektiert disabled", () => {
    render(<Select label="Standard-Shell" value="5000" options={OPTIONS} onChange={() => {}} disabled />);
    expect(screen.getByLabelText("Standard-Shell")).toBeDisabled();
  });
});
