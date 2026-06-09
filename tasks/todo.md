# Smashq — Sprint Backlog

> **Single Source of Truth**: GitHub Issues — https://github.com/ARO-LABS/smashq/issues
> **Board (cross-project)**: https://github.com/users/hossoOG/projects/4 (hovOG Global)
> **Release-Historie**: `CHANGELOG.md`
> **Langfristige Roadmap**: `Softwareprozess/arc42-specification.md`, Abschnitt 1.1 "Roadmap-Vision"
>
> Regel: **1 aktive Phase + 1 nächste Phase. Mehr nicht.** Alles weitere → Backlog (Bullets, keine Pläne).

## Aktuelle Phase

- **v1.0.1 Wartungs-Release — komplett** (`master`, 2026-06-09): 20-Agenten-Code-Review → 97 verifizierte Findings → Tier-1- + Tier-2-Fixes (Updater-Schutzpfade), Security (`rustls-webpki`→0.103.13 behebt RUSTSEC-2026-0098/0099/0104 in der Updater-TLS-Kette; `security-audit.yml` scharf), adversariale End-Verifikation (1 Bug = uiStore-Hydration-TDZ + 2 Concerns behoben), Old-Name-Cosmetic-Cleanup (Logs/Kommentare/Test-Fixtures → „Smashq"; funktionale Persist-Keys/Git-Refs/ADP bewusst behalten). Gates grün: 2340 vitest, 70 Integration, `cargo clippy`/`cargo test`, `cargo audit` 0 Vulns, `npm run build`. Release via Tag `v1.0.1`. **Offen:** `.exe`-Smoke + Auto-Update-Verifikation durch User (lt. User grün). Details: `CHANGELOG.md` [1.0.1].
- Per-Project Tasks Phasen 1–6 (feat/tasks-ui, feat/tasks-direct-new) → gemerged in `master` (32e287e). MCP-Integration (urspr. Plan §3/§7) weiterhin zurückgestellt.
- Release-Historie der v1.6.x-Linie (AgenticExplorer, vor dem Smashq-Rebrand) → `CHANGELOG.md` + git-log; Post-Mortems in `tasks/lessons.md`.

## Nächste Phase

- [ ] **Offen** — nächstes Vorhaben planen. Kandidaten: (a) Tier-3-Refactors aus dem Review (settingsStore 1264-Z.-Split, create_session 344-Z.-Extraktion) als dedizierte, getestete Efforts; (b) `vitest` 3→4 Major-Migration (schließt die 2 Dev-Tooling-Criticals aus `npm audit`); (c) MCP-Integration für Tasks reaktivieren.

## Backlog

- [ ] refactor(store): `settingsStore.ts` (1264 Z.) in Slices/Per-Domain-Stores splitten (Review-Finding #11, behavior-preserving, Tests als Netz). Tier-3, separat geplant.
- [ ] refactor(tauri): `create_session` (344 Z.) in `spawn_reader_thread`/`spawn_waiter_thread`/`spawn_claude_id_watcher`/`build_pty` extrahieren (Review-Finding #12). Tier-3, separat geplant.
- [ ] chore(deps): `vitest`/`@vitest/coverage-v8` 3→4 (Dev-Vuln GHSA-5xrq-8626-4rwp), prüft 131 Testdateien gegen die neue Major.
- [ ] refactor(tasks): `TaskMetaChips.tsx` (~616 Z.) + `TaskDetail.tsx` (~600 Z.) unter das 300-Zeilen-Component-Limit splitten (behavior-preserving, Tests grün vorher+nachher als Netz + Re-Smoke).
- [ ] refactor(tasks): interne `deadline`-Bezeichner aufs Termin-Modell umbenennen (`DeadlineBucket`/`groupByDeadline`/`classifyDeadline`/`computeDeadlineSeverity`/`TaskDeadlineChip`/`ICONS.tasks.deadline`) — rein mechanisch, kein Verhalten.
- [ ] Tab-Bar-Konfiguration pro Projekt — Revival mit Code-Review-Befunden (Bloat-Reduktion, dnd-kit-Pattern-Split, ConfigPanelTabList-Refactor).
- [ ] feat(editor): Unsaved-Changes-Warnung bei Tab-Wechsel/Close/Datei-Öffnen.
- [ ] feat(editor): Projekt-Dateibrowser für `.md`-Dateien.
- [ ] feat(editor): Library-Integration (Klick auf Datei → Editor öffnet).
- [ ] feat(session): Node/Graph-basierte Session-Visualisierung — gegen Feature-Freeze prüfen.
- [ ] feat(ui): Pin-Reordering per Drag & Drop.
- [ ] feat(session): Gamification-System — gegen Feature-Freeze prüfen.

---

*Format: `- [ ] Task (#issue)`. Sobald aus dem Backlog Arbeit wird → GitHub Issue anlegen → in "Aktuelle Phase" oder "Nächste Phase" promoten. Historie liegt in `CHANGELOG.md` und git-log.*
