import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { installTauriMock } from "./support/tauri-mock";

/**
 * Smoke tests for the Agenten Pipeline Dashboard.
 *
 * These run against the Vite dev server with a Tauri IPC mock (see
 * support/tauri-mock.ts) — no real Tauri runtime.
 *
 * Bug #3 is expected to FAIL on the baseline run: ScopePanel + Section
 * toggles use `useState(false)` locally, so their expanded/collapsed
 * state is lost on reload. After the fix lands in useUIStore, all
 * 6 tests should pass.
 */

// ── Helpers ──────────────────────────────────────────────────────────

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    errors.push(err.message);
  });
  return errors;
}

function safeName(title: string): string {
  return title.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
}

// ── Setup ────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await installTauriMock(page);
});

test.afterEach(async ({ page }, testInfo) => {
  // Baseline screenshot for every test — helps diff before/after fix.
  const name = `baseline-${safeName(testInfo.title)}.png`;
  await page
    .screenshot({ path: `e2e/screenshots/${name}`, fullPage: true })
    .catch(() => {
      // Screenshot failures must not fail the test itself.
    });
});

// ── #1: App-Load ─────────────────────────────────────────────────────

test("app loads without console errors", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");

  // Wait until the SideNav has rendered — a stable anchor for "app is alive".
  await expect(
    page.getByRole("button", { name: /Sitzungen/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Let async init settle.
  await page.waitForTimeout(500);

  // Filter noise: lazy-chunk warnings, Vite HMR, favicon 404s.
  const meaningful = consoleErrors.filter(
    (e) =>
      !/\/favicon/i.test(e) &&
      !/\[vite\]/i.test(e) &&
      !/Failed to load resource.*favicon/i.test(e),
  );

  expect(meaningful, `Console errors:\n${meaningful.join("\n")}`).toHaveLength(
    0,
  );
});

// ── #2: SideNav-Navigation ───────────────────────────────────────────

test("sidenav navigation switches active view", async ({ page }) => {
  await page.goto("/");

  // Start at Sessions — the default — and verify EmptyState or session list CTA.
  await expect(
    page.getByRole("button", { name: /Sitzungen/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Kanban
  await page.getByRole("button", { name: /Kanban/i }).first().click();
  await expect(
    page.getByText(/Globales Board|Projekt|Kein Projekt|Kanban/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Bibliothek
  await page.getByRole("button", { name: /Bibliothek/i }).first().click();
  await expect(
    page.getByText(/Library|Scanne Konfigurationen|Keine Konfigurationen|Global/i).first(),
  ).toBeVisible({ timeout: 10_000 });

  // Editor
  await page.getByRole("button", { name: /^Editor$/i }).first().click();
  // The editor view renders a CodeMirror container — wait for the view region.
  await expect(page.locator("main")).toBeVisible();
  await page.waitForTimeout(300);

  // Sessions — back again
  await page.getByRole("button", { name: /Sitzungen/i }).first().click();
  await expect(
    page.getByText(/NEUE SESSION|Keine Sessions|Wähle einen Ordner/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});

// ── #3: Library Scope-Panel Persistenz (Bug #3) ──────────────────────

test.describe("Bug #3 — must pass after fix", () => {
  test("library scope panel toggle persists across reload", async ({
    page,
  }) => {
    await page.goto("/");

    // Navigate to the Bibliothek tab.
    await page.getByRole("button", { name: /Bibliothek/i }).first().click();

    // Wait for at least the library header to be present.
    await expect(page.getByText(/^Library$/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Find the global scope panel toggle — labelled "Global (~/.claude/)".
    // ScopePanel only renders if globalConfig is loaded; mock returns null so
    // the store may skip rendering. We tolerate either outcome:
    //   a) panel visible  → click, reload, verify expanded after reload
    //   b) no panel      → test is inconclusive, but per spec we assert on
    //                      persistence behaviour — so we fail clearly.
    const scopeToggle = page
      .getByRole("button", { name: /Global.*\.claude/i })
      .first();

    // If no ScopePanel rendered, the bug test cannot assert persistence:
    // we treat this as the failing case (the fix should also make the panel
    // remembered — but without a panel we fail loud).
    const hasToggle = await scopeToggle.isVisible().catch(() => false);
    expect(
      hasToggle,
      "ScopePanel 'Global' toggle not rendered — cannot verify persistence",
    ).toBeTruthy();

    // Expand the panel.
    await scopeToggle.click();

    // After expanding, the inner content area (Section rows) or
    // an empty-state label should be visible. Since the mock returns no
    // configs, "Keine Konfiguration gefunden" is shown — which means the
    // panel IS expanded (hasContent === false → content is hidden even
    // when open; open === true is still reflected only by the chevron).
    //
    // We therefore check for the chevron-down direction as proof of "open".
    // Chevron-down is the open state; chevron-right is closed.
    // Lucide renders the icon as an svg sibling to the label text.
    // We use the panel's own button: when open, clicking again collapses.
    //
    // Simpler: reload, then re-check whether the panel is still open.
    await page.reload();

    // After reload, mock is re-injected via beforeEach (addInitScript persists
    // across reloads in the same page context).
    // Re-navigate to Bibliothek.
    await page.getByRole("button", { name: /Bibliothek/i }).first().click();
    await expect(page.getByText(/^Library$/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const scopeAfterReload = page
      .getByRole("button", { name: /Global.*\.claude/i })
      .first();
    await expect(scopeAfterReload).toBeVisible({ timeout: 10_000 });

    // The panel's open state is reflected in the chevron icon inside the button.
    // Open = chevron-down (lucide .lucide-chevron-down)
    // Closed = chevron-right (lucide .lucide-chevron-right)
    const openChevron = scopeAfterReload.locator(
      "svg.lucide-chevron-down",
    );
    await expect(
      openChevron,
      "ScopePanel was expanded before reload but is collapsed after reload — useState(false) is not persisted (Bug #3)",
    ).toBeVisible({ timeout: 3_000 });
  });
});

// ── #4: Kanban leerer Zustand ────────────────────────────────────────

test("kanban shows empty state without configured board", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Kanban/i }).first().click();

  // In "global" mode the KanbanBoard renders. In "folder" mode with no
  // favorites we see "Kein Projekt verfügbar". Either empty-state-ish
  // text is acceptable.
  await expect(
    page
      .getByText(/Kein Projekt|Globales Board|empty|kein/i)
      .first(),
  ).toBeVisible({ timeout: 10_000 });
});

// ── #5: Modal öffnen + Escape ────────────────────────────────────────

test("modal opens and closes with Escape", async ({ page }) => {
  await page.goto("/");

  // The Sessions tab is the default. Click the "NEUE SESSION" button
  // from either the empty-state CTA or the sidebar.
  await expect(
    page.getByRole("button", { name: /Sitzungen/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  // Primary trigger: the big neon-green "NEUE SESSION STARTEN" on empty state,
  // or the sidebar "NEUE SESSION" button.
  const trigger = page
    .getByRole("button", { name: /NEUE SESSION/i })
    .first();
  await expect(trigger).toBeVisible({ timeout: 10_000 });
  await trigger.click();

  // Modal has role="dialog".
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Press Escape — Modal's keydown handler should close it.
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden({ timeout: 5_000 });
});

// ── #6: Theme-Toggle ─────────────────────────────────────────────────

test("theme toggle flips html class", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: /Sitzungen/i }).first(),
  ).toBeVisible({ timeout: 15_000 });

  const htmlClassBefore = await page.evaluate(() =>
    document.documentElement.className,
  );

  // Theme toggle is labelled "Light Mode aktivieren" or "Dark Mode aktivieren".
  const toggle = page
    .getByRole("button", { name: /(Light|Dark) Mode aktivieren/i })
    .first();
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();

  // Let useThemeEffect apply the class.
  await page.waitForTimeout(300);

  const htmlClassAfter = await page.evaluate(() =>
    document.documentElement.className,
  );

  expect(
    htmlClassAfter,
    `html class did not change (before: "${htmlClassBefore}", after: "${htmlClassAfter}")`,
  ).not.toBe(htmlClassBefore);
});
