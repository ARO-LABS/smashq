import type { CSSProperties } from "react";

/**
 * Kuratierte Per-Session-Akzentpalette. Werte = oklch-Hue-Winkel (Farbraum des
 * Codebase, NICHT HSL). An die semantischen Tokens angelehnt (amber↔warning 70,
 * emerald↔success 155, azure↔info ~250), damit die Palette im selben System sitzt.
 * Lightness/Chroma kommen mode-abhängig aus index.css (--accent-l/--accent-c),
 * daher hier nur der Hue. cyan = Index 0 = globaler Default (kein Breaking Change).
 */
export const ACCENT_HUES = {
  cyan: 195,
  violet: 285,
  amber: 70,
  rose: 15,
  emerald: 155,
  azure: 245,
} as const;

export type AccentName = keyof typeof ACCENT_HUES;

export const ACCENT_NAMES = Object.keys(ACCENT_HUES) as AccentName[];

/** oklch lightness for the dot/swatch — fixed at the dark-mode accent stop. */
const ACCENT_DOT_L = "72%";
/** oklch chroma for the dot/swatch — fixed at the dark-mode accent stop. */
const ACCENT_DOT_C = "0.16";

export function isAccentName(value: unknown): value is AccentName {
  return typeof value === "string" && value in ACCENT_HUES;
}

/** Deterministischer String-Hash (FNV-artig), stabil über App-Neustarts. */
function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Ordnerpfad → stabile Palette-Farbe. Leerer Pfad → erster Eintrag (cyan). */
export function hashFolderToAccent(folder: string): AccentName {
  const index = hashString(folder ?? "") % ACCENT_NAMES.length;
  return ACCENT_NAMES[index];
}

/**
 * Auflösung der Akzentfarbe einer Session, Priorität von stark nach schwach:
 *   1. Per-Ordner-Override (keyed by folder path) — die geteilte "Projektfarbe",
 *      die Favorit UND alle Sessions desselben Ordners einfärbt.
 *   2. Legacy Per-Session-Override (keyed by claudeSessionId) — bleibt erhalten,
 *      damit früher gesetzte Einzelfarben nicht verloren gehen; ein Ordner-Pick
 *      schlägt ihn aber, damit Umfärben immer sichtbar greift.
 *   3. Ordner-Hash-Default.
 * Unbekannte Override-Namen werden auf jeder Ebene übersprungen.
 */
export function resolveSessionAccent(
  session: { folder: string; claudeSessionId?: string | null },
  overrides: Record<string, string>,
  folderAccents: Record<string, string> = {},
): AccentName {
  const folder = session.folder ?? "";
  const folderOverride = folderAccents[folder];
  if (isAccentName(folderOverride)) return folderOverride;

  const key = session.claudeSessionId?.trim();
  if (key) {
    const override = overrides[key];
    if (isAccentName(override)) return override;
  }
  return hashFolderToAccent(folder);
}

/** Inline-Style, der NUR den Hue überschreibt — L/C/Alpha erben aus index.css. */
export function accentCssVars(name: AccentName): CSSProperties {
  return { ["--accent-h"]: String(ACCENT_HUES[name]) } as CSSProperties;
}

/**
 * Resolve a project/session to a concrete oklch color string for a dot/swatch.
 * Mirrors the per-session accent (#261): an explicit, valid override name wins,
 * else the folder path deterministically hashes to a palette hue. Lightness and
 * chroma are fixed at the dark-mode accent stop so the dot reads consistently.
 */
export function accentColorFor(folder: string, override?: string | null): string {
  const name: AccentName = isAccentName(override) ? override : hashFolderToAccent(folder ?? "");
  return `oklch(${ACCENT_DOT_L} ${ACCENT_DOT_C} ${ACCENT_HUES[name]})`;
}

/**
 * Theme-aware frame color for grid cells: same hue resolution as
 * `accentColorFor`, but lightness/chroma follow the mode stops from index.css
 * (--accent-l/--accent-c). In dark mode that is identical to the dot color;
 * in light mode the frame drops to L=55% so it stays visible on the light
 * surface — a fixed L=72% frame washes out there.
 */
export function accentFrameColorFor(folder: string, override?: string | null): string {
  const name: AccentName = isAccentName(override) ? override : hashFolderToAccent(folder ?? "");
  return `oklch(var(--accent-l) var(--accent-c) ${ACCENT_HUES[name]})`;
}
