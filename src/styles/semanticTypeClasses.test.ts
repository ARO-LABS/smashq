import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Nicht ueber `src/` via Vite importieren — statisch lesen damit wir
// wirklich die geparste Quelldatei pruefen.
const CSS_PATH = resolve(__dirname, "..", "index.css");
const css = readFileSync(CSS_PATH, "utf8");

// Jede Klasse muss im index.css existieren und mit den kanonischen CSS-Variablen
// aus docs/design-system/colors_and_type.css uebereinstimmen.
const EXPECTED_CLASSES: Array<{
  name: string;
  mustContain: string[];
}> = [
  {
    name: ".ae-h1",
    mustContain: [
      "font-family: var(--font-display)",
      "font-size: var(--text-xl)",
      "font-weight: 700",
      "color: var(--neutral-100)",
    ],
  },
  {
    name: ".ae-h2",
    mustContain: [
      "font-family: var(--font-display)",
      "font-weight: 700",
      "text-transform: uppercase",
      "color: var(--color-accent)",
    ],
  },
  {
    name: ".ae-h3",
    mustContain: [
      "font-family: var(--font-display)",
      "font-size: var(--text-sm)",
      "letter-spacing: 0.12em",
      "text-transform: uppercase",
      "color: var(--neutral-300)",
    ],
  },
  {
    name: ".ae-body",
    mustContain: [
      "font-family: var(--font-body)",
      "font-size: var(--text-sm)",
      "color: var(--neutral-200)",
    ],
  },
  {
    name: ".ae-body-sm",
    mustContain: [
      "font-family: var(--font-body)",
      "font-size: var(--text-xs)",
      "color: var(--neutral-400)",
    ],
  },
  {
    name: ".ae-label",
    mustContain: [
      "font-family: var(--font-body)",
      "font-size: var(--text-xs)",
      "letter-spacing: 0.04em",
      "color: var(--neutral-400)",
    ],
  },
  {
    name: ".ae-mono",
    mustContain: [
      "font-family: var(--font-mono)",
      "font-size: var(--text-xs)",
      "color: var(--neutral-300)",
    ],
  },
  {
    name: ".ae-code",
    mustContain: [
      "font-family: var(--font-mono)",
      "background: var(--neutral-800)",
      "color: var(--color-success)",
    ],
  },
];

function extractRuleBody(source: string, selector: string): string {
  const escaped = selector.replace(/[.]/g, "\\.");
  const pattern = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Class ${selector} not found in index.css`);
  }
  return match[1];
}

describe("semantic type classes (.ae-*)", () => {
  it.each(EXPECTED_CLASSES)(
    "$name is defined with canonical declarations",
    ({ name, mustContain }) => {
      const body = extractRuleBody(css, name);
      for (const decl of mustContain) {
        expect(body).toContain(decl);
      }
    },
  );

  it("exposes exactly the 8 canonical ae-* classes", () => {
    const names = EXPECTED_CLASSES.map((c) => c.name);
    for (const name of names) {
      expect(css).toContain(name);
    }
    // No accidental duplicate definition (each class block appears exactly once).
    for (const name of names) {
      const escaped = name.replace(/[.]/g, "\\.");
      const pattern = new RegExp(`${escaped}\\s*\\{`, "g");
      const matches = css.match(pattern) ?? [];
      expect(matches.length).toBe(1);
    }
  });
});
