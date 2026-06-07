import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { catalog } from "./catalog";
import { seedDesignDocState } from "./mockState";

describe("catalog", () => {
  it("exposes the Phase-1 sections (happy path)", () => {
    const ids = catalog.map((s) => s.id);
    expect(ids).toEqual(["foundations", "primitives", "sessions"]);
  });

  it("every entry renders without throwing (edge: components wired to stores/IPC)", () => {
    seedDesignDocState();
    for (const section of catalog) {
      for (const entry of section.entries) {
        expect(() => render(<>{entry.render()}</>)).not.toThrow();
      }
    }
  });
});
