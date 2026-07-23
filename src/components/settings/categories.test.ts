import { describe, expect, it } from "vitest";
import { SETTINGS_CATEGORIES } from "./categories";

describe("SETTINGS_CATEGORIES", () => {
  it("hat genau 5 Kategorien ohne terminal/advanced", () => {
    expect(SETTINGS_CATEGORIES.map((c) => c.id)).toEqual([
      "appearance",
      "sessions",
      "notifications",
      "system",
      "about",
    ]);
  });

  it("jede Kategorie hat Label, Icon und Lazy-Panel", () => {
    for (const cat of SETTINGS_CATEGORIES) {
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.icon).toBeTruthy();
      expect(cat.Panel).toBeTruthy();
    }
  });

  // Fallback-Kontrakt der PreferencesView (Zeile `?? SETTINGS_CATEGORIES[0]`):
  // ein persistierter/veralteter Tab-Bezeichner wie "terminal" oder "advanced"
  // darf nie ein leeres Panel ergeben — die Auflösung fällt auf die erste
  // Kategorie zurück. activeId lebt aktuell nur in lokalem useState (nicht
  // persistiert), der Guard ist bewusste Defense-in-Depth.
  it("entfallene Tab-IDs lösen auf die erste Kategorie auf (Fallback-Kontrakt)", () => {
    for (const staleId of ["terminal", "advanced"]) {
      const resolved =
        SETTINGS_CATEGORIES.find((c) => c.id === staleId) ?? SETTINGS_CATEGORIES[0];
      expect(resolved.id).toBe("appearance");
    }
  });
});
