import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Config-level regression guard for the settingsStore-hydration TDZ.
 *
 * The runtime crash `Cannot access 'p' before initialization` (logged as
 * `settingsStore.hydration`) was a cross-chunk Temporal-Dead-Zone: Rollup
 * co-bundled zustand's `persist` middleware into a STORE chunk, and the
 * settingsStore chunk read that `persist` binding at module-init before the
 * binding's chunk had initialized. The fix pins `zustand` into its own leaf
 * vendor chunk (`vendor-zustand`) so `persist` can NEVER be co-bundled into a
 * store chunk and read before init.
 *
 * A runtime test cannot reproduce this (the TDZ is build-layout dependent and
 * vitest loads modules individually, not as concatenated chunks). Importing
 * `vite.config.ts` directly is also impractical here — it pulls in vite →
 * esbuild, whose native binding cannot load inside the jsdom worker. So the
 * honest guard reads the config file as text and asserts the `vendor-zustand`
 * manualChunks pin stays in place — a future config edit that drops it would
 * re-open the persist-TDZ chunk class.
 */
describe("vite.config manualChunks — persist-TDZ guard", () => {
  it("pins zustand into its own vendor-zustand chunk", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const configPath = resolve(here, "../../vite.config.ts");
    const source = readFileSync(configPath, "utf8");

    // The pin: `'vendor-zustand': ['zustand'],` (tolerate single/double quotes
    // and incidental whitespace, but require both the chunk name and zustand).
    const pinRe =
      /['"]vendor-zustand['"]\s*:\s*\[\s*['"]zustand['"]\s*\]/;

    expect(source).toMatch(pinRe);
  });
});
