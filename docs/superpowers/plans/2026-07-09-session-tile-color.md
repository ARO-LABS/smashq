# Session-Colored Layout Tile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die aktive Kachel der Session-Mini-Map zeigt die zugewiesene Session-Farbe (exakt wie der Punkt links) statt immer Azure-Blau.

**Architecture:** Einzeiler-Aenderung in `SessionCard.tsx`: die aktive Mini-Map-Zelle rendert `background: dotBackground` als Inline-Style statt der statischen Tailwind-Klasse `bg-accent`. `dotBackground` ist bereits im Komponenten-Scope und enthaelt die komplette Punkt-Logik (Status-Override + zugewiesene Accent-Farbe), sodass Punkt und Kachel per Konstruktion identisch sind.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS; vitest + @testing-library/react (jsdom).

## Global Constraints

- Aktive Kachel-Farbe = `dotBackground` (`SessionCard.tsx:56-61`): `status === "error"` → `var(--color-error)`; `status === "waiting"` → `var(--color-warning)`; sonst `dotColor` (= `accentColorFor(folder, accent)`, ein oklch-String).
- NUR die aktive Zelle aendert sich. Inaktive Zellen bleiben unveraendert `bg-neutral-600`, ohne Inline-Background.
- Keine `accentFrameColorFor`-Variante verwenden — die Vorgabe ist „exakt wie der Punkt", also die exakte Punkt-Variable `dotBackground`.
- Kein Eingriff in Farbspeicher (`folderAccents`/`sessionAccents`), Palette (`ACCENT_HUES`), Accent-Menue oder Grid-Layout.
- Kein App-Version-Bump / kein `whatsNew.ts` in diesem PR (reiner Bugfix; CHANGELOG `[Unreleased]` genuegt).

---

## File Structure

| Datei | Verantwortung | Aktion |
|---|---|---|
| `src/components/sessions/SessionCard.tsx` | Mini-Map-Zell-Render (aktive Zelle einfaerben) | Modify (`:259-260`) |
| `src/components/sessions/SessionCard.test.tsx` | Mini-Map-Farb-Assertions | Modify (`:536` + neue Tests) |
| `CHANGELOG.md` | `[Unreleased]` → Behoben | Modify |
| `tasks/todo.md` | Pflege-Trigger | Modify |

---

## Task 1: Aktive Mini-Map-Kachel in Session-Farbe

**Files:**
- Modify: `src/components/sessions/SessionCard.tsx:252-263` (Zell-Render-Callback)
- Modify: `src/components/sessions/SessionCard.test.tsx:521-537` (bestehender Mini-Map-Test) + neue Tests

**Interfaces:**
- Consumes: `dotBackground` (bereits definiert `SessionCard.tsx:56-61`), `miniMap` (`:52`), Zell-Variable `on` (`:253`).
- Produces: keine neuen Symbole. Verhalten: aktive Zelle traegt Inline-`style.background === dotBackground`, kein `bg-accent`; inaktive Zellen unveraendert `bg-neutral-600`.

- [ ] **Step 1: Bestehenden Mini-Map-Test anpassen + neue Farb-Tests schreiben (RED)**

In `src/components/sessions/SessionCard.test.tsx` im `describe("active and grid markers", …)`:

Die Assertion im Test `renders a position-aware mini-map when gridSlot is set` (aktuell `:536`) ersetzen:

```ts
      const active = map.querySelector('[data-active="true"]') as HTMLElement;
      expect(active?.getAttribute("data-cell")).toBe("c");
      // Aktive Zelle nutzt jetzt die Session-Farbe inline, nicht mehr bg-accent.
      expect(active.className).not.toContain("bg-accent");
      expect(active.style.background).toContain("oklch");
```

Direkt nach diesem Test (vor `adapts the mini-map to the session count …`) zwei neue Tests einfuegen:

```ts
    it("mini-map active cell matches the session dot color (idle)", () => {
      const { container } = render(
        <SessionCard
          session={makeSession({ folder: "C:/Projects/x", title: "t" })}
          isActive={false}
          gridSlot={{ index: 2, count: 4 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const dot = container.querySelector("[data-testid='sess-dot']") as HTMLElement;
      const active = container.querySelector('[data-active="true"]') as HTMLElement;
      expect(active.style.background).toBe(dot.style.background);
      expect(active.style.background).toContain("oklch");
    });

    it("mini-map active cell follows the dot into error state", () => {
      const { container } = render(
        <SessionCard
          session={makeSession({ folder: "C:/Projects/x", title: "t", status: "error" })}
          isActive={false}
          gridSlot={{ index: 2, count: 4 }}
          onClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      const active = container.querySelector('[data-active="true"]') as HTMLElement;
      expect(active.style.background).toContain("--color-error");
      // Inaktive Zellen bleiben neutral, ohne Inline-Farbe.
      const inactive = container.querySelector('[data-cell]:not([data-active="true"])') as HTMLElement;
      expect(inactive.className).toContain("bg-neutral-600");
      expect(inactive.style.background).toBe("");
    });
```

- [ ] **Step 2: Tests laufen ROT**

Run: `npx vitest run src/components/sessions/SessionCard.test.tsx -t "mini-map"`
Expected: FAIL — die aktive Zelle traegt noch `bg-accent` und hat keinen Inline-`background` (`active.style.background` ist leer), daher schlagen `.not.toContain("bg-accent")`, `.toContain("oklch")`, `toBe(dot.style.background)` und `--color-error` fehl.

- [ ] **Step 3: Aktive Zelle einfaerben (GREEN)**

In `src/components/sessions/SessionCard.tsx` den Zell-Render (`:255-261`) aendern zu:

```tsx
              <span
                key={area}
                data-cell={area}
                data-active={on ? "true" : undefined}
                className={`rounded-xs ${on ? "" : "bg-neutral-600"}`}
                style={{ gridArea: area, background: on ? dotBackground : undefined }}
              />
```

(Nur `className` und `style` der `<span>` aendern: `bg-accent` faellt weg, die aktive Zelle bekommt `background: dotBackground` inline; inaktive Zellen unveraendert.)

- [ ] **Step 4: Tests laufen GRUEN**

Run: `npx vitest run src/components/sessions/SessionCard.test.tsx`
Expected: PASS — alle Mini-Map-Tests inkl. der zwei neuen; keine Regression in den uebrigen SessionCard-Tests.

- [ ] **Step 5: Type-Check**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/components/sessions/SessionCard.tsx src/components/sessions/SessionCard.test.tsx
git commit -m "fix(ui): mini-map active tile uses assigned session color (#9)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CHANGELOG + Pflege-Trigger

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]` → `### Behoben`)
- Modify: `tasks/todo.md`

- [ ] **Step 1: CHANGELOG-Eintrag ergaenzen**

In `CHANGELOG.md` unter `## [Unreleased]` in der (ggf. neu anzulegenden) Rubrik `### Behoben` ergaenzen (echte Umlaute, Keep-a-Changelog, deutsch):

```markdown
- Die Layout-Mini-Map in der Session-Liste färbte die aktive Kachel immer azurblau statt in der zugewiesenen Session-Farbe (#9). Die aktive Kachel nutzt jetzt exakt die Farbe des Session-Punkts (inkl. Fehler-/Wartet-Status).
```

Falls unter `[Unreleased]` bereits eine `### Behoben`-Liste existiert, den Eintrag dort anhaengen; sonst die Rubrik in Keep-a-Changelog-Reihenfolge (nach `### Geaendert`, sonst als erste) einfuegen.

- [ ] **Step 2: tasks/todo.md — Pflege-Trigger**

`tasks/todo.md` lesen und den Issue-#9-Fix im vorhandenen Format vermerken (aktive Phase / Backlog gemaess Umbrella-Regel). Kein Lessons-Eintrag noetig (reiner UI-Fix ohne neue Regel).

- [ ] **Step 3: Gates**

Run: `npx tsc --noEmit && npm run build && npx vitest run`
Expected: TS-Check clean, Build gruen, alle vitest-Tests PASS.
(Kein Rust berührt — cargo-Gates nicht erforderlich.)

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md tasks/todo.md
git commit -m "docs(session): changelog for session-colored layout tile (#9)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** Aktive Kachel = `dotBackground` (Task 1 Step 3); nur aktive Zelle, inaktive bleiben `bg-neutral-600` (Task 1 Step 3 + Edge-Test); kein `accentFrameColorFor` (verwendet `dotBackground`); Tests Happy (idle = Punkt-Farbe) + Edge (error) (Task 1 Step 1); CHANGELOG Behoben (Task 2). Alle Spec-Punkte abgedeckt. ✔

**Placeholder scan:** Keine TBD/TODO; jeder Code-Step zeigt vollstaendigen Code, jeder Test-Step echten Testcode. ✔

**Type consistency:** `dotBackground` ist der exakte, bereits definierte Variablenname (`SessionCard.tsx:56`); `on` ist die bestehende Zell-Boolean (`:253`); Test-Selektoren (`[data-active="true"]`, `[data-testid='sess-dot']`, `[data-cell]`) matchen die realen Attribute im JSX. ✔
