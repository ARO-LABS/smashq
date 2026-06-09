import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

/**
 * Regression guard for the uiStore-hydration TDZ
 * ("Cannot access 'useUIStore' before initialization").
 *
 * zustand persist runs onRehydrateStorage SYNCHRONOUSLY inside
 * create(persist(...)) when storage.getItem returns a sync value (localStorage
 * fallback is always sync; the real Tauri app's in-memory cache makes getItem
 * sync too). A persisted blob carrying the CURRENT version but corrupt
 * libraryScopeOpen/librarySectionOpen makes onRehydrateStorage compute a heal
 * patch and call useUIStore.setState DURING hydration — while the const is still
 * in its Temporal Dead Zone. persist catches that throw and routes it to the
 * error channel, so the symptom is the LOST heal (corrupt value survives), not a
 * thrown import. The fix defers the setState to a microtask.
 *
 * Discriminator: on the bug the heal is lost (non-boolean entry survives); on the
 * fix the heal is applied (record cleaned to valid booleans only). Own file:
 * vi.resetModules() + dynamic import exercise a FRESH module init, which would
 * clobber the singleton the other uiStore tests rely on. Mirrors
 * settingsStore.hydration.test.ts.
 */

const KEY = "agenticexplorer-ui";

describe("uiStore hydration — synchronous-storage TDZ regression", () => {
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

  it("applies the heal patch (no lost setState) when corrupt data hydrates synchronously", async () => {
    // Seed a CURRENT-version blob whose libraryScopeOpen carries a non-boolean
    // value → onRehydrateStorage computes a non-empty heal patch and calls
    // setState during sync hydration. version:1 matches the store, so migrate
    // does NOT run — onRehydrateStorage is the only healer (same-version path).
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          libraryScopeOpen: { a: "not-a-boolean", b: true },
          librarySectionOpen: {},
        },
        version: 1,
      }),
    );

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const mod = await import("./uiStore");
    expect(mod.useUIStore).toBeDefined();

    // Let the deferred (microtask) heal setState run.
    await new Promise((r) => setTimeout(r, 0));

    // On the bug the setState threw (TDZ) and the heal was lost → the invalid
    // "not-a-boolean" entry survives. On the fix the heal applies → only valid
    // booleans remain.
    expect(mod.useUIStore.getState().libraryScopeOpen).toEqual({ b: true });

    // And no TDZ was logged during hydration.
    const loggedTdz = errorSpy.mock.calls
      .flat()
      .some((a) => typeof a === "string" && /before initialization/i.test(a));
    expect(loggedTdz).toBe(false);
  });
});
