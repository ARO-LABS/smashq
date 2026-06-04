# AgenticExplorer — Sprint Backlog

> **Single Source of Truth**: GitHub Issues — https://github.com/hossoOG/agentic-dashboard/issues
> **Board (cross-project)**: https://github.com/users/hossoOG/projects/4 (hovOG Global)
> **Release-Historie**: `CHANGELOG.md`
> **Langfristige Roadmap**: `Softwareprozess/arc42-specification.md`, Abschnitt 1.1 "Roadmap-Vision"
>
> Regel: **1 aktive Phase + 1 nächste Phase. Mehr nicht.** Alles weitere → Backlog (Bullets, keine Pläne).

## Aktuelle Phase

- **v1.6.36 — Update-Download-Fortschritt** (released 2026-06-02): Fortschritts-Toast (Balken + %) zwischen „Installieren" und „Update bereit". `useAutoUpdate` lieferte `status:"downloading"`+`progress` schon — nur der Toast-Treiber in `SessionPanelDock` behandelte den Fall nicht. Toast-System erweitert (`progress`-Feld, `updateToast`, `addToast`→id). Geplant via superpowers (brainstorm→spec→plan→execute), geschützter Updater-Pfad, Triple-Check grün. Smoke konstruktionsbedingt erst beim übernächsten Update sichtbar.
- **v1.6.35 — Favoriten-Persistenz (wirklich)** (released 2026-06-02): v1.6.34 behob es NICHT. Echte Ursache: der `favorites.json`-Schreibpfad (`hasHydrated()`-gegatete `store.subscribe`) feuerte im Prod-Build nie → `favorites.json` existierte nie, Favoriten/Gruppen beim Neustart leer. Fix: Favoriten/Gruppen zurueck in `partialize`→`settings.json` (bewaehrter Persist-Middleware-Writer), separate `favorites.json` + Subscription entfernt, Schema v6→v7 (Legacy-favorites.json einmalig uebernommen). Tests fahren jetzt den ECHTEN Pfad (partialize→localStorage). v1.6.34 behob es NICHT. Echte Ursache: der `favorites.json`-Schreibpfad (`hasHydrated()`-gegatete `store.subscribe`) feuerte im Prod-Build nie → `favorites.json` existierte nie, Favoriten/Gruppen beim Neustart leer. Fix: Favoriten/Gruppen zurueck in `partialize`→`settings.json` (bewaehrter Persist-Middleware-Writer), separate `favorites.json` + Subscription entfernt, Schema v6→v7 (Legacy-favorites.json einmalig uebernommen). Tests fahren jetzt den ECHTEN Pfad (partialize→localStorage). **Vor Release: Smoke im lokal gebauten .exe (Favorit+Gruppe anlegen → Neustart → noch da?), nicht blind an Updater pushen.**
- **v1.6.34 — Favoriten-Persistenz (Migrations-Loch)** (released 2026-06-02): zielte auf die v5→v6-Migration; behob den eigentlichen Schreibpfad-Bug nicht. Von v1.6.35 abgeloest.
- **v1.6.33 — Bottom-Dock + Detached Windows + Theme-Sync** (released 2026-06-02): SideNav-Rail entfernt → `SessionPanelDock` am Panel-Fuss; Hauptfenster ist immer Sitzungen, Kanban/Bibliothek/Editor/Einstellungen oeffnen als eigene Fenster; Theme-Sync ueber alle Fenster; `uiStore.activeTab` entfernt. Keyboard-Input-Known-Issue (v1.6.31/32) per Prod-Smoke verifiziert.
- **Code-Review-getriebenes Refactoring** (Report: `.claude/plans/code-review-refactoring.md` — v2, frischer Backlog auf dem post-Refactor-Code, Fortschritt-Block dort führend). Erledigt + auf `master`, alle Gates grün (`cargo test` 410+integration, `clippy --all-targets`, `vitest` 112 unit + 8 integration, `tsc`, `build`, Coverage 90%): **Welle 1** Dead-Code (~4350 Z.); **Stufe 2-4** (`file_reader.rs`→Submodule, `setLayoutMode`→Pure-Helper, `discoverGlobal`→per-concern+Concurrency, `get_project_board`→`fetch_board_page`, github `ensure_gh`/`run_json_array`/Parse-Free-Functions+11 Tests, Magic-Konstanten/Return-Typen); **2. Dead-Code-Welle** (Retry-Cluster, write-only `sessionHistoryStore`, `formatExit`); **mechanische Splits** (`diff.rs` git_in, `NotesPanel`→notes/, `LibraryView`→library/*, `useSessionEvents`→`claudeIdDiscovery`-Factory). ~18 Commits, gehen mit diesem Stand nach `origin/master`.
- **Offen / bewusst zurückgehalten** (brauchen manuellen Smoke / Produkt-Entscheidung / Major-Release): `create_session`-PTY-Split (Spawn/Output/Exit-Smoke), `settingsStore`-Domänen-Split (Major, Issue-#209-Persist-Migration), `uiStore.detailPanel`-Entfernung (geschützter Updater-Pfad → .exe-Smoke), `ADPError.details` (IPC-Contract), Library-M2/M4-Placeholder (Produkt), KanbanBoard-DnD (Stale-Closure-Risiko). Details im Report v2.
- Arbeitsweise: **direkt auf `master`** (Solo, keine Feature-Branches).

## Nächste Phase

- [ ] Offen — naechstes Vorhaben planen. (Keyboard-input-dead ist mit v1.6.33 per Prod-Smoke als behoben verifiziert; bei Regression zuerst den prod-gated Auto-Restore-Pfad `useSessionRestore.ts` + `sessionRestoreSync` pruefen.)

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
