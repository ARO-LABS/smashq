import { describe, it, expect } from "vitest";
import { labelStyle } from "./kanbanUtils";

describe("labelStyle", () => {
  it("uses the color verbatim when it already has a # prefix", () => {
    const style = labelStyle("#ff0000");
    expect(style.color).toBe("#ff0000");
  });

  it("prepends # when the color has no prefix", () => {
    const style = labelStyle("00ff00");
    expect(style.color).toBe("#00ff00");
  });

  it("appends a 20 alpha suffix for the background", () => {
    expect(labelStyle("#123456").backgroundColor).toBe("#12345620");
  });

  it("appends a 40 alpha suffix for the border", () => {
    expect(labelStyle("#123456").borderColor).toBe("#12345640");
  });

  it("normalizes a prefix-less color across all three properties", () => {
    const style = labelStyle("abcdef");
    expect(style.backgroundColor).toBe("#abcdef20");
    expect(style.color).toBe("#abcdef");
    expect(style.borderColor).toBe("#abcdef40");
  });

  it("returns a plain object usable as React CSSProperties", () => {
    const style = labelStyle("#000000");
    expect(Object.keys(style).sort()).toEqual([
      "backgroundColor",
      "borderColor",
      "color",
    ]);
  });
});
