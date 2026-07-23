# CLAUDE.md

## Project Overview

**Smashq** — Desktop-App zum Verwalten und Ueberwachen von Claude CLI Sessions. Multi-Session-Terminal mit Projekt-Kontext, Favoriten-System und Notizen. Gebaut mit Tauri v2 + React.

**Tech-Stack**: React 18 + TypeScript + Vite (Frontend), Tauri v2 + Rust (Backend), Zustand (State), Tailwind CSS + Framer Motion (Styling/Animation)

**Language**: UI und Doku auf Deutsch, Code auf Englisch

> **Feature-Politik (Feature-Freeze beendet am 2026-07-20):** Neue Features sind wieder zugelassen — unter zwei Auflagen: (1) **ausgiebige Tests** über das Quality-Gate-Minimum hinaus (Happy-Path + Edge-Cases + bei UI-Änderungen visuelle Smoke), (2) **harmonische Integration ins Design-System** (`docs/design-system/README.md`, Pflicht-Check unten). Unterspezifizierte Issues werden NICHT auf Annahmen gebaut: Rückfrage-Kommentar ins Issue schreiben; bis zur Antwort bleibt das Issue im Backlog. (Historie: Session Manager wurde aus der AgenticExplorer-v1.6.x-Linie übernommen, Versionierung beim Rebrand neu ab 1.0.0.)

## Commands

```bash
npm run dev              # Vite Dev-Server (Port 5173)
npm run build            # TypeScript-Check + Vite Production Build
npx tsc --noEmit         # Type-Checking ohne Build
npm run tauri dev        # Tauri Desktop-App im Dev-Modus
npm run tauri build      # Kompletter Desktop-Build
npm run test             # Alle Tests (vitest run)
npm run test:coverage    # Tests mit Coverage-Report
npm run lint             # ESLint
```

## Architecture

**Frontend** (`src/`): React-Komponenten, Zustand-Stores. **Backend** (`src-tauri/`): Rust/Tauri, PTY-Sessions, GitHub via `gh` CLI.

**Datenfluss**: User → Session erstellen → Rust spawnt PTY → `session-output` Events → xterm.js Terminal

**Schluessel-Dateien**:
- `src/store/sessionStore.ts` — Session-Management (ephemer)
- `src/store/settingsStore.ts` — Persistierter State (Favorites, Notes, Theme)
- `src/store/uiStore.ts` — UI-State (Tabs, Toasts)
- `src-tauri/src/session/` — Rust Session Manager (PTY, Commands)
- `src/components/sessions/SessionManagerView.tsx` — Haupt-View
- **Logs (NDJSON, für Analyse)**: `%LOCALAPPDATA%\smashq\app-log.ndjson` (+ `.1`..`.3` rotiert). Nur wenn "Log-Datei (NDJSON)" in Settings aktiv. Eine JSON-Zeile pro Eintrag: `{ts, level, source, module?, message, stack?}`. Backend-Logs live via `log-line`-Event.

## Arbeitsweise

- **Plan-First**: Bei 3+ Schritten oder Architektur-Entscheidungen → Plan Mode. Bei Problemen: STOP → re-planen.
- **Subagents liberal einsetzen**: Research und Exploration delegieren. Main Context sauber halten.
- **Verification vor Done**: Build gruen + Diff beweist Funktion. Massstab: Staff-Engineer-Level.
- **Autonomes Bug-Fixing**: Logs lesen, Fehler finden — ohne Rueckfragen.
- **Root Causes**: Keine temporaeren Fixes. Ursachen finden.
- **Kleine Commits**: Max 5-10 Dateien. Features in logische Schritte aufteilen.
- **Doku-Hygiene (vermeidet File-Wuchs)**: (1) Plan-/Spec-Files sind ephemer — werden im selben Commit wie der Feature-Merge geloescht (kein `docs/superpowers/`-Friedhof, kein `.claude/plans/`-Friedhof). (2) `tasks/` enthaelt nur `todo.md` und `lessons.md` — keine datierten Sub-Files (`tasks/2026-XX-*.md` ist verboten), kein `tasks/specs/`. Working-Plans gehoeren in `.claude/plans/<feature>.md` und sind ephemer. (3) Kein neues Meta-Inventar — "Wo finde ich X" lebt im `README.md`. Wenn ein Dokument sich rechtfertigen muss um zu existieren, gehoert es nicht ins Repo.
- **Pflege-Trigger (PFLICHT)**: **Vor jedem `git push` und vor jedem Release-Tag** `tasks/todo.md` + `tasks/lessons.md` öffnen und gegen aktuellen Stand prüfen — geschlossene Issues/PRs/Phasen raus, neue Lessons rein. Bei jeder User-Korrektur sofort Lessons updaten (Format: Fehler → Korrektur → Regel). Bei Session-Start: aktuelle Phase + relevante Lessons lesen.
- **Erstellte HTML-Artefakte direkt oeffnen**: Nach Generierung von Praesis, Reports oder vergleichbaren HTML-Dateien (auch PPTX-Builds, generierte Dashboards) sofort via `Start-Process <path>` im Default-Browser/Default-App oeffnen. Spart den manuellen Klick — User sieht das Ergebnis ohne Zwischenschritt.

## Task Management

- `tasks/todo.md` — 1 aktive Phase + 1 nächste Phase + flacher Backlog (umbrella-Regel)
- `tasks/lessons.md` — Lessons Learned (Fehler → Korrektur → Regel)

## GitHub Issues

Issues IMMER ueber die drei Issue-Forms in `.github/ISSUE_TEMPLATE/` erstellen (Blank Issues sind deaktiviert) — auch bei `gh issue create` die Feldstruktur des passenden Templates im Body nachbilden und das Label setzen:

- **Bug Report** (`bug`) — Fehler; Bugfixes dürfen immer direkt umgesetzt werden.
- **Feature Request** (`enhancement`) — umsetzbar, sobald das Issue ausreichend spezifiziert ist (Auflagen siehe Feature-Politik oben); unterspezifizierte Issues bekommen einen Rückfrage-Kommentar und warten im Backlog (`tasks/todo.md`).
- **Task / Chore** (`chore`) — Refactoring, CI, Doku, Dependencies, Release-Pflege.

Sprache: Deutsch. Bug-Reports brauchen App-Version + OS; Log-Auszug aus `%LOCALAPPDATA%\smashq\app-log.ndjson` beilegen, wenn vorhanden.

## Development Workflow

- `npx tsc --noEmit` nach .ts/.tsx Aenderungen
- `npm run build` vor PRs
- `cd src-tauri && cargo check` fuer Rust-Aenderungen
- **Pre-Commit** (Husky + lint-staged): `tsc --noEmit` + `eslint` fuer TS, `cargo fmt --check` + `cargo check` fuer Rust
- **CI**: `npm run test:coverage` (Ratchet-Schwellen), `cargo test` + `cargo clippy`
- **Test-Layer**: A = Rust integration (`src-tauri/tests/*.rs`), B = Frontend integration (`*.integration.test.ts` via separates `vitest.config.integration.ts`), C = E2E (geplant). B-Tests nutzen Real-IPC via `mockIPC` aus `@tauri-apps/api/mocks` — NIEMALS `vi.mock("@tauri-apps/api/core")` oder Store-Mocks.
- **Null-Safety**: `?.` und `??` bei Tauri-Events, Store-Zugriffen, User-Input
- **Signature Changes**: Grep nach allen Usages, ALLE Caller updaten
- **Nicht behaupten, verifizieren**: Build-Log/Screenshot als Beweis

## Rust Toolchain

- **Autoritativ**: `src-tauri/rust-toolchain.toml` pinnt die Rust-Version (aktuell `1.95.0`) + `rustfmt` + `clippy`. `rustup` installiert beim ersten `cargo`-Aufruf automatisch die richtige Version.
- **CI matcht lokal**: Alle Workflows (`ci.yml`, `release.yml`, `security-audit.yml`) pinnen dieselbe Version via `dtolnay/rust-toolchain@master` mit `toolchain: "1.95.0"`. Bump passiert an beiden Stellen gemeinsam.
- **Bei Clippy-Drift**: `rustup update` + `cargo clean` + `cargo clippy -- -D warnings` lokal laufen lassen, dann push.

## Quality Gates (vor "Done")

- [ ] 1 Happy-Path-Test + 1 Edge-Case-Test pro Feature
- [ ] Test-Datei im selben Commit wie Feature
- [ ] `npx tsc --noEmit && npm run build` erfolgreich
- [ ] Visuelle Pruefung bei UI-Aenderungen
- [ ] Tauri-Commands: Input validiert? Path Traversal? Shell-Injection? Timeout? Fehler strukturiert?

## Release-Prozess

Ein Release wird durch einen Tag-Push (`v*`) ausgeloest — `release.yml` baut, signiert und published dann automatisch. Checkliste in dieser Reihenfolge:

1. **Version bumpen** in ALLEN drei Manifesten: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — danach `cd src-tauri && cargo check` (zieht `Cargo.lock` nach). **Semver-Falle:** Die neue Version MUSS groesser sein als die alte — der Tauri-Updater vergleicht semver und bietet eine kleinere Version niemandem an (z.B. waere 1.0.3 nach 1.0.21 fuer alle Bestands-User unsichtbar).
2. **`CHANGELOG.md`**: `[Unreleased]`-Inhalte in eine neue `[x.y.z] — YYYY-MM-DD`-Sektion ueberfuehren (Keep-a-Changelog, deutsch, Rubriken Hinzugefuegt/Behoben/Geaendert/Sicherheit).
3. **`src/whatsNew.ts` kuratieren** (Whats-New-Modal, siehe unten): Rumpf-Eintrag der Zielversion mit 3-6 Highlights + 2-4 Watchouts fuellen. **`version` MUSS exakt der App-Version entsprechen** — bei Mismatch zeigt die App still KEIN Modal (bewusster Silent-Skip fuer Wartungs-Releases). Nach dem Release direkt den Rumpf fuer den Folge-Release anlegen (Vergessens-Schutz: ein unkuratierter Rumpf faellt als duennes Modal auf).
4. **Pflege-Trigger** (siehe Arbeitsweise): `tasks/todo.md` + `tasks/lessons.md` aktualisieren.
5. **Gates**: `npx tsc --noEmit && npm run build`, volle vitest-Suite; bei beruehrten Updater-Pfaden Triple-Check (siehe unten).
6. **Taggen + pushen**: `git push && git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`. Danach `gh run watch` — Jobs: `build-windows` → `refresh-design-doc` → `build-macos` (signiert + notarisiert, merged `darwin-*`-Keys in die `latest.json`).
7. **Nach dem Lauf**: Release-Notes setzen (`gh release edit vX.Y.Z --notes-file ...`, kuratierte Highlights + „Worauf achten"), `latest.json` pruefen (windows- UND darwin-Keys vorhanden).

**Stolperfalle Bot-Commit:** Der Job `refresh-design-doc` regeneriert `docs/developer-doc.html` aus der laufenden App (Playwright) und committet als `github-actions[bot]` DIREKT auf master (`[skip ci]`). Lokale Pushes waehrend/nach einem Release-Lauf brauchen daher oft `git pull --rebase`.

## Whats-New-Modal (Update-Hinweise)

Einmaliges „Was ist neu"-Fenster nach jedem Update. Template/Content-Trennung:
- **Content**: `src/whatsNew.ts` — ein kuratierter Eintrag pro Release (`version` = exakter Match zur App-Version, sonst stiller Skip). Icons sind eine geschlossene `WhatsNewIconKey`-Union, gemappt auf die `ICONS`-Registry in `WhatsNewModal.tsx` — neuer Icon-Wunsch = bewusste Union-Erweiterung, kein Freitext.
- **Template**: `src/components/shared/WhatsNewModal.tsx` (ui/Modal-Basis) — wird pro Release NICHT angefasst.
- **Gating**: `src/hooks/useWhatsNew.ts` vergleicht `getVersion()` mit persistiertem `settingsStore.lastSeenVersion` (Schema v12). Gestempelt wird beim ANZEIGEN (Crash-sicher). `null` = echte Neuinstallation (kein Modal); die Settings-MIGRATION seedet fuer Bestands-User den Sentinel `"0.0.0"` — migrate laeuft nur bei existierendem Persist-Blob, das unterscheidet Upgrade von Neuinstallation. Diesen Sentinel-Mechanismus NICHT entfernen: ohne ihn sieht die gesamte Bestandsbasis nach einem Update kein Modal (Bug beim v1.0.23-Rollout).
- Mount in `App.tsx` — bewusst NICHT in `AppShell` (geschuetzter Updater-Pfad).

## Auto-Updater (HARTE REGEL — kritisches Feature)

Der Tauri-Auto-Updater ist der einzige Pfad, ueber den Bugfixes die installierte User-Base erreichen. Eine stille Regression hier bedeutet: User bleiben unbegrenzt auf einer kaputten Version festgenagelt, ohne sichtbaren Weg nach vorn. **Bei jeder Aenderung an einer der unten gelisteten Dateien ist Triple-Check Pflicht. Keine Ausnahme.**

### Geschuetzte Pfade

- `src/hooks/useAutoUpdate.ts` (+ `.test.ts`)
- `src/components/sessions/SessionPanelDock.tsx` (+ `.test.tsx`) — speziell `handleVersionClick`, `showInstallToast`, `showRestartToast`, der Status-Dot-Render (`bg-success` / `bg-accent`). Die Updater-UI wurde 1:1 aus dem inzwischen geloeschten `SideNav.tsx` hierher migriert.
- `src/components/layout/AppShell.tsx` — `<ToastContainer />` MUSS gemounted bleiben
- `src/components/shared/ToastContainer.tsx`
- `src/components/shared/Toast.tsx`
- `src/store/uiStore.ts` — `toasts`, `addToast`, `removeToast`
- `src-tauri/tauri.conf.json` — `plugins.updater.{pubkey,endpoints}`, `bundle.createUpdaterArtifacts`
- `src-tauri/Cargo.toml` — `tauri-plugin-updater`, `tauri-plugin-process`
- `.github/workflows/release.yml` und alles was `latest.json` signiert/uploadet

### Triple-Check (alle drei Schritte, keine Abkuerzung)

1. **Automatisierte Tests gruen**: `npx vitest run src/components/layout src/components/shared src/components/sessions/SessionPanelDock.test.tsx src/hooks/useAutoUpdate.test.ts`. Der Regression-Guard `mounts ToastContainer so addToast renders a visible toast` in `AppShell.test.tsx` MUSS bleiben und passen — er fangt genau die "Renderer-orphan"-Klasse, die im Mai 2026 alle Update-Toasts stumm geschaltet hat.
2. **Production-Build sauber**: `npm run tauri build` ohne Errors. `.exe` + signierte `latest.json` werden erzeugt.
3. **Manuelle Smoke in der installierten .exe** (Dev-Mode reicht NICHT, weil `__TAURI_INTERNALS__` & Updater-Endpoint nur produktiv greifen):
   - v-Badge unten im SessionPanelDock (Session-Leiste) klicken → Toast "Suche nach Updates..." erscheint oben rechts (Beweis: ToastContainer rendert)
   - Bei verfuegbarem Update → Toast `Update vX verfuegbar` mit Button **Installieren**, Status-Dot accent (azure)
   - Klick "Installieren" → Download laeuft, Status-Dot wechselt auf success (gruen) sobald `status === "ready"`
   - Klick v-Badge erneut → Toast `Update bereit` mit Button **Neu starten**
   - Klick "Neu starten" → App-Relaunch in neuer Version

### Nicht-verhandelbar

- `<ToastContainer />` bleibt in `AppShell` gemounted. Wer den Mount entfernt, schaltet jeden `addToast`-Call (Updater, Settings-Save-Error, Kanban, …) stumm.
- Der AppShell-Regression-Test darf nie geskippt, geloescht oder mit `it.skip` deaktiviert werden — nur erweitert.
- Kein Commit/PR an Updater-Pfaden ohne Triple-Check-Nachweis im Hand-off (Build-Log, Test-Output, Screenshot der Toasts).
- Bei Zweifeln: lieber `git restore` und User fragen, als blind durchpushen — kaputter Updater = sechs Wochen Support-Tickets.

## Coding Conventions

- Conventional Commits: `feat(scope):`, `fix(scope):`, `chore(scope):` — Scopes: `ui`, `store`, `parser`, `tauri`, `config`
- React: Functional Components + Hooks
- State: Zustand — `sessionStore` (ephemer), `settingsStore` (persistiert), `uiStore` (UI)
- Zustand-Persist-Validation: bei persistierten Stores Validation in BEIDE Hooks — `migrate` (Schema-Bump) UND `onRehydrateStorage` (same-version-Corruption-Recovery). Migrate alleine deckt Issue-#209-Klasse nicht ab.
- **Sekundärfenster-Persistenz (settingsStore)**: Nur das Hauptfenster schreibt Settings auf Platte (`tauriStorage` `isMainWindow`-Guard); Sekundärfenster (Settings-View lebt IMMER in `DetachedViewApp`) persistieren ausschließlich über den `preferences-changed`-Broadcast. Deshalb MUSS jeder Setter eines persistierten Felds, das aus einem Sekundärfenster erreichbar ist, `broadcastPreferencesChange` aufrufen (Top-Level-Felder via `{ settingsSync: ... }`) UND der Empfänger `applySettingsSync`/`applyRemotePartial` (`wireRuntimeGates.ts`) das Feld behandeln — der Empfänger ist nicht compile-time-exhaustiv, ein vergessener Zweig verliert den Wert still (Bug-Klasse PR #40; Roundtrip-Test Pflicht, siehe `lessons.md` 2026-07-16).
- Settings-Sanitize-Helpers: jedes numerische User-Setting bekommt `sanitizeXxx(value: unknown): number` mit Clamp-Range, geteilt zwischen Store-Default und UI. Kein `Math.max/min` inline in Components.
- Styling: Tailwind bevorzugen, Custom CSS nur fuer Animationen in `index.css`
- Rust: Tauri Commands in Feature-Modulen definiert (z.B. `src-tauri/src/session/commands.rs`, `session/file_reader/commands.rs`, `github/`, `settings.rs`); nur app-globale Commands im `mod commands {}` Block von `lib.rs`. Registrierung zentral in `lib.rs` (`invoke_handler`).
- Tauri v2: Imports aus `@tauri-apps/api` (v2-Syntax)

## Design System

**Single Source**: `docs/design-system/README.md` (Concept-B, azure, soft corners). Skill: `docs/design-system/SKILL.md`. Preview: `docs/design-system/preview/*.html`.

Pflicht-Check für jede neue Komponente (Details siehe Single Source):
- Soft corners (`rounded-md`/`-lg`/`-sm`/`-full`), ein Akzent (azure hue 230), keine Gradients/Blur/Glassmorphism
- Lucide-Icons via `src/utils/icons.ts` (`ICONS.*` + `ICON_SIZE.*`) — kein direkter `lucide-react`-Import
- Deutsche UI-Copy in Imperativ/Infinitiv (kein `du`/`Sie`), kein Emoji, kein Unicode-as-Icon
- Motion-Tokens aus `src/utils/motion.ts` (Exponential Easing, 100/200/300/500ms, keine Springs)
- Panel-Header UPPERCASE + wide-tracking; Padding `main` (`px-4 py-3`) oder `compact` (`px-3 py-2`)
- Fokus-Ring nie unterdrücken — `:focus-visible` mit `outline: 2px solid var(--color-accent); outline-offset: 2px`
- Bei neuen Komponenten: gegen Preview-HTMLs in `docs/design-system/preview/` abgleichen

## Design-Artifacts (Pflicht bei GUI-Änderungen)

Jede Änderung mit sichtbarer Auswirkung in der GUI (neue Komponente, View, Layout-, Farb-, Icon- oder Copy-Änderung) bekommt **vor der Implementierung** ein Artifact: ein realistisches HTML-Mockup des betroffenen App-Bereichs — Ist-Zustand und Soll-Zustand nebeneinander, design-system-treu (Tokens/Regeln aus `docs/design-system/README.md`, echte Panel-Struktur der App, kein generisches Wireframe; relevante Zustände mitzeigen: leer, Fehler, Hover/Fokus wo sinnvoll). **Freigabe durch den User ist das Gate** — erst danach wird Code geschrieben.

**Qualitätsanforderungen an jedes Design-Artifact (Mockups wie sonstige Design-Arbeiten):**
1. **Ist-Zustand = 1:1 die reale App.** Der gezeigte Ist-Zustand wird aus den echten Komponenten abgeleitet (Quellcode der betroffenen Views LESEN: Labels, Reihenfolge, Icons, Abstände, Zustände) — nicht aus dem Gedächtnis oder von Screenshots Dritter. Nur wenn Ist exakt stimmt, kann der User den Soll-Unterschied eruieren. Abweichungen, die sich nicht verifizieren lassen, explizit im Artifact kennzeichnen.
2. **Soll-Zustand immer daneben** — gleiche Struktur, gleiche Panel-Breite, damit der Diff visuell springt.
3. **Vollständig sichtbar, nicht versteckt, nicht verbuggt.** Alles im Artifact muss ohne Interaktion sichtbar sein (keine Inhalte hinter Hover/Klick/Scroll-Fallen, keine abgeschnittenen Panels, keine überlappenden Callouts, kein horizontales Seiten-Scrolling). Vor der Übergabe das gerenderte Artifact selbst prüfen (z.B. Playwright-Screenshot oder Browser-Check): Layout intakt, alle Sektionen erreichbar, keine Renderfehler. Erst dann liefern. In parallelen Wellen: Design-Phase sammelt alle Mockups, Freigabe en bloc, dann läuft die Implementierung ungebremst. Ausnahme: Änderungen ohne visuelle Auswirkung (Refactors, Backend, Tests). Begründung: das Mockup zwingt Design-Entscheidungen (Platzierung, Zustände, Fehlerfälle) an den Anfang, wo eine Korrektur eine Artifact-Iteration kostet statt eines PR-Umbaus.

## Kommunikation

- Code/Config/Skill LESEN bevor Aussagen machen. Belege mit Dateien und Zeilennummern.
- Unsicherheit kennzeichnen (~70% sicher etc.)
- Skills: SKILL.md komplett lesen, Phase fuer Phase ausfuehren, STOPP-Punkte einhalten.
- **Lern-Mandat:** User will lernen — bei jeder Antwort *warum*, nicht nur *was*. Mechanismen statt nur Konsequenzen. Ungewoehnliche Code-Regeln begruenden statt einfach anwenden. Insight-Bloecke (Output-Style "Explanatory") sind Default, nicht Add-on. Anti-Pattern: terse "ok, fixed" — stattdessen "fixed via X, weil Y sonst Z waere".

## Prozess-Dokumentation

- `Softwareprozess/arc42-specification.md` — Master-Spec (Architektur, Roadmap)
- `CHANGELOG.md` — Release-Historie
- Sprint-Plan-Dokumente nach Abschluss → `Softwareprozess/history/`. Zeitlose Regeln VORHER nach CLAUDE.md oder arc42 migrieren.
