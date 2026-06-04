import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

// Mock @uiw/react-codemirror — CodeMirror does not work in jsdom
vi.mock("@uiw/react-codemirror", () => ({
  __esModule: true,
  default: (props: {
    value: string;
    onChange?: (val: string) => void;
    className?: string;
    extensions?: unknown[];
    basicSetup?: Record<string, boolean>;
  }) => (
    <div
      data-testid="codemirror-mock"
      className={props.className}
      data-extension-count={props.extensions?.length ?? 0}
      data-basic-setup={JSON.stringify(props.basicSetup ?? {})}
    >
      <textarea
        data-testid="codemirror-textarea"
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
    </div>
  ),
}));

// Mock codemirror extensions that would fail in jsdom
vi.mock("@codemirror/lang-markdown", () => ({
  markdown: vi.fn(() => []),
}));

vi.mock("./languageSupport", () => ({
  codeLanguages: [],
}));

vi.mock("@codemirror/view", () => ({
  keymap: { of: vi.fn(() => []) },
}));

vi.mock("./editorTheme", () => ({
  neonEditorTheme: [],
}));

describe("CodeMirrorEditor", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing and displays the mock editor", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="# Hello" onChange={onChange} />,
    );
    expect(getByTestId("codemirror-mock")).toBeTruthy();
  });

  it("passes value to the underlying editor", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="test content" onChange={onChange} />,
    );
    const textarea = getByTestId("codemirror-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("test content");
  });

  it("wraps editor in a full-size container div", () => {
    const { container } = render(
      <CodeMirrorEditor value="" onChange={onChange} />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("h-full");
    expect(wrapper.className).toContain("w-full");
  });

  it("forwards editor input to the onChange callback", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="start" onChange={onChange} />,
    );
    const textarea = getByTestId("codemirror-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "neuer Inhalt" } });
    expect(onChange).toHaveBeenCalledWith("neuer Inhalt");
  });

  it("renders an empty value without crashing", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="" onChange={onChange} />,
    );
    const textarea = getByTestId("codemirror-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  it("registers a save keymap extension when onSave is provided", () => {
    const onSave = vi.fn();
    const { getByTestId } = render(
      <CodeMirrorEditor value="x" onChange={onChange} onSave={onSave} />,
    );
    const mock = getByTestId("codemirror-mock");
    // markdown + theme + keymap → 3 extensions
    expect(mock.getAttribute("data-extension-count")).toBe("3");
  });

  it("omits the save keymap extension when onSave is absent", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="x" onChange={onChange} />,
    );
    const mock = getByTestId("codemirror-mock");
    // markdown + theme only → 2 extensions
    expect(mock.getAttribute("data-extension-count")).toBe("2");
  });

  it("passes the expected basicSetup configuration", () => {
    const { getByTestId } = render(
      <CodeMirrorEditor value="" onChange={onChange} />,
    );
    const basicSetup = JSON.parse(
      getByTestId("codemirror-mock").getAttribute("data-basic-setup") ?? "{}",
    );
    expect(basicSetup.lineNumbers).toBe(true);
    expect(basicSetup.foldGutter).toBe(true);
    expect(basicSetup.bracketMatching).toBe(true);
    expect(basicSetup.autocompletion).toBe(false);
  });

  it("updates displayed value when the value prop changes", () => {
    const { getByTestId, rerender } = render(
      <CodeMirrorEditor value="erste" onChange={onChange} />,
    );
    let textarea = getByTestId("codemirror-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("erste");
    rerender(<CodeMirrorEditor value="zweite" onChange={onChange} />);
    textarea = getByTestId("codemirror-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("zweite");
  });
});
