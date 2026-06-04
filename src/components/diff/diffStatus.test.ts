import { describe, it, expect } from "vitest";
import { diffStatusVisual } from "./diffStatus";
import type { DiffFileStatus } from "./types";

describe("diffStatusVisual", () => {
  it("maps 'modified' to the M char with warning color", () => {
    const v = diffStatusVisual("modified");
    expect(v.char).toBe("M");
    expect(v.label).toBe("Geaendert");
    expect(v.className).toBe("text-warning");
  });

  it("maps 'added' to the A char with success color", () => {
    const v = diffStatusVisual("added");
    expect(v.char).toBe("A");
    expect(v.label).toBe("Hinzugefuegt");
    expect(v.className).toBe("text-success");
  });

  it("maps 'deleted' to the D char with error color", () => {
    const v = diffStatusVisual("deleted");
    expect(v.char).toBe("D");
    expect(v.label).toBe("Geloescht");
    expect(v.className).toBe("text-error");
  });

  it("maps 'renamed' to the R char with info color", () => {
    const v = diffStatusVisual("renamed");
    expect(v.char).toBe("R");
    expect(v.label).toBe("Umbenannt");
    expect(v.className).toBe("text-info");
  });

  it("maps 'untracked' to the ? char with neutral color", () => {
    const v = diffStatusVisual("untracked");
    expect(v.char).toBe("?");
    expect(v.label).toBe("Untracked");
    expect(v.className).toBe("text-neutral-400");
  });

  it("returns a single-character glyph for every status", () => {
    const all: DiffFileStatus[] = [
      "modified",
      "added",
      "deleted",
      "renamed",
      "untracked",
    ];
    for (const status of all) {
      expect(diffStatusVisual(status).char).toHaveLength(1);
    }
  });

  it("returns a non-empty German label for every status", () => {
    const all: DiffFileStatus[] = [
      "modified",
      "added",
      "deleted",
      "renamed",
      "untracked",
    ];
    for (const status of all) {
      expect(diffStatusVisual(status).label.length).toBeGreaterThan(0);
    }
  });

  it("assigns a unique char to each status", () => {
    const all: DiffFileStatus[] = [
      "modified",
      "added",
      "deleted",
      "renamed",
      "untracked",
    ];
    const chars = all.map((s) => diffStatusVisual(s).char);
    expect(new Set(chars).size).toBe(all.length);
  });
});
