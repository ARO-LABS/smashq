# [ARCHIVED] Phase 2: Planung — Agentic Dashboard

> **ARCHIVED (2026-03-25):** Dieses Dokument beschreibt die urspruengliche 8-Wochen-Sprint-Roadmap
> fuer die Pipeline-Visualisierung. Der Sprint-Plan wurde nach dem Pivot zum Session Manager
> nie ausgefuehrt. Aktuelle Planung steht in `Phase.txt`. Bleibt als historische Referenz.

**Datum:** 2026-03-15
**Phase:** 2 (Planung) aus `Phase.txt`
**Status:** Abgeschlossen (archiviert nach Pivot)
**Methode:** 10 Spezialisten-Agenten parallel (Sprint Planner, System Architect, Rust Backend, Frontend Components, Critical Path, DevOps, State Modeler, API Integration, ADP Migration, QA Strategy)

---

## Inhaltsverzeichnis

1. [Sprint-Roadmap (8 Wochen)](#1-sprint-roadmap)
2. [Systemarchitektur](#2-systemarchitektur)
3. [Backend-Module (Rust)](#3-backend-module)
4. [Frontend-Komponenten (React)](#4-frontend-komponenten)
5. [State-Management (Zustand Stores)](#5-state-management)
6. [ADP-Migrationsplan](#6-adp-migrationsplan)
7. [API-Integrationen](#7-api-integrationen)
8. [CI/CD-Pipeline](#8-cicd-pipeline)
9. [Testing-Strategie](#9-testing-strategie)
10. [Kritischer Pfad & Risiken](#10-kritischer-pfad--risiken)

---

## 1. Sprint-Roadmap

### Uebersicht (8 Wochen, 1-Entwickler + AI)

| Sprint | KW | Phase | Fokus | Meilenstein |
|--------|-----|-------|-------|-------------|
| **Sprint 1** | 12 | Phase 1 | ADP-Protokoll Grundlage | — |
| **Sprint 2** | 13 | Phase 1 | Echtzeit-Agenten-Status | — |
| **Sprint 3** | 14 | Phase 1 | Log-Panel + Metriken + UX | — |
| **Sprint 4** | 15 | Phase 1 | Windows-Installer + Performance | **M1: MVP Pipeline Monitoring** |
| **Sprint 5** | 16 | Phase 2 | Terminal-Backend (PTY + Rust) | — |
| **Sprint 6** | 17 | Phase 2 | Terminal-Frontend (xterm.js) | — |
| **Sprint 7** | 18 | Phase 2 | API-Key-Verwaltung + Keychain | — |
| **Sprint 8** | 19 | Phase 2 | Agent-Details + QA-Gate + Retry | **M2: Terminal & Security** |

### Sprint-Details

**Sprint 1 — ADP-Protokoll (KW 12)**
- T1.1: ADP-Schema finalisieren, Rust-Structs spiegeln (S, 1d)
- T1.2: Rust Event-Emitter umbauen — `LogEvent` → `ADPEnvelope` (M, 2d)
- T1.3: Frontend-Listener migrieren — ADP-Parser + Regex-Fallback (M, 2d)
- T1.4: Mock-Pipeline auf ADP-Events umstellen (S, 1d)
- **DoD:** Mock-Pipeline laeuft mit ADP-Events, alter Parser als Fallback

**Sprint 2 — Echtzeit-Status (KW 13)**
- T2.1: Store erweitern — Timing, Token, Error-Tracking (M, 2d)
- T2.2: WorktreeNode Redesign — Status-Farben, Pulse-Animation (M, 2d)
- T2.3: OrchestratorNode — Gesamt-Aggregation (S, 1d)
- T2.4: Performance-Baseline bei 10+ Agenten (S, 0.5d)
- **DoD:** 10 simulierte Agenten, Status-Update < 500ms, > 30fps

**Sprint 3 — Log-Panel + Metriken + UX (KW 14)**
- T3.1: LogPanel.tsx — Expandable, Filter, Auto-Scroll (M, 2d)
- T3.2: MetricsBar.tsx — Dauer, Token-Count, Kosten (M, 2d)
- T3.3: Status-Transitions — Partikel bei Success, Shake bei Error (S, 1d)
- **DoD:** Log-Drill-Down, Metriken sichtbar, Animationen verifiziert

**Sprint 4 — Windows + Performance (KW 15) → M1**
- T4.1: Tauri-Build — NSIS-Installer, App-Icon, Bundle (M, 2d)
- T4.2: Shell-Detection — OS-spezifisch (S, 1d)
- T4.3: Performance — Lazy Loading, Bundle-Splitting, RAM-Profiling (M, 2d)
- T4.4: CSP aktivieren in `tauri.conf.json` (S, 0.5d)
- **DoD:** Windows-Installer, Start < 2s, RAM < 150MB, CSP aktiv

**Sprint 5 — Terminal Backend (KW 16)**
- T5.1: `portable-pty` + `TerminalManager` Struct (M, 2d)
- T5.2: Tauri Commands — spawn/write/resize/close (M, 2d)
- T5.3: PTY-Output als ADP `terminal.output` Events (M, 2d)
- **DoD:** PowerShell-Session via Tauri Command, I/O Roundtrip

**Sprint 6 — Terminal Frontend (KW 17)**
- T6.1: xterm.js + `TerminalInstance.tsx` (M, 2d)
- T6.2: `terminalStore.ts` — Sessions, Tabs (S, 1d)
- T6.3: Tab-UI — Add/Close, Split-View (M, 2d)
- **DoD:** ANSI-Farben, Ctrl+C, 3+ Tabs gleichzeitig

**Sprint 7 — API-Key-Management (KW 18)**
- T7.1: `keyring` Crate + Tauri Commands (M, 2d)
- T7.2: SettingsPage + ApiKeyManager.tsx (M, 2d)
- T7.3: Connection-Test pro Key (S, 1d)
- T7.4: Log-Redacting fuer Secrets (S, 0.5d)
- **DoD:** Key CRUD, verschluesselt im Keychain, keine Leaks

**Sprint 8 — Details + QA + Retry (KW 19) → M2**
- T8.1: Agent-Avatare — SVG, Hash-basiert (S, 1d)
- T8.2: Agent-Detail-Panel — Slide-In, Logs, Metriken (M, 2d)
- T8.3: QA-Gate Fehler-Detail + Copy-to-Clipboard (S, 1d)
- T8.4: Retry-Mechanismus — Error-Banner + Retry-Button (S, 1d)
- **DoD:** Avatare, Detail-Panel, QA-Output, Retry funktional

---

## 2. Systemarchitektur

### Ziel-Verzeichnisstruktur

```
src/
├── shared/                    # ═══ SHARED KERNEL ═══
│   ├── protocols/             # ADP Schema, Dispatcher, Validator
│   ├── hooks/                 # useTauriEvent, useADPDispatch
│   ├── components/            # ErrorBoundary, Panel, StatusBadge
│   └── utils/                 # format.ts, constants.ts
│
├── features/                  # ═══ FEATURE-MODULE ═══
│   ├── pipeline/              # Bestehend + erweitert (Persona H Kern)
│   │   ├── store/             # pipelineStore, selectors, mockPipeline
│   │   ├── hooks/             # usePipelineEvents, useWorktreeMetrics
│   │   ├── components/        # DashboardMap, Nodes, LogPanel, Timeline
│   │   └── legacy/            # logParser.ts (Sunset nach ADP)
│   ├── terminal/              # NEU (Persona H)
│   │   ├── store/             # terminalStore
│   │   └── components/        # TerminalPanel, TerminalTab, xterm.js
│   ├── hub/                   # NEU (Persona C)
│   │   ├── store/             # hubStore, serviceRegistry
│   │   ├── components/        # ChatPanel, WidgetGrid, GitHub/Cost-Widget
│   │   └── adapters/          # githubAdapter, calendarAdapter, aiAdapter
│   ├── security/              # NEU (beide Personas)
│   │   ├── store/             # credentialStore, costStore
│   │   └── components/        # ApiKeyManager, CostDashboard
│   └── settings/              # NEU
│       ├── store/             # settingsStore (persistiert)
│       └── components/        # SettingsPage
│
└── layout/                    # ═══ LAYOUT-SHELL ═══
    ├── AppLayout.tsx           # Sidebar + Main + BottomPanel
    ├── Sidebar.tsx             # Navigation (VS Code Activity Bar)
    └── Header.tsx              # Erweitert mit Notifications

src-tauri/src/
├── lib.rs                     # Tauri Setup + Plugin-Registrierung
├── error.rs                   # ADPError (zentraler Fehlertyp)
├── adp/                       # ADP-Emitter, Envelope, Events
├── pipeline/                  # start/stop_pipeline (migriert)
├── terminal/                  # TerminalManager (portable-pty)
├── credentials/               # CredentialStore (keyring)
├── services/                  # ServiceRouter + Adapter-Trait
│   └── adapters/              # GitHub, HTTP-Proxy
└── security/                  # Stronghold, Keychain, Redactor
```

### Architektur-Prinzipien

1. **ADP als einziger Kommunikationskanal** — Frontend empfaengt nur `adp-event`, nie rohe Strings
2. **Feature-Module sind isoliert** — kommunizieren nur ueber ADP Events, nie direkte Imports
3. **Secrets bleiben im Rust-Backend** — Frontend kennt nur Metadata und Token-IDs
4. **Log-Parsing wandert ins Backend** — Frontend empfaengt typisierte Events
5. **Lazy Loading nach Persona** — Pipeline eager (Henrik), Hub lazy (Clara)

### Komponenten-Diagramm

```
┌──────────── FRONTEND (React/TypeScript) ────────────┐
│ ┌────────┐ ┌──────────────────────────────────────┐ │
│ │Sidebar │ │ Feature Views (Lazy Loaded)           │ │
│ │Pipeline│─│ PipelineView │ HubView │ SettingsView │ │
│ │Hub     │ └──────────────┬───────────────────────┘ │
│ │Terminal│                │                          │
│ │Settings│ ┌──────────────┴───────────────────────┐ │
│ └────────┘ │ Bottom Panel: Terminal / LogPanel     │ │
│            └──────────────────────────────────────┘ │
│ ┌─── SHARED KERNEL ───┐  ┌── FEATURE STORES ─────┐ │
│ │ ADP Dispatcher       │  │ pipeline │ terminal   │ │
│ │ Zod Validator        │  │ service  │ settings   │ │
│ │ Shared Components    │  │ credential │ cost     │ │
│ └──────────┬───────────┘  └──────────────────────┘ │
└────────────┼────────────────────────────────────────┘
             │ Tauri IPC (invoke + listen "adp-event")
┌────────────┼────────────────────────────────────────┐
│ BACKEND    │ (Rust/Tauri v2)                        │
│ ┌──────────┴──────────┐  ┌───────────────────────┐ │
│ │ ADP Emitter+Parser  │  │ Commands per Feature  │ │
│ └─────────────────────┘  │ pipeline │ terminal   │ │
│ ┌─────────────────────┐  │ credentials │ services│ │
│ │ Managed State       │  └───────────────────────┘ │
│ │ TerminalManager     │                            │
│ │ CredentialStore     │  ┌───────────────────────┐ │
│ │ ServiceRouter       │  │ Security Layer        │ │
│ └─────────────────────┘  │ Keychain │ Redactor   │ │
│                          └───────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 3. Backend-Module

### Neue Cargo Dependencies

```toml
# Must-Have
portable-pty = "0.8"          # PTY-Sessions
keyring = "3"                 # OS Keychain
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
async-trait = "0.1"           # ServiceAdapter Trait
tokio = { version = "1", features = ["sync", "rt"] }
tauri-plugin-store = "2"      # Persistente Settings

# Spaeter (Phase 3+)
# reqwest = { version = "0.12", features = ["json"] }
# oauth2 = "5"
```

### Modul-Uebersicht

| Modul | Dateien | Verantwortung |
|-------|---------|---------------|
| `adp/` | envelope.rs, emitter.rs, events.rs | ADPEnvelope Struct, typisiertes Emit |
| `terminal/` | manager.rs, commands.rs | PTY spawn/write/resize/close |
| `credentials/` | store.rs, commands.rs | OS Keychain CRUD, `pub(crate) get_secret` |
| `services/` | router.rs, adapter.rs, adapters/ | ServiceAdapter Trait, async routing |
| `pipeline/` | commands.rs | Migrierte start/stop_pipeline |

### Sicherheitsarchitektur

- `CredentialStore::get_secret()` ist `pub(crate)` — kein Tauri Command exponiert Secrets
- Secrets fliessen nur Rust-intern: Keychain → ServiceRouter → HTTP-Header
- Log-Redacting: `sk-...`, `ghp_...`, `Bearer ...` werden maskiert
- CSP in `tauri.conf.json` mit Whitelist fuer API-Endpunkte

---

## 4. Frontend-Komponenten

### Neue Komponenten (22 Dateien)

| Gruppe | Komponenten | Beschreibung |
|--------|-------------|--------------|
| **Layout** | AppShell, SideNav | Tab-Navigation (VS Code Style) |
| **Pipeline** | LogDetailPanel, TimelineView, ErrorAlert, StatusSummary | Drill-Down, Gantt, Alerts |
| **Terminal** | TerminalPanel, TerminalTab, TerminalToolbar, TerminalInstance | xterm.js Integration |
| **Hub** | HubView, ChatPanel, ChatMessage, WidgetGrid, GitHubWidget, CostWidget, ServiceConnector | AI-Hub (Persona C) |
| **Settings** | SettingsPage, APIKeyManager, OAuthConnector | Konfiguration |
| **UX** | AgentAvatar, AchievementToast, StatusTransition | Gamification |

### Erweiterte Komponenten (7 Dateien)

- `App.tsx` — Delegiert an AppShell, ADP-Listener
- `Header.tsx` — Notification-Badge, Tab-Breadcrumb
- `WorktreeNode.tsx` — AgentAvatar, onClick Detail-Panel, StatusTransition
- `OrchestratorNode.tsx` — AgentAvatar, Click-Handler
- `QAGateNode.tsx` — Click-Handler fuer Detail-Output
- `DashboardMap.tsx` → wird `PipelineView.tsx`

### Routing: Tab-basiert (kein React Router)

Desktop-App braucht kein URL-Routing. Tabs mit persistentem State pro View:
- Pipeline (eager) | Terminal (eager, xterm.js lazy) | Hub (lazy) | Settings (lazy)

---

## 5. State-Management

### Store-Architektur (4 neue Stores)

| Store | Zweck | Persistiert? |
|-------|-------|-------------|
| `pipelineStore.ts` | Erweitert: Timing, Errors, Manifest, Tokens | Nein (ephemer) |
| `terminalStore.ts` | Sessions, Tabs, Output-Buffer | Nein |
| `serviceStore.ts` | Adapter, Credentials-Metadata, Kosten, Queue | Teilweise |
| `settingsStore.ts` | Theme, Sound, Notifications, API-Key-Metadata | Ja (zustand/persist) |

### Kern-Erweiterungen pipelineStore

```typescript
// Neue Felder in Worktree:
spawnedAt: number;
stepTimings: StepTiming[];        // Chronologisch
currentStepStartedAt?: number;    // Fuer Live-Timer
tokenUsage: TokenUsage;           // Input/Output/Cost
lastError?: ADPError;
retryCount: number;

// Neue Felder in PipelineState:
pipelineStartedAt: number | null;
manifest: SpawnManifest | null;
errors: PipelineError[];
totalTokenUsage: TokenUsage;
mode: "real" | "mock";
```

### Selektoren-Strategie (Performance)

```typescript
// Ebene 1: Zustand Selektor (verhindert unnoetige Re-Renders)
const worktree = usePipelineStore(selectWorktreeById("wt-1"));

// Ebene 2: shallow-Vergleich fuer abgeleitete Objekte
const { activeCount, errorCount } = usePipelineStore(selector, shallow);

// Ebene 3: subscribeWithSelector fuer Nicht-React (Sound, Notifications)
usePipelineStore.subscribe(
  (state) => state.qaGate.overallStatus,
  (status) => { if (status === "fail") playErrorSound(); },
);
```

---

## 6. ADP-Migrationsplan

### 5 Schritte (Feature-Flag-gesteuert, jeder einzeln deploybar)

| Schritt | Beschreibung | Risiko | Dateien |
|---------|-------------|--------|---------|
| **1** | Adapter-Schicht: Legacy-ParsedEvent → ADP-Envelope | Gering | `adpAdapter.ts` (neu) |
| **2** | Mock-Pipeline auf ADP umstellen | Mittel | `mockPipelineADP.ts` (neu) |
| **3** | Rust Backend: Dual-Write (`pipeline-log` + `adp-event`) | Mittel | `lib.rs` + `uuid`/`chrono` Deps |
| **4** | Frontend-Dispatcher: `adp-event` Listener + Store-Mapping | Mittel-Hoch | `adpDispatcher.ts` (neu), `App.tsx` |
| **5** | Legacy-Cleanup: Flag auf `true`, dann Parser entfernen | Hoch | `logParser.ts` (entfernen) |

**Invariante:** `USE_ADP_PIPELINE` Feature-Flag steuert welcher Pfad aktiv ist. Default: `false`. Nach jedem Schritt: `npx tsc --noEmit && npm run build` als Gate.

---

## 7. API-Integrationen

### Service-Uebersicht

| Service | Auth | Phase | Aufwand | Risiko |
|---------|------|-------|---------|--------|
| **GitHub** | PAT / OAuth PKCE | Phase 3 | 3-5 Tage | Niedrig |
| **Anthropic Claude** | API-Key | Phase 3 | 3-4 Tage | Niedrig |
| **OpenAI (Chat + DALL-E)** | API-Key | Phase 3 | 3-4 Tage | Niedrig |
| **Google Calendar** | OAuth 2.0 PKCE | Phase 4 | 5-7 Tage | Mittel |
| **Midjourney** | — | **Nicht empfohlen** | — | **BLOCKER** (keine API) |

### Kosten-Tracking

- **Primaere Datenquelle:** `usage`-Feld in jeder AI-Response (input_tokens, output_tokens)
- **Preistabelle:** Konfigurierbar im Settings-Store (Preise aendern sich)
- **Speicherung:** `tauri-plugin-store`, rollierend (letzte 90 Tage)
- **Budget-Alerts:** User Story SEC-05, konfigurierbar pro Service/Zeitraum

### Caching-Strategie

| Service | Strategie | Cache-Dauer |
|---------|-----------|-------------|
| GitHub Issues/PRs | ETag-basiert + Polling 60s | 2 Min |
| GitHub Repos | ETag | 5 Min |
| Google Calendar | Sync-Token (Delta-Sync) | 2 Min |
| AI Chat-Responses | Kein Caching | — |
| DALL-E Bilder | Sofort lokal speichern (URL temporaer!) | Permanent |

---

## 8. CI/CD-Pipeline

### GitHub Actions Workflows

| Workflow | Trigger | Jobs |
|----------|---------|------|
| **CI** (`ci.yml`) | PR + Push auf master | Frontend (tsc + ESLint + Prettier), Rust (check + clippy + fmt), Build-Verification (Win + Mac), Tests |
| **Release** (`release.yml`) | Git-Tags `v*.*.*` | Changelog (git-cliff), Windows NSIS, macOS DMG (Intel + ARM), GitHub Release |
| **Nightly** (`nightly.yml`) | Taeglich 03:00 UTC | Windows + macOS ARM Build (nur wenn Commits) |

### Code Quality Tools (einzurichten)

| Tool | Zweck | Aufwand |
|------|-------|---------|
| ESLint (Flat Config) | Frontend Linting | 0.5 Tage |
| Prettier + Tailwind-Plugin | Formatierung | 0.5 Tage |
| Clippy + rustfmt | Rust Linting | 0.5 Tage |
| Husky + lint-staged | Pre-Commit Hooks | 0.5 Tage |

### Release-Prozess

- Semantic Versioning synced: `package.json` + `Cargo.toml` + `tauri.conf.json`
- Changelog via `git-cliff` (Conventional Commits)
- Auto-Updater via `tauri-plugin-updater` (signierter Key)

---

## 9. Testing-Strategie

### Testing-Pyramide (aktuell: 0 Tests)

```
        ┌─── E2E ───┐    ~10% (3-5 Tests, Playwright)
        ├─Integration┤    ~30% (15-25 Tests, Vitest + Rust)
        └── Unit ────┘    ~60% (40-60 Tests, Vitest + #[test])
```

### Einfuehrungsreihenfolge

1. **Vitest + Config** (1 Tag) — `vitest.config.ts`, Setup, npm Scripts
2. **`schema.test.ts`** (0.5 Tage) — `createADPMessage`, `isIdempotent`, `calculateRetryDelay`
3. **`pipelineStore.test.ts`** (1 Tag) — Alle Actions, Limits, Reset
4. **`logParser.test.ts`** (1.5 Tage) — Alle Regex, Context-Tracking, Edge Cases
5. **Rust `#[cfg(test)]`** (1 Tag) — LogEvent-Serialisierung, PipelineState
6. **CI-Pipeline** (0.5 Tage) — GitHub Actions Workflow

### Quality Gates fuer PRs

- `npx tsc --noEmit` — blockierend
- `npm run test` — blockierend
- `npm run build` — blockierend
- `cargo check && cargo test && cargo clippy -D warnings` — blockierend
- Coverage >= 60% (Phase 1), 75% (Phase 2), 80% (Phase 3)
- Neue Logik hat mindestens 1 Test

### Coverage-Ziele (kritische Pfade)

| Modul | Ziel |
|-------|------|
| `logParser.ts` | 90%+ |
| `schema.ts` | 95%+ |
| `pipelineStore.ts` | 85%+ |
| Restliche Stores | 60%+ |

---

## 10. Kritischer Pfad & Risiken

### Kritischer Pfad (MVP, Phase 1)

```
PROTO-01 (5d) → PV-01 (7d) → PV-02+PV-03 (7d) → CP-01+UX-01 (5d)
= ~24 Arbeitstage (5 Wochen mit Puffer)
```

### 6 unabhaengige Cluster (parallelisierbar)

```
A: Pipeline    PROTO-01 → PV-01 → PV-02/03 → PV-04/05/06/07
B: Terminal    TI-01 → TI-02/03 → TI-04/05
C: Security    SEC-03 → SEC-01 → SEC-02/04/05/06
D: AI-Hub      HUB-01/02/06/07 → HUB-03/04/05/08
E: Platform    CP-01/02/03 → CP-04/05
F: UX          UX-01 → UX-02/03/04/05/06
```

### Merge-Konflikte-Risiken

| Datei | Risiko | Mitigation |
|-------|--------|------------|
| `pipelineStore.ts` | **HOCH** | Store-Slices klar aufteilen |
| `lib.rs` | **HOCH** | `mod commands` strikt nach Feature trennen |
| `App.tsx` | MITTEL | Event-Handling in Module extrahieren |
| `package.json` | MITTEL | Dependencies nur im Haupt-Branch |

### Top-Risiken

| Risiko | Schwere | Mitigation |
|--------|---------|------------|
| **ConPTY auf Windows** (Sprint 5) | Hoch | `portable-pty` abstrahiert, +1 Tag Puffer |
| **ADP-Migration bricht Mock** (Sprint 1) | Hoch | Feature-Flag, Regex-Fallback behalten |
| **Scope Creep** (Hub fuer alles) | Mittel | Plugin-Architektur, klare Phasen |
| **OAuth-Flows manuell** (Phase 4) | Mittel | PKCE + Device Flow Standards |
| **Midjourney** | Blocker | DALL-E 3 als Alternative |

### Risiko-Puffer

- Phase 1: +3 Tage nach PROTO-01
- Phase 2: +5 Tage fuer Terminal (PTY-Risiko)
- Phase 3: +3 Tage fuer OAuth

---

## Anhang: Detaillierte Planungsdokumente

Die 10 Spezialisten-Agenten haben folgende Detailanalysen erstellt (verfuegbar als Agent-Outputs):

| Agent | Inhalt |
|-------|--------|
| Sprint Planner | 8 Sprints mit Tasks, Story Points, DoD, Abhaengigkeiten |
| System Architect | Ziel-Verzeichnisstruktur, Modul-Grenzen, Datenfluesse |
| Rust Backend Architect | Structs, Traits, Commands, Thread-Safety, Cargo Dependencies |
| Frontend Component Architect | 22 Komponenten mit Props-Interfaces, Stores, Routing |
| Critical Path Analyst | Abhaengigkeitsmatrix, Gantt-Diagramm, Parallelisierung |
| DevOps Planner | 3 GitHub Actions YAML, ESLint/Prettier Config, Release-Prozess |
| State/Data Modeler | 4 Zustand-Stores mit TypeScript-Interfaces, Selektoren |
| API Integration Planner | 5 Services mit Endpoints, Auth, Rate-Limits, Caching |
| ADP Migration Strategist | 5-Schritt-Plan mit konkretem Code, Feature-Flags |
| QA & Testing Planner | Testing-Pyramide, 37 Testfaelle, Vitest-Config, Quality Gates |

## Erstellte Artefakte

| Datei | Beschreibung |
|-------|-------------|
| `Softwareprozess/Planung.md` | Dieses Dokument |
| `Softwareprozess/Anforderungsanalyse.md` | Phase 1 Ergebnisse (40 User Stories) |
| `Softwareprozess/Protokoll-Design.md` | ADP v1.0.0 Dokumentation |
| `src/protocols/schema.ts` | ADP TypeScript-Schema (23 Event-Typen) |
