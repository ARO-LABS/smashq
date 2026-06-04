import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for Tauri app smoke tests.
 *
 * Runs against the Vite dev server (port 5173). Tauri runtime is mocked
 * via `installTauriMock()` in individual tests (see support/tauri-mock.ts).
 */
export default defineConfig({
  testDir: ".",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./playwright-report", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    port: 5173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: "..",
  },
});
