import { describe, it, expect } from "vitest";
import {
  ACCENT_HUES,
  ACCENT_NAMES,
  isAccentName,
  normalizeAccentName,
  hashFolderToAccent,
  resolveSessionAccent,
  accentCssVars,
  accentColorFor,
  accentFrameColorFor,
} from "./sessionAccent";

describe("sessionAccent", () => {
  it("palette has 5 entries with azure first (default)", () => {
    expect(ACCENT_NAMES.length).toBe(5);
    expect(ACCENT_NAMES[0]).toBe("azure");
    expect(ACCENT_HUES.azure).toBe(230);
  });

  it("isAccentName accepts known names, rejects others", () => {
    expect(isAccentName("violet")).toBe(true);
    expect(isAccentName("magenta")).toBe(false);
    expect(isAccentName(42)).toBe(false);
    expect(isAccentName(undefined)).toBe(false);
  });

  it("hashFolderToAccent is deterministic and always a palette name", () => {
    const a = hashFolderToAccent("C:/Projects/zovel");
    const b = hashFolderToAccent("C:/Projects/zovel");
    expect(a).toBe(b);
    expect(ACCENT_NAMES).toContain(a);
  });

  it("hashFolderToAccent tolerates empty input (stable default, no throw)", () => {
    expect(ACCENT_NAMES).toContain(hashFolderToAccent(""));
  });

  it("resolveSessionAccent: valid override beats folder hash", () => {
    const session = { folder: "C:/Projects/zovel", claudeSessionId: "uuid-1" };
    expect(resolveSessionAccent(session, { "uuid-1": "violet" })).toBe("violet");
  });

  it("resolveSessionAccent: unknown override name falls back to hash", () => {
    const session = { folder: "C:/Projects/zovel", claudeSessionId: "uuid-1" };
    expect(resolveSessionAccent(session, { "uuid-1": "bogus" })).toBe(
      hashFolderToAccent("C:/Projects/zovel"),
    );
  });

  it("resolveSessionAccent: no claudeSessionId uses folder hash", () => {
    const session = { folder: "C:/Projects/zovel", claudeSessionId: null };
    expect(resolveSessionAccent(session, {})).toBe(hashFolderToAccent("C:/Projects/zovel"));
  });

  it("resolveSessionAccent: folder override beats a per-session override and the hash", () => {
    const session = { folder: "C:/Projects/zovel", claudeSessionId: "uuid-1" };
    expect(
      resolveSessionAccent(session, { "uuid-1": "violet" }, { "C:/Projects/zovel": "amber" }),
    ).toBe("amber");
  });

  it("resolveSessionAccent: folder override applies even without a claudeSessionId", () => {
    const folder = "C:/Projects/zovel";
    const session = { folder, claudeSessionId: null };
    // Pick an override that is guaranteed NOT to equal the folder hash, so a
    // pass cannot be a coincidence of the fallback returning the same color.
    const override = ACCENT_NAMES.find((n) => n !== hashFolderToAccent(folder))!;
    expect(resolveSessionAccent(session, {}, { [folder]: override })).toBe(override);
  });

  it("resolveSessionAccent: invalid folder override falls through to the per-session override", () => {
    const session = { folder: "C:/Projects/zovel", claudeSessionId: "uuid-1" };
    expect(
      resolveSessionAccent(session, { "uuid-1": "emerald" }, { "C:/Projects/zovel": "bogus" }),
    ).toBe("emerald");
  });

  it("accentCssVars sets the --accent-h custom property", () => {
    expect(accentCssVars("violet")).toEqual({ "--accent-h": "285" });
  });

  it("accentColorFor: deterministic oklch string from folder hash", () => {
    const a = accentColorFor("C:/Projects/zovel");
    expect(a).toBe(accentColorFor("C:/Projects/zovel"));
    expect(a).toMatch(/^oklch\(/);
  });

  it("accentColorFor: a valid override name wins over the folder hash", () => {
    const overridden = accentColorFor("C:/Projects/zovel", "violet");
    expect(overridden).toContain(String(ACCENT_HUES.violet));
  });

  it("accentColorFor: unknown override falls back to the folder hash color", () => {
    expect(accentColorFor("C:/Projects/zovel", "bogus")).toBe(accentColorFor("C:/Projects/zovel"));
  });

  it("accentFrameColorFor: theme-aware L/C vars with the same hue as the dot", () => {
    const frame = accentFrameColorFor("C:/Projects/zovel", "violet");
    expect(frame).toBe(`oklch(var(--accent-l) var(--accent-c) ${ACCENT_HUES.violet})`);
  });

  it("accentFrameColorFor: unknown override falls back to the folder hash hue", () => {
    expect(accentFrameColorFor("C:/Projects/zovel", "bogus")).toBe(
      accentFrameColorFor("C:/Projects/zovel"),
    );
  });
});

describe("azure rebrand", () => {
  it("has no cyan and azure is 230, first entry", () => {
    expect(ACCENT_NAMES).not.toContain("cyan");
    expect(ACCENT_HUES).not.toHaveProperty("cyan");
    expect(ACCENT_HUES.azure).toBe(230);
    expect(ACCENT_NAMES[0]).toBe("azure");
    expect(ACCENT_NAMES).toHaveLength(5);
  });

  it("remaps legacy cyan to azure, keeps valid names, drops garbage", () => {
    expect(normalizeAccentName("cyan")).toBe("azure");
    expect(normalizeAccentName("violet")).toBe("violet");
    expect(normalizeAccentName("bogus")).toBeNull();
    expect(normalizeAccentName(42)).toBeNull();
  });

  it("accentColorFor inherits theme L/C via vars (not fixed stops)", () => {
    expect(accentColorFor("/proj", "azure")).toBe("oklch(var(--accent-l) var(--accent-c) 230)");
  });
});
