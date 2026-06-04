/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Wave 2+: Layer-B integration tests live in `*.integration.test.ts`
    // and run under the separate `vitest.config.integration.ts` (no global
    // mocks). Excluding them here prevents double-runs and stops the
    // global Tauri-event mock from interfering with real-event tests.
    exclude: ["src/**/*.integration.test.{ts,tsx}", "node_modules/**"],
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 65,
        lines: 75,
      },
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "**/*.d.ts",
        ".claude/**",
        "node_modules/**",
      ],
    },
  },
});
