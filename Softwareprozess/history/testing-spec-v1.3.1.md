# [ARCHIVED] QA-Plan: Testing-Strategie & Enforcement (v1.3.1-Sprint)

> **Archiviert am:** 2026-04-05
> **Grund:** Alle Tickets (QA-1 bis QA-9) wurden im v1.3.1-Sprint umgesetzt und abgeschlossen.
>   Die **zeitlos relevanten** Teile dieses Dokuments sind migriert:
>   - 4-Gates-Struktur (Ticket QA-3) → `CLAUDE.md` Abschnitt "Testing & Quality Gates"
>   - Dauerhaftes QA-Ritual (Teil 4) → `CLAUDE.md` Abschnitt "Testing & Quality Gates"
> **Bleibt liegen als:** Historisches Artefakt + Referenz fuer Sprint-Planungs-Praxis.
>
> Ursprungsdaten:
> Erstellt: 2026-04-02 | Anlass: Pipeline-Rewrite ohne Tests ausgeliefert
> Status: Plan steht, Tickets muessen erstellt werden
> Tracking: GitHub Issues auf [Kanban Board](https://github.com/users/hossoOG/projects/3)

---

## Praeambel: Warum dieser Plan existiert

Am 2026-04-02 wurden 3 Phasen Pipeline-Rewrite (AgentDetector Bugfixes, 2D-Visualisierung,
ehrliches Tracking) mit 4 parallelen Agenten umgesetzt. QA bestand aus:
- `npx tsc --noEmit` (Typen kompilieren)
- `cargo check` (Rust kompiliert)
- `npm run build` (Vite baut)
- 1 Code-Quality-Review Agent (13 Issues gefunden, gefixt)

Was FEHLTE:
- Kein `npm test` / `cargo test` (bestehende Tests nicht mal gelaufen)
- Keine neuen Tests fuer 10 geaenderte Dateien
- Kein visueller Test (App nicht gestartet)
- Kein Test ob Session-Filter tatsaechlich filtert

Das verstoesst gegen 3 eigene CLAUDE.md-Regeln und wiederholt ein Muster das in
`tasks/lessons.md` bereits 4x dokumentiert ist.

---

## Teil 1: Bestandsaufnahme

### Was wir haben
| Bereich | Tests | Dateien | Coverage |
|---------|-------|---------|----------|
| Zustand Stores | 251 | 6 | Hoch (Store-Logik) |
| ADP Protokoll | 24 | 1 | Gut (Schema) |
| Rust ADP/Error | 8 | 2 | Minimal |
| Components | 0 | 0 | 0% |
| AgentDetector | 0 | 0 | 0% |
| Pipeline Adapter | 0 | 0 | 0% |
| Integration | 0 | 0 | 0% |

### Was wir brauchen (Gap)
| Bereich | Test-Cases | Risiko wenn ungetestet | Prio |
|---------|-----------|------------------------|------|
| AgentDetector (Rust) | 18 | Doppelte Agents, verlorene Events, falsches Completion | KRITISCH |
| pipelineAdapter | 14 | Falsche Session, falscher Status, Fake-Progress | HOCH |
| DashboardMap | 3 | Kaputtes Layout, kein Empty State | MITTEL |
| WorktreeNode | 4 | Falsche Farben, kaputte Progress-Bar | MITTEL |
| QAGateNode | 3 | Englische Labels, fehlende Checks | MITTEL |
| AgentMetricsPanel | 3 | Falsche Metriken pro Session | MITTEL |
| Enforcement-Infra | — | Alles wiederholt sich | KRITISCH |

---

## Teil 2: Ticket-Definitionen

> Jedes Ticket hat: Titel, Labels, Beschreibung, Akzeptanzkriterien, Abhaengigkeiten.
> Format ist bereit fuer `gh issue create`.

---

### EPIC: QA-Infrastruktur aufbauen

#### Ticket QA-1: Pre-Commit Hook installieren
**Labels**: `qa`, `infra`, `prio:critical`
**Beschreibung**:
Git Pre-Commit Hook einrichten der automatisch vor jedem Commit laeuft.
Versioniert in `.githooks/pre-commit`, aktiviert via `git config core.hooksPath .githooks`.

**Scope**:
```bash
#!/bin/bash
set -e
echo "Pre-commit checks..."
npx tsc --noEmit || { echo "TypeScript failed"; exit 1; }
npm run test || { echo "Tests failed"; exit 1; }
if git diff --cached --name-only | grep -q "src-tauri/"; then
  cd src-tauri && cargo test || { echo "Rust tests failed"; exit 1; }
fi
echo "All checks passed."
```

**Akzeptanzkriterien**:
- [ ] `.githooks/pre-commit` existiert und ist ausfuehrbar
- [ ] `git config core.hooksPath` zeigt auf `.githooks`
- [ ] Commit mit kaputtem TypeScript wird blockiert
- [ ] Commit mit failendem Test wird blockiert
- [ ] Rust-Tests laufen nur bei Aenderungen in `src-tauri/`
- [ ] CLAUDE.md dokumentiert: `git config core.hooksPath .githooks` nach Clone

**Abhaengigkeiten**: Keine

---

#### Ticket QA-2: CI Coverage Gate aktivieren
**Labels**: `qa`, `infra`, `ci`, `prio:high`
**Beschreibung**:
CI-Pipeline (`ci.yml`) aendern: `npm test` → `npm run test:coverage`.
Coverage-Schwellen in `vitest.config.ts` auf realistische Start-Werte setzen
und quartalsweise erhoehen (Ratchet-Prinzip).

**Scope**:
- `vitest.config.ts`: Schwellen auf 15% Lines / 10% Branches / 15% Functions
- `.github/workflows/ci.yml`: Test-Step auf `npm run test:coverage` aendern
- Coverage-Report als CI-Artefakt hochladen

**Akzeptanzkriterien**:
- [ ] CI laeuft `npm run test:coverage` statt `npm test`
- [ ] PR wird blockiert wenn Coverage unter Schwelle sinkt
- [ ] Coverage-Report ist als CI-Artefakt abrufbar
- [ ] Start-Schwellen sind realistisch (15/10/15) und dokumentiert

**Ziel-Trajectory** (in `vitest.config.ts` als Kommentar):
| Quartal | Lines | Branches | Functions |
|---------|-------|----------|-----------|
| Q2 2026 | 15% | 10% | 15% |
| Q3 2026 | 30% | 25% | 30% |
| Q4 2026 | 50% | 40% | 50% |

**Abhaengigkeiten**: Keine

---

#### Ticket QA-3: CLAUDE.md Testing-Abschnitt ueberarbeiten
**Labels**: `qa`, `docs`, `prio:high`
**Beschreibung**:
Bestehende Testing-Regeln in CLAUDE.md sind vage ("mindestens 1 Test").
Ersetzen durch konkretes 4-Gate-System mit checkbaren Items.

**Neuer Abschnitt**:
```markdown
## Testing & Quality Gates

### Gate 1: Pre-Commit (automatisch)
- `npx tsc --noEmit` + `npm run test` + `cargo test` (bei Rust)
- Blockiert Commit bei Failure

### Gate 2: CI (automatisch)
- `npm run test:coverage` — Schwellen muessen gehalten werden
- Coverage darf nicht sinken (Ratchet)

### Gate 3: Feature-Checkliste (vor "Done")
- [ ] 1 Happy-Path-Test
- [ ] 1 Error-Test
- [ ] 1 Edge-Case-Test
- [ ] Test-Datei im selben Commit
- [ ] Bestehende Tests gruen

### Gate 4: Tauri-Command Security
- [ ] Input validiert?
- [ ] Path Traversal geprueft?
- [ ] Shell-Injection moeglich?
- [ ] Timeout vorhanden?
- [ ] Fehler strukturiert?

### Konventionen
- Test neben Source: `foo.ts` → `foo.test.ts`
- Vitest + jsdom (Frontend), native #[test] (Rust)
- Tests nach Risiko: Persistenz > Security > UI > Store
```

**Akzeptanzkriterien**:
- [ ] CLAUDE.md hat neuen Testing-Abschnitt mit 4 Gates
- [ ] Alte vage Regeln entfernt
- [ ] Gates referenzieren Pre-Commit Hook und CI

**Abhaengigkeiten**: QA-1, QA-2 (damit Gates nicht auf Papier bleiben)

---

### EPIC: Pipeline-Rewrite Tests nachholen

#### Ticket QA-4: AgentDetector Rust Tests — Buffer & Dedup
**Labels**: `qa`, `test`, `rust`, `prio:critical`
**Beschreibung**:
Unit-Tests fuer die 3 Bug-Fixes im AgentDetector schreiben.
Datei: `src-tauri/src/session/agent_detector.rs` → `#[cfg(test)] mod tests`

**Test-Cases Buffer-Trim** (3 Tests):
1. `test_buffer_trim_adjusts_scan_position` — Feed >4000 chars, verify Position korrekt adjustiert
2. `test_buffer_trim_with_multibyte_chars` — UTF-8 an Buffer-Grenze → kein Panic
3. `test_buffer_trim_doesnt_lose_events` — Agent-Launch im Trim-Chunk → Event trotzdem erkannt

**Test-Cases Duplikat-Erkennung** (4 Tests):
4. `test_dedup_within_2_seconds` — Same name 2x in 1800ms → nur 1 Agent
5. `test_dedup_resets_after_2_seconds` — Same name nach 2100ms → neuer Agent
6. `test_dedup_empty_name_no_dedup` — Ohne Name → verschiedene Agents
7. `test_recent_launches_cleanup` — Eintraege >5s werden bereinigt

**Akzeptanzkriterien**:
- [ ] 7 Tests geschrieben und gruen
- [ ] `cargo test` im CI gruen
- [ ] Buffer-Trim-Bug kann nicht regressieren
- [ ] Duplikat-Cooldown verifiziert mit Zeitstempel-Manipulation

**Abhaengigkeiten**: Keine

---

#### Ticket QA-5: AgentDetector Rust Tests — Name-Matching & Lifecycle
**Labels**: `qa`, `test`, `rust`, `prio:critical`
**Beschreibung**:
Unit-Tests fuer Name-basiertes Completion-Matching und Agent-Lifecycle.

**Test-Cases Name-Matching** (6 Tests):
1. `test_find_by_name_exact` — "researcher" findet "researcher"
2. `test_find_by_name_partial` — "issue" findet "issue-implementer"
3. `test_find_by_name_case_insensitive` — "RESEARCHER" findet "researcher"
4. `test_find_by_name_fallback_most_recent` — Unbekannt → neuester Running
5. `test_find_by_name_ignores_completed` — Completed werden uebersprungen
6. `test_find_by_name_none_when_no_running` — Kein Running → None

**Test-Cases Completion/Lifecycle** (5 Tests):
7. `test_completion_matches_by_context` — Name im Completion-Text → richtiger Agent
8. `test_error_matches_by_context` — Name im Error-Text → richtiger Agent als error
9. `test_completion_fallback` — Unbekannter Name → most-recent
10. `test_full_lifecycle` — Launch → Worktree → Complete → Events korrekt
11. `test_pruning_max_completed` — >50 Completed → aelteste weg, Running bleibt

**Akzeptanzkriterien**:
- [ ] 11 Tests geschrieben und gruen
- [ ] Completion markiert nie den falschen Agent (bei bekanntem Namen)
- [ ] Lifecycle-Test beweist korrekte Event-Reihenfolge
- [ ] Pruning entfernt nie Running Agents

**Abhaengigkeiten**: Keine (kann parallel mit QA-4)

---

#### Ticket QA-6: pipelineAdapter Frontend Tests
**Labels**: `qa`, `test`, `frontend`, `prio:high`
**Beschreibung**:
Neue Testdatei `src/store/pipelineAdapter.test.ts` fuer Session-Filter,
Progress-Ableitung, Orchestrator-Status und Worktree-Mapping.

**Test-Cases Session-Filter** (3 Tests):
1. `filters_by_sessionId` — 2 Sessions → Filter zeigt nur eine
2. `no_filter_returns_all` — null → alle Agents
3. `empty_when_no_match` — "nonexistent" → hasAgents=false

**Test-Cases Progress** (3 Tests):
4. `running_is_50` — Status running → 50%
5. `completed_is_100` — Status completed → 100%
6. `error_is_0` — Status error → 0%

**Test-Cases Orchestrator-Status** (4 Tests):
7. `idle_when_no_agents` — Leer → idle
8. `planning_when_running` — Running vorhanden → planning
9. `generated_manifest_when_completed` — Alle completed → generated_manifest
10. `idle_when_only_errors` — Nur Errors → idle

**Test-Cases Worktree-Mapping** (4 Tests):
11. `branch_from_agent_name` — Name → Branch
12. `branch_fallback_to_id` — Name null → Agent-ID
13. `logs_include_duration` — Completed → "Abgeschlossen nach Xs"
14. `logs_include_error` — Error → "Fehler aufgetreten"

**Akzeptanzkriterien**:
- [ ] 14 Tests geschrieben und gruen
- [ ] Session-Filter bewiesen: falscher sessionId zeigt 0 Agents
- [ ] Progress-Werte sind deterministisch (keine Zeit-Abhaengigkeit mehr)
- [ ] `npm test` gruen

**Abhaengigkeiten**: Keine

---

#### Ticket QA-7: Pipeline Component Tests
**Labels**: `qa`, `test`, `frontend`, `prio:medium`
**Beschreibung**:
Component-Tests fuer die 4 Pipeline-Komponenten mit @testing-library/react.
Erste Component-Tests im gesamten Projekt — setzt Muster fuer zukuenftige.

**DashboardMap.test.tsx** (3 Tests):
1. `renders_empty_state` — Keine Agents → "Keine Agenten erkannt"
2. `renders_three_columns` — Agents → Orchestrator + Worktrees + QA Gate
3. `passes_sessionId` — Prop wird an Hook weitergeleitet

**WorktreeNode.test.tsx** (4 Tests):
4. `border_color_by_status` — active=accent, done=success, error=error
5. `progress_bar` — 75 → "75%" + width Style
6. `branch_strips_refs` — "refs/heads/fix" → "fix"
7. `done_shows_fertig` — Done-Status → "Fertig" Badge

**QAGateNode.test.tsx** (3 Tests):
8. `german_status_labels` — Bereit/Laeuft/Bestanden/Fehlgeschlagen
9. `renders_checks` — 5 Checks mit Icons
10. `idle_empty_message` — "Keine aktiven Checks"

**AgentMetricsPanel.test.tsx** (3 Tests):
11. `session_filter_metrics` — Filter → nur gefilterte gezaehlt
12. `no_filter_all` — null → alle
13. `empty_state` — Keine Agents → Hinweis

**Akzeptanzkriterien**:
- [ ] 13 Component-Tests geschrieben und gruen
- [ ] Mocking-Pattern fuer useAdaptedPipelineData dokumentiert (fuer zukuenftige Tests)
- [ ] Test-Setup fuer Component-Tests existiert (ggf. renderWithProviders Helper)
- [ ] `npm test` gruen

**Abhaengigkeiten**: Keine (aber idealerweise nach QA-6 wegen shared Mocking)

---

### EPIC: Dauerhaftes QA-Ritual

#### Ticket QA-8: Claude Code Post-Edit Hook
**Labels**: `qa`, `infra`, `dx`, `prio:medium`
**Beschreibung**:
Claude Code Hook konfigurieren der nach jedem Edit/Write automatisch
`npx tsc --noEmit` laeuft. Verhindert dass Claude Typ-Fehler einbaut
ohne es zu merken.

**Scope**: `.claude/settings.json` mit PostToolUse Hook

**Akzeptanzkriterien**:
- [ ] `.claude/settings.json` existiert mit PostToolUse Hook
- [ ] Nach Edit einer .ts/.tsx Datei laeuft automatisch tsc
- [ ] Fehler werden sichtbar im Claude Code Output
- [ ] Kein Performance-Problem (tsc < 5s)

**Abhaengigkeiten**: Keine

---

#### Ticket QA-9: Bestehende Tests stabilisieren
**Labels**: `qa`, `test`, `tech-debt`, `prio:high`
**Beschreibung**:
Bevor neue Tests geschrieben werden: sicherstellen dass alle 259
bestehenden Tests gruen sind und die Test-Infrastruktur sauber laeuft.

**Scope**:
1. `npm run test` — alle 251 Frontend-Tests ausfuehren
2. `cargo test` — alle 8 Rust-Tests ausfuehren
3. Failures fixen falls vorhanden
4. `npm run test:coverage` — Baseline Coverage messen und dokumentieren

**Akzeptanzkriterien**:
- [ ] `npm run test` → 251 Tests gruen
- [ ] `cargo test` → 8 Tests gruen
- [ ] Coverage Baseline dokumentiert in diesem Ticket
- [ ] Keine flaky Tests identifiziert

**Abhaengigkeiten**: Keine (ERSTER Ticket der umgesetzt wird)

---

## Teil 3: Sprint-Planung

### Sprint-Reihenfolge (empfohlen)

```
Woche 1: Fundament
├── QA-9  Bestehende Tests stabilisieren (Baseline)
├── QA-1  Pre-Commit Hook (30min)
├── QA-2  CI Coverage Gate (1h)
└── QA-3  CLAUDE.md Update (30min)

Woche 2: Kritische Tests nachholen
├── QA-4  AgentDetector Buffer & Dedup Tests (2h)
├── QA-5  AgentDetector Name-Matching Tests (2h)
└── QA-6  pipelineAdapter Tests (1.5h)

Woche 3: Component Tests + Ritual
├── QA-7  Pipeline Component Tests (3h)
└── QA-8  Claude Code Hook (30min)
```

### Parallelisierung

```
Parallel moeglich:
  QA-4 + QA-5  (Rust Tests, verschiedene Test-Gruppen)
  QA-6 + QA-7  (Frontend Tests, verschiedene Dateien)
  QA-1 + QA-2 + QA-3  (Infra, unabhaengig voneinander)

Sequentiell noetig:
  QA-9 → alles andere  (Baseline zuerst!)
  QA-1 → QA-3  (Hook muss existieren bevor CLAUDE.md darauf referenziert)
```

---

## Teil 4: Dauerhaftes QA-Ritual (nach Sprint)

### Bei jedem Feature/Bugfix
1. **Start**: `tasks/todo.md` Item mit Test-Checkbox erstellen
2. **Develop**: Code + Tests im selben Branch
3. **Verify**: `npm test` + `cargo test` lokal gruen
4. **Commit**: Pre-Commit Hook laeuft automatisch (Gate 1)
5. **Push**: CI laeuft Coverage Gate (Gate 2)
6. **Done**: Feature-Checkliste abgehakt (Gate 3)

### Quartalsweise
1. Coverage-Schwellen in `vitest.config.ts` erhoehen (Ratchet)
2. Test-Qualitaet reviewen: Sind die Tests aussagekraeftig oder nur Zeilen-Fueller?
3. `tasks/lessons.md` updaten: Was hat QA verhindert? Was wurde durchgelassen?

### Bei jedem Pivot/Rewrite
1. Bestehende Tests laufen lassen (Regression-Check)
2. Fuer jede geaenderte Datei: Gibt es Tests? Wenn nein → Ticket erstellen
3. QA-Infra (Hooks, CI) migrieren — nicht archivieren

---

## Teil 5: Metriken & Erfolgs-Indikatoren

| Metrik | Baseline (2026-04-02) | Ziel nach QA-Sprint | Langfrist-Ziel |
|--------|----------------------|---------------------|----------------|
| Frontend-Tests | 251 | 278 (+27) | Waechst mit Features |
| Rust-Tests | 8 | 26 (+18) | Waechst mit Features |
| Coverage Lines | 3.51% | >= 15% | >= 50% (Q4 2026) |
| Component-Tests | 0 | 13 | Jede Schluessel-Komponente |
| Enforcement-Gates | 0/4 | 4/4 | 4/4 dauerhaft |
| Regressions gefangen | unbekannt | messbar durch CI | 0 Regressions in Prod |

---

## Teil 6: Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Mitigation |
|--------|-------------------|------------|
| Pre-Commit Hook wird umgangen (`--no-verify`) | Mittel | CI als zweites Netz, CLAUDE.md verbietet `--no-verify` |
| Coverage steigt durch triviale Tests | Mittel | Quartals-Review der Test-Qualitaet |
| Component-Tests brechen bei UI-Refactors | Hoch | Testen gegen Verhalten (text, role), nicht gegen CSS-Klassen |
| Neue Entwickler kennen Hooks nicht | Niedrig | `README.md` + `git config` Hinweis in CLAUDE.md |
| Tests werden zu langsam (>30s Pre-Commit) | Mittel | Nur geaenderte Test-Suites laufen, oder `--changed` Flag |

---

## Appendix: Ticket-Uebersicht fuer `gh issue create`

| # | Titel | Labels | Prio |
|---|-------|--------|------|
| QA-1 | Pre-Commit Hook installieren | qa, infra | Critical |
| QA-2 | CI Coverage Gate aktivieren | qa, infra, ci | High |
| QA-3 | CLAUDE.md Testing-Abschnitt ueberarbeiten | qa, docs | High |
| QA-4 | AgentDetector Tests: Buffer & Dedup | qa, test, rust | Critical |
| QA-5 | AgentDetector Tests: Name-Matching & Lifecycle | qa, test, rust | Critical |
| QA-6 | pipelineAdapter Frontend Tests | qa, test, frontend | High |
| QA-7 | Pipeline Component Tests | qa, test, frontend | Medium |
| QA-8 | Claude Code Post-Edit Hook | qa, infra, dx | Medium |
| QA-9 | Bestehende Tests stabilisieren & Baseline | qa, test | High |
