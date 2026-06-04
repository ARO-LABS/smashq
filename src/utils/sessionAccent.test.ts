import { describe, it, expect } from "vitest";
import {
  ACCENT_HUES,
  ACCENT_NAMES,
  isAccentName,
  hashFolderToAccent,
  resolveSessionAccent,
  accentCssVars,
  accentColorFor,
} from "./sessionAccent";

describe("sessionAccent", () => {
  it("palette has 6 entries with cyan first (default)", () => {
    expect(ACCENT_NAMES.length).toBe(6);
    expect(ACCENT_NAMES[0]).toBe("cyan");
    expect(ACCENT_HUES.cyan).toBe(195);
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
});
