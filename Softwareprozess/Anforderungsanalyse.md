# [ARCHIVED] Anforderungsanalyse — Agentic Dashboard

> **ARCHIVED (2026-03-25):** Dieses Dokument beschreibt die urspruengliche Anforderungsanalyse
> fuer die isometrische Pipeline-Visualisierung. Nach dem Pivot zum Session Manager (2026-03-16)
> sind die meisten User Stories hier NICHT mehr aktuell. Aktuelle Stories stehen in `Phase.txt`.
> Dieses Dokument bleibt als historische Referenz erhalten.

**Datum:** 2026-03-15
**Phase:** 1 (Anforderungsanalyse) aus `Phase.txt`
**Status:** Abgeschlossen (archiviert nach Pivot)
**Methode:** 10 Spezialisten-Agenten parallel (Persona-Analyse, Pipeline-Viz, Terminal, Security, Cross-Platform, AI-Hub, Protokoll, UX/Gamification, Machbarkeit)

---

## Inhaltsverzeichnis

1. [Personas](#1-personas)
2. [User Stories (konsolidiert)](#2-user-stories-konsolidiert)
3. [Akzeptanzkriterien (Top-Stories)](#3-akzeptanzkriterien-top-stories)
4. [Machbarkeitsanalyse (Phase 1.3)](#4-machbarkeitsanalyse)
5. [Kommunikationsprotokoll (ADP)](#5-kommunikationsprotokoll)
6. [Architektur-Empfehlungen](#6-architektur-empfehlungen)
7. [Risiken und Blocker](#7-risiken-und-blocker)
8. [Priorisierung und Phasenplan](#8-priorisierung-und-phasenplan)

---

## 1. Personas

### 1.1 Persona H — Henrik Mayer

| Eigenschaft | Beschreibung |
|---|---|
| **Rolle** | DevOps / AI Pipeline Engineer |
| **Technisches Level** | Expert — CLI, Agenten-Pipelines, Scripting, Git, CI/CD |
| **Primaeres OS** | Windows 11, sekundaer macOS |
| **Kernproblem** | **Kontext-Fragmentierung** — Arbeit verteilt ueber zu viele Fenster, Tools und manuelle Schritte |
| **Ziele** | Pipeline-Durchlaufzeiten reduzieren, deterministische Pipelines, Zeitersparnis |
| **Frustrationen** | Nicht-deterministische Agenten, fluechtige Terminal-Outputs, manuelles Token-Management, kein einheitliches Dashboard |

**Typischer Arbeitstag:** Startet morgens Agenten-Pipeline, beobachtet 3-5 Terminals, kopiert Logs manuell, analysiert Fehler, passt Konfigurationen an. Gefuehl: 40% der Zeit mit Kontext-Wechseln statt Engineering verbracht.

### 1.2 Persona C — Clara Meier

| Eigenschaft | Beschreibung |
|---|---|
| **Rolle** | Digitale Projektmanagerin / AI-Power-Userin |
| **Technisches Level** | Fortgeschrittene Anwenderin — kennt APIs konzeptuell, schreibt keinen Code |
| **Primaeres OS** | Windows / macOS |
| **Kernproblem** | **Tool-Fragmentierung** — wechselt zwischen 10+ Tabs/Apps fuer AI-Arbeit |
| **Ziele** | Zentraler Hub, Kostenkontrolle, Effizienz durch Chat-Steuerung |
| **Frustrationen** | Staendiger Tab-Wechsel, kein Kosten-Ueberblick, isolierte AI-Tools |

**Typischer Arbeitstag:** Dashboard-Check, API-Kosten pruefen, Midjourney-Anfragen, GitHub-Fortschritt, AI-Projekte starten/reviewen, Tages-Zusammenfassung.

### 1.3 Persona-Spannungsfeld

| Dimension | Persona H (Henrik) | Persona C (Clara) |
|---|---|---|
| **Fokus** | Tiefe — spezialisiertes Pipeline-Tool | Breite — generalistischer Hub |
| **Interaktion** | Terminal, CLI, Code | Chat, GUI, Widgets |
| **Technisch** | Will Kontrolle und Details | Will Abstraktion und Ueberblick |
| **Loesung** | Modulare Architektur mit geteiltem Kern + spezialisierten Views |

---

## 2. User Stories (konsolidiert)

### 2.1 Pipeline-Visualisierung (Persona H)

| ID | User Story | Prioritaet |
|---|---|---|
| **PV-01** | Als Henrik moechte ich den Echtzeit-Status aller aktiven Pipeline-Agenten visuell sehen (aktiv/wartend/fehlerhaft), damit ich sofort erkenne ob Intervention noetig ist. | **HOCH** |
| **PV-02** | Als Henrik moechte ich ein erweiterbares Log-Panel mit Drill-Down oeffnen, damit ich Fehler im Detail analysieren kann. | **HOCH** |
| **PV-03** | Als Henrik moechte ich Performance-Metriken sehen (Dauer pro Step, Token-Verbrauch, geschaetzte Kosten), damit ich Effizienz bewerten kann. | **HOCH** |
| **PV-04** | Als Henrik moechte ich bei fehlgeschlagenen QA-Checks den konkreten Fehler-Output sehen, damit ich schnell beheben kann. | MITTEL |
| **PV-05** | Als Henrik moechte ich eine Pipeline-Zeitleiste/Gantt-Ansicht sehen, damit ich Parallelitaet und Engpaesse erkennen kann. | MITTEL |
| **PV-06** | Als Henrik moechte ich bei Fehlern ein Alert-Banner mit Retry-Button sehen, damit die Pipeline nicht unnoetig blockiert bleibt. | MITTEL |
| **PV-07** | Als Henrik moechte ich das generierte SPAWN_MANIFEST visuell sehen, damit ich die Issue-Aufteilung verstehe. | NIEDRIG |

### 2.2 Terminal-Integration (Persona H)

| ID | User Story | Prioritaet |
|---|---|---|
| **TI-01** | Als Henrik moechte ich ein eingebettetes Terminal (PowerShell/Bash) in der App oeffnen, damit ich Befehle ausfuehren kann ohne die App zu verlassen. | **HOCH** |
| **TI-02** | Als Henrik moechte ich Terminal-Output in Echtzeit mit ANSI-Farben sehen, damit die Darstellung einer nativen Shell entspricht. | **HOCH** |
| **TI-03** | Als Henrik moechte ich interaktiv Text in laufende Shell-Sessions eingeben koennen (inkl. Ctrl+C), damit ich mit Prozessen arbeiten kann. | **HOCH** |
| **TI-04** | Als Henrik moechte ich mehrere Terminal-Sessions als Tabs verwalten koennen, damit ich parallele Aufgaben bearbeiten kann. | MITTEL |
| **TI-05** | Als Henrik moechte ich OAuth-Tokens automatisch als Umgebungsvariablen in Terminal-Sessions injizieren, damit Prozesse authentifiziert sind. | MITTEL |

### 2.3 OAuth/API-Key-Management (Persona H + C)

| ID | User Story | Prioritaet |
|---|---|---|
| **SEC-01** | Als Clara moechte ich API-Keys verschiedener Anbieter zentral hinterlegen, damit ich alle Zugaenge verwalte. | **HOCH** |
| **SEC-02** | Als Clara moechte ich eine Kostenuebersicht pro API-Key sehen (Anfragen, Kosten, Zeitraum), damit ich mein Budget kontrolliere. | **HOCH** |
| **SEC-03** | Als Henrik moechte ich OAuth-Tokens sicher in der App speichern (OS Keychain), damit sie nicht im Klartext liegen. | **HOCH** |
| **SEC-04** | Als Henrik moechte ich mich direkt aus der App per OAuth bei Anbietern einloggen (PKCE-Flow), damit kein manueller Token-Austausch noetig ist. | MITTEL |
| **SEC-05** | Als Clara moechte ich Kosten-Warnungen konfigurieren (z.B. "Alert ab 50 USD/Monat"), damit ich keine unerwarteten Rechnungen bekomme. | MITTEL |
| **SEC-06** | Als Clara moechte ich automatisch benachrichtigt werden wenn ein Token ablaeuft, damit Integrationen nicht fehlschlagen. | MITTEL |

### 2.4 AI-Hub und Integrationen (Persona C)

| ID | User Story | Prioritaet |
|---|---|---|
| **HUB-01** | Als Clara moechte ich ein Chat-Interface im Dashboard haben, damit ich Funktionen per natuerlicher Sprache ausfuehren kann. | **HOCH** |
| **HUB-02** | Als Clara moechte ich den Fortschritt meiner GitHub-Projekte (Issues, PRs, Milestones) im Dashboard sehen. | **HOCH** |
| **HUB-03** | Als Clara moechte ich AI-Projekte vom Dashboard starten und deren Status ueberwachen. | MITTEL |
| **HUB-04** | Als Clara moechte ich Drittanbieter-Services (Kalender, DALL-E) ueber definierte Schnittstellen anbinden. | MITTEL |
| **HUB-05** | Als Clara moechte ich per Chat Anfragen an angebundene Dienste stellen (z.B. "Erstelle ein Bild zum Thema X"). | MITTEL |
| **HUB-06** | Als Clara moechte ich eine Dashboard-Startseite mit Widgets (Kalender, Kosten, aktive Projekte). | MITTEL |
| **HUB-07** | Als Clara moechte ich neue Service-Verbindungen ueber eine Plugin-Oberflaeche hinzufuegen. | NIEDRIG |
| **HUB-08** | Als Clara moechte ich Benachrichtigungen aller Services in einem zentralen Feed sehen. | NIEDRIG |

### 2.5 Cross-Platform und Desktop (Persona H)

| ID | User Story | Prioritaet |
|---|---|---|
| **CP-01** | Als Henrik moechte ich die App als nativen Windows-Installer installieren und deinstallieren. | **HOCH** |
| **CP-02** | Als Henrik moechte ich dass die App in < 2s startet und im Idle < 150 MB RAM verbraucht. | **HOCH** |
| **CP-03** | Als Henrik moechte ich dass die App die richtige Shell verwendet (PowerShell/Win, zsh/Mac). | **HOCH** |
| **CP-04** | Als Henrik moechte ich native OS-Benachrichtigungen bei Pipeline-Events erhalten. | MITTEL |
| **CP-05** | Als Henrik moechte ich dass die App auch auf macOS lauffaehig ist. | NIEDRIG |

### 2.6 UX und Gamification

| ID | User Story | Prioritaet |
|---|---|---|
| **UX-01** | Als Nutzer moechte ich dramatische Status-Transitions (Partikel bei Success, Shake bei Error), damit ich Events nicht verpasse. | **HOCH** |
| **UX-02** | Als Nutzer moechte ich einzigartige Agent-Avatare sehen, damit ich zwischen Agenten visuell unterscheiden kann. | MITTEL |
| **UX-03** | Als Nutzer moechte ich auf einen Agent-Node klicken fuer eine erweiterte Detailansicht. | MITTEL |
| **UX-04** | Als Nutzer moechte ich Achievements sehen bei Pipeline-Meilensteinen ("First Blood", "Clean Sweep"). | NIEDRIG |
| **UX-05** | Als Nutzer moechte ich dass Agenten sich raeumlich ueber die Karte bewegen (Fortschritt als Reise). | NIEDRIG |
| **UX-06** | Als Nutzer moechte ich optionalen Ambient-Sound der Pipeline-Aktivitaet widerspiegelt. | NIEDRIG |

### 2.7 Protokoll und Architektur

| ID | User Story | Prioritaet |
|---|---|---|
| **PROTO-01** | Als Entwickler moechte ich strukturierte, typisierte Events empfangen, damit kein fragiles Regex-Parsing noetig ist. | **HOCH** |
| **PROTO-02** | Als Architekt moechte ich robuste Kommunikation mit Retry und Idempotenz, damit die Pipeline bei transienten Fehlern zuverlaessig laeuft. | MITTEL |

**Gesamt: 40 User Stories** (14 HOCH, 17 MITTEL, 9 NIEDRIG)

---

## 3. Akzeptanzkriterien (Top-Stories)

### PV-01: Echtzeit-Agenten-Status

- Alle Agenten zeigen Name, Status (idle/running/error/done) und aktuellen Schritt
- Statusaenderungen werden innerhalb von 500ms in der UI reflektiert
- Fehlerhafte Agenten werden rot hervorgehoben mit klickbarem Fehlertext
- Skaliert auf 10+ gleichzeitige Agenten ohne Frame-Drop unter 30fps

### TI-01: Eingebettetes Terminal

- Button oeffnet neue PowerShell- oder Bash-Instanz innerhalb der App
- Terminal-Output wird in Echtzeit gerendert (inklusive ANSI-Farben via xterm.js)
- Text-Input kann eingegeben und mit Enter abgesendet werden
- Terminal-Prozess wird beim Schliessen des Tabs sauber beendet

### SEC-01: API-Key-Verwaltung

- Einstellungsseite "API-Keys" mit Liste aller hinterlegten Keys
- Keys werden verschluesselt im OS Keychain gespeichert (NICHT Klartext)
- Keys koennen hinzugefuegt, bearbeitet und geloescht werden
- Verbindungstest ("Test Connection") zeigt Key-Gueltigkeit an

### HUB-01: Chat-Interface

- Chat-Panel im Dashboard sichtbar, oeffenbar/schliessbar
- Mindestens 5 Basis-Commands: Kosten anzeigen, Projekt-Status, API-Key hinzufuegen, Dienst aufrufen, Hilfe
- Antworten werden strukturiert dargestellt (Text + Daten-Tabellen)
- Unbekannte Eingaben liefern hilfreiche Fehlermeldung mit Vorschlaegen

### HUB-02: GitHub-Integration

- Repository-Liste mit offenen Issues/PRs und Status
- Milestone-Fortschrittsbalken
- Daten ueber GitHub REST API v3 oder GraphQL v4 abgerufen

---

## 4. Machbarkeitsanalyse

### 4.1 Gesamtbewertung

> **Der aktuelle Tech-Stack (Tauri v2 + React 18 + TypeScript + Zustand + Tailwind + Framer Motion) ist grundsaetzlich geeignet.**

| Kategorie | Anteil | Beschreibung |
|---|---|---|
| Existiert bereits | ~30% | Desktop-Shell, Child-Process-Spawning, isometrische UI, State-Management |
| Machbar mit Erweiterungen | ~60% | Terminal (xterm.js + PTY), Credentials (Stronghold), GitHub, Chat, Protokoll |
| Problematisch | ~10% | Midjourney (keine API), OAuth-Flows (manuell), heterogenes Kosten-Tracking |

### 4.2 Bewertung pro Anforderung

| Anforderung | Machbar? | Zusaetzliche Dependencies | Risiko |
|---|---|---|---|
| Pipeline-Visualisierung | JA | Optional: recharts/d3 | NIEDRIG |
| Native Desktop-App | JA | Keine | NIEDRIG |
| Terminal-Integration | JA | `portable-pty` (Rust), `xterm.js` (JS) | MITTEL |
| OAuth/API-Key-Management | JA | `tauri-plugin-stronghold`, `keyring`, `oauth2` (Rust) | MITTEL |
| AI-Hub (GitHub) | JA | `@octokit/rest` | NIEDRIG |
| AI-Hub (Calendar) | JA | Google API Client, OAuth2-Flow | MITTEL |
| AI-Hub (Midjourney) | **NEIN** | Keine offizielle API | **BLOCKER** |
| Service-Protokoll | JA | `zod` (JS), `schemars` (Rust) | NIEDRIG |
| Chat-Interface | JA | `react-markdown`, `tauri-plugin-http` | NIEDRIG |
| Deterministische Pipeline | JA | Optional: `xstate` | NIEDRIG |

### 4.3 Empfohlene neue Dependencies

**Must-Have:**

| Package | Seite | Zweck |
|---|---|---|
| `tauri-plugin-stronghold` | Rust + JS | Sichere Credential-Speicherung |
| `tauri-plugin-store` | Rust + JS | Persistente App-Einstellungen |
| `tauri-plugin-http` | Rust + JS | HTTP-Requests aus der App |
| `@xterm/xterm` | JS | Terminal-Widget |
| `portable-pty` | Rust | PTY-Sessions (interaktive Shell) |
| `zod` | JS | Schema-Validierung |
| `@octokit/rest` | JS | GitHub-API |

**Sollte-haben:**

| Package | Seite | Zweck |
|---|---|---|
| `schemars` | Rust | JSON-Schema aus Rust-Structs |
| `ts-rs` / `typeshare` | Rust | Rust->TypeScript Type-Sync |
| `react-markdown` | JS | Markdown im Chat |
| `react-hook-form` + `zod` | JS | Formular-Handling |
| `keyring` | Rust | OS-Keychain Zugriff |

---

## 5. Kommunikationsprotokoll

### ADP (Agentic Dashboard Protocol) v1.0.0

Vollstaendig definiert in:
- **Schema:** `src/protocols/schema.ts` (TypeScript-Typen + Hilfsfunktionen)
- **Dokumentation:** `Softwareprozess/Protokoll-Design.md`

### Eckpunkte

- **Einheitliches Envelope-Format** fuer alle Service-Kommunikation (UUID, Timestamp, Source, Target, Type, Payload, Meta)
- **7 Event-Kategorien**: `pipeline.*`, `orchestrator.*`, `worktree.*`, `qa.*`, `terminal.*`, `service.*`, `system.*`
- **23 typisierte Event-Typen** mit dedizierten Payload-Interfaces
- **Fehlerbehandlung**: Maschinenlesbare Codes, `retryable`-Flag, Exponential Backoff mit Jitter
- **Idempotenz**: UUID-basierte Deduplizierung mit LRU-Set
- **Versionierung**: Semantic Versioning, Forward-Compatibility durch Ignorieren unbekannter Events

### Migrations-Pfad

1. Schema-Typen definieren (erledigt)
2. Rust-Backend um strukturierte Events erweitern
3. Frontend-Listener auf ADP umstellen (Regex-Parser als Fallback)
4. Mock-Pipeline auf ADP umstellen
5. Neue Event-Typen implementieren

---

## 6. Architektur-Empfehlungen

### 6.1 Modulare Plugin-Architektur

Loesung fuer das Persona-Spannungsfeld (Henrik: Tiefe, Clara: Breite):

```
Gemeinsamer Kern:
  Tauri v2 + Zustand Store + ADP-Protokoll + Credential Store

Pipeline-Modul (Persona H):
  DashboardMap + WorktreeNodes + QA-Gate + Terminal + Log-Parser

Hub-Modul (Persona C):
  Startseite + Chat + Widgets + Service-Adapters + Kosten-Dashboard
```

### 6.2 Service-Adapter (Rust-Trait)

```rust
#[async_trait]
pub trait ServiceAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn descriptor(&self) -> ServiceDescriptor;
    async fn connect(&mut self, credentials: &Credentials) -> Result<(), AdapterError>;
    async fn handle(&self, message: ServiceMessage) -> Result<ServiceMessage, AdapterError>;
    async fn disconnect(&mut self) -> Result<(), AdapterError>;
}
```

### 6.3 Terminal-Architektur

- **Backend:** `portable-pty` fuer PTY-Sessions, `TerminalManager` als Managed Tauri State
- **Frontend:** xterm.js pro Tab, neuer `terminalStore.ts`
- **Kommunikation:** Bytestream (nicht Zeilenstream) ueber Tauri Events
- **Sicherheit:** Alle Shell-Interaktionen durch Rust-Commands, Tokens nie im Frontend

### 6.4 Security-Architektur

- **Alle Secrets bleiben im Rust-Backend** — Frontend kennt nur Token-IDs und Metadata
- **OS Keychain** als primaerer Speicher (`keyring` Crate)
- **OAuth PKCE-Flow** fuer Desktop-App (lokaler Redirect-Server)
- **Log-Redacting** fuer API-Keys (`sk-...`, `ghp_...`, `Bearer ...`)
- **CSP aktivieren** in `tauri.conf.json` (aktuell `null`)

---

## 7. Risiken und Blocker

### 7.1 Blocker

| Risiko | Beschreibung | Mitigation |
|---|---|---|
| **Midjourney** | Keine offizielle API. Discord-Bot-Workarounds sind fragil und ToS-verletzend. | **DALL-E 3 oder Stable Diffusion API als Alternative** |

### 7.2 Hohe Risiken

| Risiko | Beschreibung | Mitigation |
|---|---|---|
| **Terminal-Sicherheit** | Eingebettetes Terminal = Privilege-Escalation des WebView | Alle Shell-Interaktionen durch Rust-Commands, CSP aktivieren, Feature-Flag |
| **Token-Leak** | Tokens koennten ueber Frontend, Logs oder IPC leaken | Tokens nur in Rust, Log-Redacting, keine Token-Payloads |
| **OAuth-Flows** | Manuell zu implementieren pro Provider | PKCE + Device Flow als Standards, `oauth2` Crate |
| **Scope Creep** | Claras "Hub fuer alles"-Vision kann zu Feature-Bloat fuehren | Plugin-Architektur, klare Phase-1-Abgrenzung |

### 7.3 Mittlere Risiken

| Risiko | Beschreibung | Mitigation |
|---|---|---|
| Performance vs. Animationen | Framer Motion bei 10+ Agenten | Virtualisierung, GPU-Transforms, Animations-Reduktion |
| Kosten-API-Heterogenitaet | Jeder Anbieter hat andere Usage-API | Lokales Request-Tracking als Fallback |
| PTY auf Windows | ConPTY weniger gut dokumentiert als Unix PTY | `portable-pty` abstrahiert, Testing noetig |
| Cross-Platform Testing | macOS Builds erfordern macOS CI | GitHub Actions mit macOS Runner |

---

## 8. Priorisierung und Phasenplan

### Phase 1 — MVP "Pipeline Monitoring" (Henrik first)

**Ziel:** Funktionsfaehiges Pipeline-Dashboard mit echtem Mehrwert

| # | Feature-Gruppe | User Stories | Aufwand (geschaetzt) |
|---|---|---|---|
| 1 | ADP-Protokoll (Grundlage) | PROTO-01 | 3-5 Tage |
| 2 | Echtzeit-Agenten-Status | PV-01, PV-02, PV-03 | 5-7 Tage |
| 3 | Dramatische Status-Transitions | UX-01 | 2-3 Tage |
| 4 | Windows-Installer + Performance | CP-01, CP-02, CP-03 | 2-3 Tage |

### Phase 2 — "Terminal & Security"

| # | Feature-Gruppe | User Stories | Aufwand (geschaetzt) |
|---|---|---|---|
| 5 | Terminal-Integration | TI-01, TI-02, TI-03, TI-04 | 7-10 Tage |
| 6 | API-Key-Verwaltung | SEC-01, SEC-03 | 5-7 Tage |
| 7 | Agent-Avatare + Detail-Panel | UX-02, UX-03 | 3-5 Tage |
| 8 | QA-Gate Detail + Retry | PV-04, PV-06 | 3-5 Tage |

### Phase 3 — "AI Hub" (Clara first)

| # | Feature-Gruppe | User Stories | Aufwand (geschaetzt) |
|---|---|---|---|
| 9 | Plugin-/Adapter-Architektur | HUB-07 | 5-8 Tage |
| 10 | GitHub-Integration | HUB-02 | 3-5 Tage |
| 11 | Chat-Interface | HUB-01 | 5-7 Tage |
| 12 | Kosten-Monitoring | SEC-02, SEC-05 | 4-6 Tage |

### Phase 4 — "Erweiterungen"

| # | Feature-Gruppe | User Stories | Aufwand (geschaetzt) |
|---|---|---|---|
| 13 | OAuth-Flows | SEC-04, SEC-06 | 5-7 Tage |
| 14 | AI-Projekte starten | HUB-03 | 3-5 Tage |
| 15 | Calendar/DALL-E Integration | HUB-04, HUB-05 | 5-7 Tage |
| 16 | Pipeline-Zeitleiste | PV-05 | 4-6 Tage |
| 17 | macOS-Support + CI/CD | CP-04, CP-05 | 5-7 Tage |
| 18 | Gamification (Achievement, Sound) | UX-04, UX-05, UX-06 | 5-7 Tage |

---

## Anhang: Erstellte Artefakte

| Datei | Beschreibung |
|---|---|
| `Softwareprozess/Anforderungsanalyse.md` | Dieses Dokument |
| `Softwareprozess/Protokoll-Design.md` | ADP Protokoll-Dokumentation |
| `src/protocols/schema.ts` | TypeScript-Schema mit allen Event-Typen und Hilfsfunktionen |
