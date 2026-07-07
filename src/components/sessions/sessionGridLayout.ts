/**
 * Layout-Helper für das Session-Grid.
 *
 * Liefert `grid-template`-CSS und die Area-Namen für 1..4 Sessions.
 * Wurde aus `SessionGrid.tsx` extrahiert, damit `SessionManagerView.tsx`
 * alle SessionTerminal-Instanzen in EINEM stabilen JSX-Baum rendern kann
 * (kein Remount bei Layout-Switch → xterm-Scrollback bleibt erhalten).
 *
 * Beheimatet zusätzlich die reinen Grid-Helfer für Fokus-Wahl
 * (`pickGridFocus`) und Kompositions-Fold-in (`foldActiveIntoComposition`),
 * die `sessionStore.setLayoutMode` als zustandsfreie Bausteine nutzt.
 */

import type { CSSProperties } from "react";

export const GRID_AREAS = ["a", "b", "c", "d"] as const;

/**
 * Maximale Anzahl gleichzeitig im Grid sichtbarer Sessions.
 * Abgeleitet aus der Grid-Geometrie (eine Area pro Slot), damit Slot-Kapazität
 * und CSS-Template nicht auseinanderdriften können — siehe `getGridStyle`.
 */
export const MAX_GRID_SLOTS = GRID_AREAS.length;

type SlotCount = 1 | 2 | 3 | 4;

/**
 * Rohe Template-Geometrie pro Slot-Anzahl — Single Source für den
 * Positions-Indikator (`getGridMiniMap`). Jede `rowAreas`-Zeile ist eine
 * Grid-Reihe mit space-getrennten Area-Namen und spiegelt exakt die Templates
 * aus `getGridStyle`. Ein Konsistenz-Test (`sessionGridLayout.test.ts`) hält
 * beide gegen Drift zusammen.
 */
const GRID_TEMPLATES: Record<SlotCount, { columns: string; rowAreas: readonly string[] }> = {
  1: { columns: "1fr", rowAreas: ["a"] },
  2: { columns: "1fr", rowAreas: ["a", "b"] },
  3: { columns: "1fr 1fr", rowAreas: ["a b", "c c"] },
  4: { columns: "1fr 1fr", rowAreas: ["a b", "c d"] },
};

/** Menschlich lesbare Positions-Labels (aria) pro Slot-Anzahl und Index. */
const GRID_POSITIONS: Record<SlotCount, readonly string[]> = {
  1: ["Vollbild"],
  2: ["oben", "unten"],
  3: ["oben links", "oben rechts", "unten"],
  4: ["oben links", "oben rechts", "unten links", "unten rechts"],
};

function clampSlotCount(count: number): SlotCount {
  if (count <= 1) return 1;
  if (count >= 4) return 4;
  return count as SlotCount;
}

/** Positions-Modell für die Mini-Map in der SessionCard. */
export interface GridMiniMap {
  /** grid-template-columns der Mini-Map. */
  columns: string;
  /** grid-template-rows der Mini-Map. */
  rows: string;
  /** grid-template-areas (identisch zum echten Grid-Template). */
  areas: string;
  /** Alle Area-Namen dieser Slot-Anzahl (zu rendernde Zellen). */
  cells: readonly string[];
  /** Die Area, die diese Session belegt (hervorgehobene Zelle). */
  active: string;
  /** Positions-Label für aria (z.B. "oben links"). */
  position: string;
}

/**
 * Liefert das Mini-Map-Modell für eine im Grid liegende Session.
 *
 * - `index`: Position der Session in `gridSessionIds` (`indexOf`).
 * - `count`: Anzahl der Grid-Sessions (`gridSessionIds.length`), auf 1..4 geclamped.
 *
 * Gibt `null` zurück, wenn die Session nicht im Grid ist (`index < 0`).
 * Die Geometrie spiegelt 1:1 `getGridStyle`, sodass der Indikator die reale
 * Anordnung abbildet: 2 = Hälften, 3 = T-Form, 4 = Quadranten.
 */
export function getGridMiniMap(index: number, count: number): GridMiniMap | null {
  if (index < 0) return null;
  const slots = clampSlotCount(count);
  const template = GRID_TEMPLATES[slots];
  const rows = template.rowAreas.map(() => "1fr").join(" ");
  const areas = template.rowAreas.map((row) => `"${row}"`).join(" ");
  const cells = GRID_AREAS.slice(0, slots);
  return {
    columns: template.columns,
    rows,
    areas,
    cells,
    active: GRID_AREAS[index] ?? cells[cells.length - 1],
    position: GRID_POSITIONS[slots][index] ?? "im Grid",
  };
}

/**
 * Liefert ein `gridTemplate`-CSS-Fragment für eine gegebene Session-Anzahl.
 *
 * - 1 Session → full-width/height Single-Zelle (area "a").
 * - 2 Sessions → vertikal gestapelt ("a" oben, "b" unten).
 * - 3 Sessions → obere Reihe zweigeteilt, untere Reihe voll ("c c").
 * - 4 Sessions → 2x2 Grid.
 *
 * Fällt bei count>=4 oder <=0 auf das 4er-Template zurück.
 */
export function getGridStyle(count: number): CSSProperties {
  switch (count) {
    case 1:
      return { gridTemplate: '"a" 1fr / 1fr' };
    case 2:
      return { gridTemplate: '"a" 1fr "b" 1fr / 1fr' };
    case 3:
      return { gridTemplate: '"a b" 1fr "c c" 1fr / 1fr 1fr' };
    case 4:
    default:
      return { gridTemplate: '"a b" 1fr "c d" 1fr / 1fr 1fr' };
  }
}

/**
 * Single-Layout-Template: eine Zelle "a" nimmt den gesamten Raum ein.
 * Wird für den Single-Modus verwendet, damit das Grid-Layout identisch
 * zu `getGridStyle(1)` ist — die Grid-Struktur ändert sich nicht
 * zwischen Single und Grid(1), nur die Sichtbarkeit der Wrapper-Divs.
 */
export const SINGLE_LAYOUT_STYLE: CSSProperties = {
  gridTemplate: '"a" 1fr / 1fr',
};

/**
 * Wählt den fokussierten Grid-Slot beim Eintritt in den Grid-Modus.
 *
 * Drei-Stufen-Hierarchie nach stärkstem User-Intent-Signal:
 *   1) `activeSessionId` — was der User gerade im Single-Modus betrachtet hat
 *      (stärkstes Signal; `maximizeGridSession` schreibt das beim Verlassen).
 *   2) `focusedGridSessionId` — letzte In-Grid-Auswahl (trägt Grid-Navigation,
 *      wenn kein Single-Modus-Umweg stattfand).
 *   3) `candidates[0]` — Default (erster Slot), sonst `null` bei leerer Liste.
 *
 * Pur: keine Store-Abhängigkeit, nur die drei relevanten Felder als Primitive.
 */
export function pickGridFocus(
  activeSessionId: string | null,
  focusedGridSessionId: string | null,
  candidates: string[]
): string | null {
  if (activeSessionId && candidates.includes(activeSessionId)) {
    return activeSessionId;
  }
  if (focusedGridSessionId && candidates.includes(focusedGridSessionId)) {
    return focusedGridSessionId;
  }
  return candidates[0] ?? null;
}

/**
 * Faltet die gerade betrachtete Session (`activeId`) in eine bestehende
 * Grid-Komposition ein ("aktuelle Ansicht zum Grid erweitern").
 *
 * - `activeId === null` oder bereits enthalten → `preserved` unverändert.
 * - Platz vorhanden (`preserved.length < maxSlots`) → hinten anhängen.
 * - Voll → letzten Slot verdrängen (erste `maxSlots - 1` kuratierten Zellen
 *   bleiben, die zuletzt betrachtete Session erscheint als Neuzugang).
 *
 * Pur: gibt eine neue Array-Instanz zurück, mutiert `preserved` nicht.
 */
export function foldActiveIntoComposition(
  preserved: string[],
  activeId: string | null,
  maxSlots: number
): string[] {
  if (!activeId || preserved.includes(activeId)) {
    return preserved;
  }
  return preserved.length < maxSlots
    ? [...preserved, activeId]
    : [...preserved.slice(0, maxSlots - 1), activeId];
}
