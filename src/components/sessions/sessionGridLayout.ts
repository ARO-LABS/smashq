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
