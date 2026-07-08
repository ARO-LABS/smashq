import { describe, it, expect } from "vitest";
import { WHATS_NEW, getWhatsNewEntry } from "./whatsNew";

describe("whatsNew content module", () => {
  it("getWhatsNewEntry returns the curated entry for v1.0.22", () => {
    const entry = getWhatsNewEntry("1.0.22");
    expect(entry).not.toBeNull();
    expect(entry?.version).toBe("1.0.22");
    // Curated window contract: 3-6 highlights, 2-4 watchouts — enough to be
    // useful, few enough to stay a digest instead of a second changelog.
    expect(entry!.highlights.length).toBeGreaterThanOrEqual(3);
    expect(entry!.highlights.length).toBeLessThanOrEqual(6);
    expect(entry!.watchouts.length).toBeGreaterThanOrEqual(2);
    expect(entry!.watchouts.length).toBeLessThanOrEqual(4);
  });

  it("getWhatsNewEntry returns null for a version without an entry (silent skip)", () => {
    expect(getWhatsNewEntry("0.0.1")).toBeNull();
  });

  it("every entry carries non-empty copy in all fields", () => {
    for (const entry of WHATS_NEW) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.intro.trim().length).toBeGreaterThan(0);
      for (const h of entry.highlights) {
        expect(h.title.trim().length).toBeGreaterThan(0);
        expect(h.text.trim().length).toBeGreaterThan(0);
      }
      for (const w of entry.watchouts) {
        expect(w.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
