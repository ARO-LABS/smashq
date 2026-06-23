import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenMdPathInput } from "./OpenMdPathInput";

describe("OpenMdPathInput", () => {
  it("calls onOpen with the trimmed path on submit and clears the field", () => {
    const onOpen = vi.fn();
    render(<OpenMdPathInput onOpen={onOpen} />);
    const input = screen.getByLabelText("Pfad zur Markdown-Datei") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  ./tasks/todo.md  " } });
    fireEvent.click(screen.getByLabelText("Markdown-Datei öffnen"));
    expect(onOpen).toHaveBeenCalledWith("./tasks/todo.md");
    expect(input.value).toBe("");
  });

  it("does not call onOpen for an empty path", () => {
    const onOpen = vi.fn();
    render(<OpenMdPathInput onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Markdown-Datei öffnen"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
