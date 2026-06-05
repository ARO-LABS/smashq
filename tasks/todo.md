# Smashq — Sprint Backlog

> **Single Source of Truth**: GitHub Issues — https://github.com/hossoOG/agentic-dashboard/issues
> **Board (cross-project)**: https://github.com/users/hossoOG/projects/4 (hovOG Global)
> **Release-Historie**: `CHANGELOG.md`
> **Langfristige Roadmap**: `Softwareprozess/arc42-specification.md`, Abschnitt 1.1 "Roadmap-Vision"
>
> Regel: **1 aktive Phase + 1 nächste Phase. Mehr nicht.** Alles weitere → Backlog (Bullets, keine Pläne).

## Aktuelle Phase

- **Per-Project Tasks — Feature komplett (Phasen 1–6)** (Branch `feat/tasks-ui`, 2026-06-05): Aufgaben-Feature, das Notizen ergänzt. Phase 1 Fundament (`tasksStore` + dedizierte `tasks.json`-Persistenz, Heilung im `merge`-Pfad nach TDZ-Fix); Phase 2 Shared Components (`TaskRow`/`TaskDetail`/`TaskMetaChips`/`StatusDot`/`TaskDeadlineChip`/`useTasksContext`/`taskGrouping`); Phase 3 globales Layout-B-Fenster (`view=tasks` + Dock-Icon); Phase 4 Per-Session (schwebendes `TasksWindow` + `TaskGridTile` + Toolbar/Cell-Integration); Phase 5 `.ics`-Export (Rust `export_task_ics` + In-Kalender-Buttons). Gebaut via Workflow-Orchestrierung (Fan-out + Gate pro Phase), Browser-Smoke je UI-Phase. Gates grün: tsc/build/eslint, ~2250 vitest, 428 Rust-Tests inkl. 18 ics_export. MCP (urspr. Plan §3/§7) bleibt zurückgestellt. **Offen:** Merge `feat/tasks-ui`→`master` + finaler Tauri-`.exe`-Smoke der Per-Session-Flächen (Browser kann keine PTY-Session spawnen).
- Release-Historie der v1.6.x-Linie (AgenticExplorer, vor dem Smashq-Rebrand) → `CHANGELOG.md` + git-log; Post-Mortems in `tasks/lessons.md`.

## Nächste Phase

- [ ] **Offen** — nächstes Vorhaben planen. Kandidat: MCP-Integration für Tasks (localhost-MCP-Server, Session-Auto-Config, `list_tasks`/`create_task` — Feasibility-Spike als Gate) reaktivieren, falls gewünscht.

## Backlog

- [ ] refactor(tasks): `TaskMetaChips.tsx` (679 Z.) + `TaskDetail.tsx` (531 Z.) unter das 300-Zeilen-Component-Limit splitten (behavior-preserving, Tests grün vorher+nachher als Netz + Re-Smoke). Vom Design-Review 2026-06-05 als Should-fix geflaggt, bewusst nach dem Feature-Merge verschoben.
- [ ] Tab-Bar-Konfiguration pro Projekt — Revival mit Code-Review-Befunden (Bloat-Reduktion, dnd-kit-Pattern-Split, ConfigPanelTabList-Refactor).
- [ ] feat(editor): Unsaved-Changes-Warnung bei Tab-Wechsel/Close/Datei-Öffnen.
- [ ] feat(editor): Projekt-Dateibrowser für `.md`-Dateien.
- [ ] feat(editor): Library-Integration (Klick auf Datei → Editor öffnet).
- [ ] feat(session): Node/Graph-basierte Session-Visualisierung — gegen Feature-Freeze prüfen.
- [ ] feat(ui): Pin-Reordering per Drag & Drop.
- [ ] feat(session): Gamification-System — gegen Feature-Freeze prüfen.

---

*Format: `- [ ] Task (#issue)`. Sobald aus dem Backlog Arbeit wird → GitHub Issue anlegen → in "Aktuelle Phase" oder "Nächste Phase" promoten. Historie liegt in `CHANGELOG.md` und git-log.*
