import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC = resolve(HERE, "../docs/developer-doc.html");
const START = "<!-- DESIGN:START -->";
const END = "<!-- DESIGN:END -->";

const FONT_LINK =
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">';

function escapeSrcdoc(html: string): string {
  return html.replace(/"/g, "&quot;");
}

test("generate design section into developer-doc.html", async ({ page }) => {
  await page.goto("/?view=designdoc");
  await page.waitForSelector("[data-testid='designdoc-root'][data-ready='true']");
  await page.waitForSelector("[data-dg-id]");

  const css = await page.evaluate(() => {
    let out = "";
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) out += rule.cssText + "\n";
      } catch {
        /* cross-origin (fonts) — skip */
      }
    }
    return out;
  });
  expect(css.length).toBeGreaterThan(0);

  const stageIds = await page.$$eval("[data-dg-id]", (els) => els.map((e) => e.getAttribute("data-dg-id") as string));
  expect(stageIds.length).toBeGreaterThan(0);

  const blocks: string[] = [];
  for (const theme of ["dark", "light"] as const) {
    await page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);

    for (const id of stageIds) {
      const handle = page.locator(`[data-dg-id="${id}"]`);
      await handle.scrollIntoViewIfNeeded();
      const bodyHtml = await handle.evaluate(
        (el) => el.querySelector("[data-dg-stage-body]")?.innerHTML ?? el.innerHTML,
      );
      const interactive = (await handle.getAttribute("data-dg-interactive")) === "true";

      const srcdoc = `<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8">${FONT_LINK}<style>${css}</style><style>html,body{margin:0}body{padding:12px;background:var(--surface-base)}</style></head><body>${bodyHtml}</body></html>`;
      // Auto-size to content: srcdoc iframes are same-origin, so onload can read
      // the rendered height. Fixes clipping of tall stages (tokens) and the empty
      // whitespace under short stages (buttons/cards) that a fixed height caused.
      const iframe = `<iframe title="${id} (${theme})" loading="lazy" scrolling="no" onload="this.style.height=(this.contentWindow.document.body.scrollHeight+4)+'px'" style="width:100%;height:120px;border:1px solid var(--border);border-radius:2px;background:#fff;display:block" srcdoc="${escapeSrcdoc(srcdoc)}"></iframe>`;

      let img = "";
      try {
        const shot = await handle.screenshot();
        img = `<details><summary>Screenshot-Fallback</summary><img alt="${id} (${theme})" loading="lazy" style="max-width:100%;border:1px solid var(--border)" src="data:image/png;base64,${shot.toString("base64")}"></details>`;
      } catch {
        img = `<details><summary>Screenshot-Fallback</summary><span style="font-size:12px;color:var(--neutral-400)">Kein Screenshot (Stage ohne sichtbare Hoehe)</span></details>`;
      }

      let hover = "";
      if (interactive) {
        try {
          await handle.hover();
          const hoverShot = await handle.screenshot();
          hover = `<details><summary>Hover-Snapshot</summary><img alt="${id} hover" loading="lazy" style="max-width:100%" src="data:image/png;base64,${hoverShot.toString("base64")}"></details>`;
        } catch {
          hover = "";
        }
      }

      blocks.push(
        `<div class="diagram"><div class="diagram-title">${id} · ${theme}</div>${iframe}${img}${hover}</div>`,
      );
    }
  }

  const generated = `\n${blocks.join("\n")}\n`;
  const doc = readFileSync(DOC, "utf8");
  const s = doc.indexOf(START);
  const e = doc.indexOf(END);
  if (s === -1 || e === -1) throw new Error("DESIGN markers not found in developer-doc.html");
  const next = doc.slice(0, s + START.length) + generated + doc.slice(e);

  const tmp = DOC + ".tmp";
  writeFileSync(tmp, next, "utf8");
  renameSync(tmp, DOC);

  expect(readFileSync(DOC, "utf8")).toContain("<iframe");
});
