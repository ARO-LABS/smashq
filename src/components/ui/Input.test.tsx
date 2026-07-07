import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "./Input";
import { ICONS } from "../../utils/icons";

const Search = ICONS.action.search;

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("Input", () => {
  it("renders with placeholder", () => {
    render(<Input placeholder="Suchen..." />);
    expect(screen.getByPlaceholderText("Suchen...")).toBeTruthy();
  });

  it("renders label and links it to input", () => {
    render(<Input label="Ordner" />);
    const label = screen.getByText("Ordner");
    expect(label.tagName).toBe("LABEL");
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("id")).toBe("input-ordner");
    expect(label.getAttribute("for")).toBe("input-ordner");
  });

  it("renders error message", () => {
    render(<Input error="Pflichtfeld" />);
    expect(screen.getByText("Pflichtfeld")).toBeTruthy();
  });

  it("applies error ring when error is set", () => {
    render(<Input error="Fehler" />);
    const input = screen.getByRole("textbox");
    // Concept B: error state uses ring-1 ring-error inset, not border-color shift.
    expect(input.className).toContain("ring-error");
  });

  it("applies hairline shadow at rest when no error", () => {
    render(<Input />);
    const input = screen.getByRole("textbox");
    // Concept B replaces the border-neutral-700 outline with shadow-hairline.
    expect(input.className).toContain("shadow-hairline");
    expect(input.className).not.toContain("ring-error");
  });

  it("renders icon", () => {
    render(<Input icon={<Search data-testid="search-icon" />} />);
    expect(screen.getByTestId("search-icon")).toBeTruthy();
  });

  it("adds left padding when icon is present", () => {
    render(<Input icon={<Search />} />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("pl-7");
  });

  it("fires onChange", () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "test" },
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("supports readOnly", () => {
    render(<Input readOnly value="Nur lesen" />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
  });

  it("supports disabled", () => {
    render(<Input disabled />);
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("applies size sm classes", () => {
    render(<Input size="sm" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("py-1");
    expect(input.className).toContain("text-xs");
  });

  it("applies size md classes by default", () => {
    render(<Input />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("px-3");
    expect(input.className).toContain("py-2");
    expect(input.className).toContain("text-sm");
  });

  it("does not render label element when no label", () => {
    const { container } = render(<Input />);
    expect(container.querySelector("label")).toBeNull();
  });

  it("does not render error span when no error", () => {
    render(<Input />);
    expect(screen.queryByText(/Fehler/)).toBeNull();
  });

  it("uses explicit id over derived id", () => {
    render(<Input label="Name" id="custom-id" />);
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("id")).toBe("custom-id");
    expect(screen.getByText("Name").getAttribute("for")).toBe("custom-id");
  });

  it("derives id with hyphens from multi-word label", () => {
    render(<Input label="Mein Ordner Pfad" />);
    expect(screen.getByRole("textbox").getAttribute("id")).toBe(
      "input-mein-ordner-pfad",
    );
  });

  it("has no id when neither label nor id provided", () => {
    render(<Input />);
    expect(screen.getByRole("textbox").getAttribute("id")).toBeNull();
  });

  it("does not add left padding when no icon", () => {
    render(<Input />);
    expect(screen.getByRole("textbox").className).not.toContain("pl-7");
  });

  it("renders icon inside a pointer-events-none wrapper", () => {
    const { container } = render(<Input icon={<Search />} />);
    expect(container.querySelector(".pointer-events-none")).toBeTruthy();
  });

  it("applies error ring class (no separate focus-color shift)", () => {
    render(<Input error="X" />);
    // Concept B no longer adds a focus-only border-color change for error —
    // the persistent ring-1 ring-error carries the error state through focus.
    expect(screen.getByRole("textbox").className).toContain("ring-error");
  });

  it("applies accent focus ring when no error", () => {
    render(<Input />);
    // Concept B: focus state is ring-1 ring-accent + shadow-lift, not a
    // border-color swap.
    expect(screen.getByRole("textbox").className).toContain(
      "focus:ring-accent",
    );
  });

  it("merges custom className", () => {
    render(<Input className="my-input" />);
    expect(screen.getByRole("textbox").className).toContain("my-input");
  });

  it("reflects controlled value", () => {
    render(<Input value="Hallo" onChange={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "Hallo",
    );
  });

  it("passes onChange the new value", () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "neu" },
    });
    expect(onChange.mock.calls[0][0].target.value).toBe("neu");
  });

  it("fires onFocus and onBlur handlers", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Input onFocus={onFocus} onBlur={onBlur} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("disabled input is not editable by the user", () => {
    render(<Input disabled value="fix" onChange={vi.fn()} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    input.focus();
    expect(document.activeElement).not.toBe(input);
  });

  it("forwards type=password", () => {
    const { container } = render(<Input type="password" />);
    expect(container.querySelector("input")?.getAttribute("type")).toBe(
      "password",
    );
  });

  it("forwards arbitrary HTML attributes via rest props", () => {
    render(<Input data-testid="rest-input" name="feld" />);
    expect(screen.getByTestId("rest-input").getAttribute("name")).toBe("feld");
  });

  it("forwards ref to the input element", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("has displayName Input", () => {
    expect(Input.displayName).toBe("Input");
  });

  it("renders both label and error together", () => {
    render(<Input label="Pfad" error="Ungueltig" />);
    expect(screen.getByText("Pfad")).toBeTruthy();
    expect(screen.getByText("Ungueltig")).toBeTruthy();
  });
});
