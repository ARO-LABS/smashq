# Smashq — Sprint Backlog

> **Single Source of Truth**: GitHub Issues — https://github.com/hossoOG/agentic-dashboard/issues
> **Board (cross-project)**: https://github.com/users/hossoOG/projects/4 (hovOG Global)
> **Release-Historie**: `CHANGELOG.md`
> **Langfristige Roadmap**: `Softwareprozess/arc42-specification.md`, Abschnitt 1.1 "Roadmap-Vision"
>
> Regel: **1 aktive Phase + 1 nächste Phase. Mehr nicht.** Alles weitere → Backlog (Bullets, keine Pläne).

## Aktuelle Phase

- **Per-Project Tasks — Phase 1: Fundament** (auf `master`, Merge `361a156`, 2026-06-05): headless Daten-Schicht für ein neues Aufgaben-Feature (ergänzt Notizen, ersetzt sie nicht). `tasksStore` (Modell `TaskItem`, Korruptions-Recovery in `migrate`+`onRehydrateStorage`, Mutationen, Selektoren inkl. abgeleitetes „nächste") + dedizierte `tasks.json`-Persistenz (`tasksStorage`-Adapter + Rust `load_tasks`/`save_tasks`). **Kein UI** — bewusst unsichtbar. Gates grün: 2197 vitest + Rust-Tests + tsc + build; Laufzeit-Smoke (Dev) zeigt `load_tasks` beim Boot (fresh start), keine Regression. Working-Plan `.claude/plans/per-project-tasks.md` + Design `per-project-tasks.md` (beide ephemer, untracked).
- Release-Historie der v1.6.x-Linie (AgenticExplorer, vor dem Smashq-Rebrand) → `CHANGELOG.md` + git-log; Post-Mortems in `tasks/lessons.md`.

## Nächste Phase

- [ ] **Per-Project Tasks — Phase 2: Shared Components** — `TaskRow`, `TaskDetail`, `TaskMetaChips` (+ Happy/Edge-Tests), abgeglichen gegen die Mockups in `.superpowers/brainstorm/.../content/*.html`. Konsumiert die fertigen Selektoren/Actions aus Phase 1. Danach: Phase 3 (globales `view=tasks`-Fenster + Dock-Icon in `SessionPanelDock`), Phase 4 (Per-Session: `TerminalToolbar`/`GridCellChrome`), Phase 5 (.ics-Export), Phase 6 (Politur). MCP (urspr. Plan §3/§7) bleibt zurückgestellt bis nach manueller Auslieferung.

## Backlog

- [ ] Tab-Bar-Konfiguration pro Projekt — Revival mit Code-Review-Befunden (Bloat-Reduktion, dnd-kit-Pattern-Split, ConfigPanelTabList-Refactor).
- [ ] feat(editor): Unsaved-Changes-Warnung bei Tab-Wechsel/Close/Datei-Öffnen.
- [ ] feat(editor): Projekt-Dateibrowser für `.md`-Dateien.
- [ ] feat(editor): Library-Integration (Klick auf Datei → Editor öffnet).
- [ ] feat(session): Node/Graph-basierte Session-Visualisierung — gegen Feature-Freeze prüfen.
- [ ] feat(ui): Pin-Reordering per Drag & Drop.
- [ ] feat(session): Gamification-System — gegen Feature-Freeze prüfen.

---

*Format: `- [ ] Task (#issue)`. Sobald aus dem Backlog Arbeit wird → GitHub Issue anlegen → in "Aktuelle Phase" oder "Nächste Phase" promoten. Historie liegt in `CHANGELOG.md` und git-log.*
