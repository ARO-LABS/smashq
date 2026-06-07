import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

/**
 * Regression guard for the settingsStore-hydration TDZ
 * ("Cannot access 'useSettingsStore' before initialization", minified 'p').
 *
 * zustand persist runs onRehydrateStorage SYNCHRONOUSLY inside
 * create(persist(...)) when storage.getItem returns a sync value. Outside Tauri,
 * tauriStorage falls back to localStorage (synchronous) — and in the real Tauri
 * app the in-memory cache makes getItem sync too. Persisted data that triggers a
 * heal patch (here: an invalid sessionAccents entry) makes onRehydrateStorage
 * call useSettingsStore.setState DURING hydration, while the const is still in
 * its Temporal Dead Zone. persist catches that throw and routes it to the error
 * channel (logged as settingsStore.hydration), so the symptom is the lost heal,
 * NOT a thrown import. The fix defers the setState to a microtask.
 *
 * Discriminator: on the bug the heal is lost (invalid accent survives); on the
 * fix the heal is applied (accents cleaned to {}). This test must be in its own
 * file: it uses vi.resetModules() + dynamic import to exercise a FRESH module
 * init, which would clobber the singleton the other settingsStore tests rely on.
 */

const KEY = "agenticexplorer-settings";

describe("settingsStore hydration — synchronous-storage TDZ regression", () => {
  let saved: string | null = null;

  beforeEach(() => {
    saved = localStorage.getItem(KEY);
  });

  afterEach(() => {
    if (saved === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, saved);
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("applies the heal patch (no lost setState) when heal-triggering data hydrates synchronously", async () => {
    // Seed a persisted blob whose sessionAccents are invalid → onRehydrateStorage
    // computes a non-empty patch and calls setState during sync hydration.
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { sessionAccents: { s: "bogus-accent" } }, version: 9 }),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const mod = await import("./settingsStore");
    expect(mod.useSettingsStore).toBeDefined();

    // Let the deferred (microtask) heal setState run.
    await new Promise((r) => setTimeout(r, 0));

    // On the bug the setState threw (TDZ) and the heal was lost → invalid accent
    // survives. On the fix the heal applies → accents cleaned.
    expect(mod.useSettingsStore.getState().sessionAccents).toEqual({});

    // And no TDZ was logged during hydration.
    const loggedTdz = errorSpy.mock.calls
      .flat()
      .some((a) => typeof a === "string" && /before initialization/i.test(a));
    expect(loggedTdz).toBe(false);
  });
});
