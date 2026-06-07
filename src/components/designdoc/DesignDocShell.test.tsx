import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DesignDocShell } from "./DesignDocShell";
import { seedDesignDocState } from "./mockState";
import { catalog } from "./catalog";

describe("DesignDocShell", () => {
  it("renders a TOC entry and a stage for every catalog entry (happy path)", () => {
    seedDesignDocState();
    render(<DesignDocShell />);
    for (const section of catalog) {
      expect(screen.getByRole("link", { name: new RegExp(section.title, "i") })).toBeInTheDocument();
      for (const entry of section.entries) {
        expect(screen.getByTestId(`stage-${entry.id}`)).toBeInTheDocument();
      }
    }
  });
});
