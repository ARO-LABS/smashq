import { describe, it, expect } from "vitest";
import {
  GRID_AREAS,
  getGridStyle,
  SINGLE_LAYOUT_STYLE,
  pickGridFocus,
  foldActiveIntoComposition,
} from "./sessionGridLayout";

describe("sessionGridLayout", () => {
  it("exports GRID_AREAS in stable order a..d", () => {
    expect(GRID_AREAS).toEqual(["a", "b", "c", "d"]);
  });

  it("getGridStyle(1) returns single cell", () => {
    expect(getGridStyle(1).gridTemplate).toBe('"a" 1fr / 1fr');
  });

  it("getGridStyle(2) returns vertical 2-row layout", () => {
    expect(getGridStyle(2).gridTemplate).toBe('"a" 1fr "b" 1fr / 1fr');
  });

  it("getGridStyle(3) returns 2-over-1 layout", () => {
    expect(getGridStyle(3).gridTemplate).toBe('"a b" 1fr "c c" 1fr / 1fr 1fr');
  });

  it("getGridStyle(4) returns 2x2 layout", () => {
    expect(getGridStyle(4).gridTemplate).toBe('"a b" 1fr "c d" 1fr / 1fr 1fr');
  });

  it("getGridStyle(5+) falls back to 2x2 layout", () => {
    expect(getGridStyle(5).gridTemplate).toBe('"a b" 1fr "c d" 1fr / 1fr 1fr');
    expect(getGridStyle(42).gridTemplate).toBe('"a b" 1fr "c d" 1fr / 1fr 1fr');
  });

  it("SINGLE_LAYOUT_STYLE matches single-cell grid", () => {
    expect(SINGLE_LAYOUT_STYLE.gridTemplate).toBe('"a" 1fr / 1fr');
  });
});

describe("pickGridFocus — 3-tier hierarchy", () => {
  it("active wins when it is a candidate", () => {
    expect(pickGridFocus("a", "b", ["a", "b", "c"])).toBe("a");
  });

  it("focused wins when active is not a candidate", () => {
    expect(pickGridFocus("x", "b", ["a", "b", "c"])).toBe("b");
  });

  it("focused wins when active is null", () => {
    expect(pickGridFocus(null, "c", ["a", "b", "c"])).toBe("c");
  });

  it("falls back to candidates[0] when neither active nor focused match", () => {
    expect(pickGridFocus("x", "y", ["a", "b"])).toBe("a");
  });

  it("falls back to candidates[0] when both are null", () => {
    expect(pickGridFocus(null, null, ["a", "b"])).toBe("a");
  });

  it("returns null for an empty candidate list", () => {
    expect(pickGridFocus("a", "b", [])).toBeNull();
  });
});

describe("foldActiveIntoComposition — fold-in / evict", () => {
  it("returns preserved unchanged when activeId is null", () => {
    const preserved = ["a", "b"];
    expect(foldActiveIntoComposition(preserved, null, 4)).toBe(preserved);
  });

  it("returns preserved unchanged when activeId is already a member", () => {
    const preserved = ["a", "b"];
    expect(foldActiveIntoComposition(preserved, "a", 4)).toBe(preserved);
  });

  it("appends activeId when there is room (< maxSlots)", () => {
    expect(foldActiveIntoComposition(["a"], "b", 4)).toEqual(["a", "b"]);
  });

  it("appends (not evicts) at the boundary preserved.length === maxSlots-1", () => {
    // Locks the `<` vs `<=` comparison: one short of full still has room.
    expect(foldActiveIntoComposition(["a", "b", "c"], "d", 4)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("evicts the last slot when full (keeps first maxSlots-1 + active)", () => {
    expect(foldActiveIntoComposition(["a", "b", "c", "d"], "e", 4)).toEqual([
      "a",
      "b",
      "c",
      "e",
    ]);
  });

  it("does not mutate the input array", () => {
    const preserved = ["a", "b", "c", "d"];
    foldActiveIntoComposition(preserved, "e", 4);
    expect(preserved).toEqual(["a", "b", "c", "d"]);
  });
});
