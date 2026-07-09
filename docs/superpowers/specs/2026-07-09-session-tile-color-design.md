# Design-Spec: Layout-Kachel in Session-Farbe (Issue #9)

**Status:** Genehmigt (Brainstorming abgeschlossen 2026-07-09)
**Ephemer:** Diese Datei wird im selben Commit wie der Feature-Merge geloescht (Doku-Hygiene, CLAUDE.md).

## Problem

In der Session-Liste zeigt jede Zeile rechts eine 12px-Mini-Map, die die Grid-Anordnung
und die Position des Session-Terminals visualisiert. Die aktive Kachel (die Position
dieser Session) ist **immer blau** — sie nutzt hart die Tailwind-Klasse `bg-accent`
(= Azure-Default, hue 230). Das irritiert, weil links in derselben Zeile ein farbiger
Punkt die der Session **zugewiesene Farbe** zeigt. Kachel und Punkt sollen dieselbe
Farbe haben.

## Ziel & Scope

- **In-Scope:** Die aktive Mini-Map-Kachel in `SessionCard.tsx` bekommt exakt die Farbe
  des Punkts (Variable `dotBackground`) statt der statischen `bg-accent`-Klasse.
- **Verhalten (per Brainstorming entschieden):** Die Kachel spiegelt den Punkt **1:1** —
  inklusive Status-Ueberschreibung (Fehler → rot, Wartet → amber; sonst zugewiesene
  Accent-Farbe). Punkt und Kachel sind strukturell nie unterschiedlich.
- **Out-of-Scope (YAGNI):** Kein Eingriff in Farbspeicher (`folderAccents`/`sessionAccents`),
  Palette (`ACCENT_HUES`), Accent-Menue, Grid-Layout oder die inaktiven Kacheln
  (bleiben `bg-neutral-600`).

## Betroffene Stellen (bereits verifiziert)

- **`src/components/sessions/SessionCard.tsx`**
  - `:42` `resolveSessionAccent(session, sessionAccents, folderAccents)` → `accent`
  - `:47` `const dotColor = accentColorFor(folder, accent);` (zugewiesene Accent-Farbe, oklch-String)
  - `:56-61` `const dotBackground = status === "error" ? "var(--color-error)" : status === "waiting" ? "var(--color-warning)" : dotColor;`
  - `:252-263` Mini-Map-Zell-Render; **`:259`** `className={`rounded-xs ${on ? "bg-accent" : "bg-neutral-600"}`}`, `:260` `style={{ gridArea: area }}`.
- **`src/components/sessions/SessionCard.test.tsx`** — `describe("active and grid markers")`; die bestehende Assertion (`active?.className` enthaelt `bg-accent`) muss auf den Inline-Background umgestellt werden.

## Aenderung

Die aktive Zelle rendert die Farbe als **Inline-Style** (derselbe Mechanismus wie der
Punkt bei `:141-146`), statt der `bg-accent`-Klasse:

```tsx
// SessionCard.tsx :259-260
className={`rounded-xs ${on ? "" : "bg-neutral-600"}`}
style={{ gridArea: area, background: on ? dotBackground : undefined }}
```

- Aktive Zelle: kein `bg-accent` mehr; `background: dotBackground` inline.
- Inaktive Zelle: unveraendert `bg-neutral-600`, `background: undefined`.
- `dotBackground` ist bereits im Komponenten-Scope vorhanden (`:56`) — keine neue
  Berechnung, kein neuer Import, keine zweite Farbquelle. Damit ist Punkt-/Kachel-Farbe
  per Konstruktion identisch.

**Warum `dotBackground` (nicht `accentFrameColorFor`):** Es existiert eine „Frame"-Variante
fuer die echten Grid-Zellen (`SessionManagerView.tsx`). Die Vorgabe ist aber „exakt wie der
Punkt" — daher die exakte Punkt-Variable, kein zweiter, leicht abweichender Farbwert.

## Tests (Quality Gate: 1 Happy + 1 Edge)

- **Anpassen:** Die bestehende Mini-Map-Assertion, die `bg-accent` auf der aktiven Zelle
  prueft, umstellen auf: aktive Zelle traegt KEIN `bg-accent` mehr und hat einen
  Inline-`background` gleich der Punkt-Farbe (Happy Path: idle → oklch-Accent-Farbe;
  identisch zum `sess-dot`-Background).
- **Neu (Edge):** aktive Zelle bei `session.status === "error"` → Inline-`background`
  `var(--color-error)` (beweist: Kachel folgt dem Punkt inkl. Status). Inaktive Zellen
  behalten `bg-neutral-600` ohne Inline-Background.

## Doku

- **CHANGELOG.md** `[Unreleased]` → Rubrik **Behoben**: die Mini-Map-Kachel nutzt jetzt die
  zugewiesene Session-Farbe statt immer Azure. (#9)
- `tasks/todo.md` + `tasks/lessons.md`: Pflege-Trigger (kein zwingender Lessons-Eintrag —
  reiner UI-Fix ohne neue Regel).

## Nicht-Ziele

- Keine Aenderung an der Punkt-Logik, am Palette-Set oder an der Accent-Zuweisung.
- Keine Einfaerbung inaktiver Kacheln.
