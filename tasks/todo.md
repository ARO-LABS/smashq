# Smashq — Sprint Backlog

> **Single Source of Truth**: GitHub Issues — https://github.com/hossoOG/agentic-dashboard/issues
> **Board (cross-project)**: https://github.com/users/hossoOG/projects/4 (hovOG Global)
> **Release-Historie**: `CHANGELOG.md`
> **Langfristige Roadmap**: `Softwareprozess/arc42-specification.md`, Abschnitt 1.1 "Roadmap-Vision"
>
> Regel: **1 aktive Phase + 1 nächste Phase. Mehr nicht.** Alles weitere → Backlog (Bullets, keine Pläne).

## Aktuelle Phase

- **Hydration-TDZ — wirklich behoben** (Branch `fix/hydration-tdz`, `3928a30`, 2026-06-07): Root-Cause via Sourcemap-Decode des User-Stacks: zustand `persist` ruft `onRehydrateStorage` SYNCHRON in `create()` (sync `getItem`) → `useSettingsStore.setState` greift auf die noch ungebundene `const` zu → TDZ. Fix: Heal-`setState` in Microtask deferren. RED→GREEN im echten Production-Bundle (headless Chromium, localStorage-Seed) + vitest-Guard `settingsStore.hydration.test.ts`. Der frühere `vendor-zustand`-Chunk-Pin war Fehldiagnose (bleibt als Chunking-Hygiene, irreführender Guard-Test entfernt). **Offen:** `.exe`-Smoke durch User.
- **Logging/Protokoll-Overhaul — komplett** (Branch `feat/logging-overhaul`, 2026-06-07): Hydration-TDZ-Erstversuch (zustand-Chunk-Pin) — siehe Korrektur oben; Log-Viewer dynamisch virtualisiert (`measureElement`) → keine Stacktrace-Überlappung; Protokolle-Tab folgt `frontendLogging||backendFileLogging` (separates `showProtokolleTab` + `SidebarTogglesPanel` entfernt, settingsStore v8→v9); „Live" ist echtes `log-line`-Event-Streaming (Rust emittiert pro Zeile); NDJSON-Persistenz Frontend+Backend (`app-log.ndjson`, 5 MB/3-Datei-Rotation) mit zuverlässigem `onCloseRequested`-Flush; Perf-Gate-Bug gefixt (Toggle autoritativ). Via Subagent-Driven (Implementer + Diff-Verify + Final-Review). Gates grün: tsc/build/eslint, 2297 vitest, Rust clippy/fmt/3 structured_log, Updater-Guard 164. **Offen:** visuelle `.exe`-Smoke (Tab-Toggle, Überlappung weg, Live-Stream, NDJSON-Datei). Kein geschützter Updater-Pfad berührt → kein Triple-Check.
- **Tasks-Redesign (Phase A + B) — komplett** (Branch `feat/tasks-redesign`, 2026-06-07): Termin-Modell (`startsAt`/`endsAt`, Default 30 Min) statt Deadline; Sanitizer-Migration v1→2 (Legacy-`deadline`→Slot, Legacy-archivierte Tasks bewusst verworfen statt resurrecten); `.ics`-Export als echtes VEVENT mit Dauer; Von/Bis-SlotChip statt Deadline-Picker; „Archivieren"→„Löschen" mit Inline-Bestätigung (Hard-Delete); „nächste"-Label entfernt; Projekt-Zuordnungs-Sync-Fix (aktive Session immer in `availableProjects`); schwebendes Fenster per Header verschiebbar (Move-Icon raus); user-facing Gruppierungs-Label „Deadline"→„Termin". Via Subagent-Driven (Implementer + 2-Stufen-Review pro Task). Gates grün: tsc/build/eslint, 2280 vitest, 427+ Rust. **Offen:** Merge `feat/tasks-redesign`→`master` + Tauri-`.exe`-Smoke (Fenster-Header-Drag + SlotChip visuell).
- Per-Project Tasks Phasen 1–6 (feat/tasks-ui, feat/tasks-direct-new) → gemerged in `master` (32e287e). MCP-Integration (urspr. Plan §3/§7) weiterhin zurückgestellt.
- Release-Historie der v1.6.x-Linie (AgenticExplorer, vor dem Smashq-Rebrand) → `CHANGELOG.md` + git-log; Post-Mortems in `tasks/lessons.md`.

## Nächste Phase

- [ ] **Offen** — nächstes Vorhaben planen. Kandidat: MCP-Integration für Tasks (localhost-MCP-Server, Session-Auto-Config, `list_tasks`/`create_task` — Feasibility-Spike als Gate) reaktivieren, falls gewünscht.

## Backlog

- [ ] refactor(tasks): `TaskMetaChips.tsx` (~616 Z.) + `TaskDetail.tsx` (~600 Z.) unter das 300-Zeilen-Component-Limit splitten (behavior-preserving, Tests grün vorher+nachher als Netz + Re-Smoke). Vom Design-Review 2026-06-05 als Should-fix geflaggt, bewusst nach dem Feature-Merge verschoben.
- [ ] refactor(tasks): interne `deadline`-Bezeichner aufs Termin-Modell umbenennen (`DeadlineBucket`/`groupByDeadline`/`classifyDeadline`/`computeDeadlineSeverity`/`TaskDeadlineChip`/`ICONS.tasks.deadline`) — rein mechanisch, kein Verhalten. Vom Final-Review 2026-06-07 als non-blocking Folge-Commit geflaggt.
- [ ] Tab-Bar-Konfiguration pro Projekt — Revival mit Code-Review-Befunden (Bloat-Reduktion, dnd-kit-Pattern-Split, ConfigPanelTabList-Refactor).
- [ ] feat(editor): Unsaved-Changes-Warnung bei Tab-Wechsel/Close/Datei-Öffnen.
- [ ] feat(editor): Projekt-Dateibrowser für `.md`-Dateien.
- [ ] feat(editor): Library-Integration (Klick auf Datei → Editor öffnet).
- [ ] feat(session): Node/Graph-basierte Session-Visualisierung — gegen Feature-Freeze prüfen.
- [ ] feat(ui): Pin-Reordering per Drag & Drop.
- [ ] feat(session): Gamification-System — gegen Feature-Freeze prüfen.

---

*Format: `- [ ] Task (#issue)`. Sobald aus dem Backlog Arbeit wird → GitHub Issue anlegen → in "Aktuelle Phase" oder "Nächste Phase" promoten. Historie liegt in `CHANGELOG.md` und git-log.*
