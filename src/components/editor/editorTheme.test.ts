import { describe, it, expect } from "vitest";
import { neonEditorTheme } from "./editorTheme";

describe("editorTheme", () => {
  it("exports neonEditorTheme as a non-empty array extension", () => {
    expect(neonEditorTheme).toBeDefined();
    // Extension is [theme, syntaxHighlighting(highlighting)]
    const extensions = neonEditorTheme as unknown[];
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it("contains both theme and syntax highlighting extensions", () => {
    const extensions = neonEditorTheme as unknown[];
    expect(extensions).toHaveLength(2);
  });
});
