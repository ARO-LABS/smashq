/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Integration-test config — separate from `vitest.config.ts` so the
 * Wave-2+ Layer-B tests can opt OUT of the global Tauri mocks and store
 * mocks the unit suite relies on.
 *
 * Naming convention: integration tests live under
 * `src/**\/*.integration.test.{ts,tsx}`. Run via `npm run test:integration`.
 * Run BOTH suites sequentially via `npm run test:all`.
 *
 * Coverage thresholds are intentionally NOT enforced here — `vitest.config.ts`
 * drives the coverage gate; this suite EXTENDS coverage by exercising
 * paths the global mocks hide from the unit suite.
 *
 * Plan reference: reports/2026-05-08-session-loading-real-tests-PLAN.md (Wave 2)
 */
export default defineConfig({
  plugins: [react()],
  // Vite-injected build-time constants. Production sources reference these
  // (e.g. ChangelogDialog reads `__GIT_HASH__` and `__BUILD_DATE__`), so any
  // test that renders those components needs them defined. Mirror
  // `vite.config.ts:15-18` exactly so test-time render matches prod render.
  define: {
    __GIT_HASH__: JSON.stringify("test"),
    __BUILD_DATE__: JSON.stringify("2026-01-01T00:00"),
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.integration.ts"],
    include: ["src/**/*.integration.test.{ts,tsx}"],
  },
});
