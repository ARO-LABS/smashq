# Agentic Dashboard Protocol (ADP) v1.0.0

## Analyse des Ist-Zustands

### Bestehende Datenstrukturen

**Rust-Backend (`src-tauri/src/lib.rs`):**
- `LogEvent { line: String, stream: String, worktree_id: Option<String> }` — Flaches Struct, wird als `pipeline-log` Event emitted
- Kein typisiertes Protokoll, nur rohe Log-Zeilen
- `worktree_id` ist immer `None` — Demultiplexing passiert im Frontend

**Log-Parser (`src/store/logParser.ts`):**
- `ParsedEvent { type, payload }` mit 8 Event-Typen
- Regex-basiertes Parsing von unstrukturiertem Text
- Modul-globaler State (`currentContextWorktreeId`) fuer Kontext-Tracking
- Payload ist `Record<string, string>` — untypisiert

**Pipeline-Store (`src/store/pipelineStore.ts`):**
- Typisierte Interfaces: `Worktree`, `QAGate`, `PipelineState`
- Feste Typen fuer Steps, Status, QA-Checks
- Kein Fehlerbehandlungs-Modell

### Identifizierte Probleme

1. **Kein einheitliches Nachrichtenformat**: Rust sendet rohe Strings, Frontend parst mit Regex
2. **Keine Idempotenz**: Doppelte Events werden nicht erkannt
3. **Keine Fehlerbehandlung**: Kein Error-Propagation-Modell
4. **Keine Versionierung**: Schema-Aenderungen brechen Kompatibilitaet
5. **Keine Erweiterbarkeit**: Neue Services (GitHub, Calendar, Terminal) haben kein Integrationsmodell

---

## Protokoll-Design

### Envelope-Struktur

Jede Nachricht folgt dem gleichen Envelope-Format:

```json
{
  "version": "1.0.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-03-15T14:30:00.000Z",
  "source": { "kind": "tauri-backend" },
  "target": { "kind": "react-frontend" },
  "type": "worktree.step-change",
  "correlationId": "req-abc-123",
  "sequence": 3,
  "payload": {
    "_type": "worktree.step-change",
    "worktreeId": "wt-42",
    "previousStep": "plan",
    "newStep": "validate",
    "stepStartedAt": "2026-03-15T14:30:00.000Z"
  },
  "meta": {
    "retryCount": 0,
    "environment": "development"
  }
}
```

### Kommunikationskanaele

| Kanal | Source | Target | Transport |
|-------|--------|--------|-----------|
| Pipeline-Steuerung | Frontend | Backend | Tauri Command (invoke) |
| Pipeline-Events | Backend | Frontend | Tauri Event (emit) |
| Claude CLI Output | Backend | Frontend | Tauri Event (emit) |
| Terminal I/O | Backend | Frontend | Tauri Event (emit) |
| Externe APIs | Backend | Ext. Service | HTTP/REST |
| Service-Antworten | Backend | Frontend | Tauri Event (emit) |

### Event-Kategorien

| Kategorie | Event-Typen | Beschreibung |
|-----------|------------|--------------|
| `pipeline.*` | start, stop, status, error | Pipeline-Lifecycle |
| `orchestrator.*` | status-change, log, manifest-generated | Orchestrator-Steuerung |
| `worktree.*` | spawn, step-change, status-change, log, progress | Worktree-Lifecycle |
| `qa.*` | check-update, overall-status, report | QA-Gate-Pruefungen |
| `terminal.*` | spawn, input, output, exit | Terminal-Instanzen |
| `service.*` | request, response, auth, cost-update | Externe Service-Integration |
| `system.*` | heartbeat, error, config-change | Infrastruktur |

---

## Versionierung und Erweiterbarkeit

### Versionierungs-Strategie

- **Semantic Versioning** im `version`-Feld des Envelopes
- **Major**: Breaking Changes an bestehenden Payloads oder Entfernung von Event-Typen
- **Minor**: Neue Event-Typen oder optionale Felder in bestehenden Payloads
- **Patch**: Bug-Fixes in der Schema-Validierung

### Erweiterbarkeits-Regeln

1. **Neue Event-Typen** koennen jederzeit hinzugefuegt werden (Minor-Version)
2. **Neue optionale Felder** in Payloads sind abwaertskompatibel (Minor-Version)
3. **Entfernung von Feldern** oder **Typ-Aenderungen** erfordern Major-Version
4. **`payloadVersion`** in Meta erlaubt Payload-spezifische Versionierung fuer Forward-Compatibility
5. **Unbekannte Event-Typen** muessen von Consumern ignoriert werden (nicht als Fehler behandeln)

### Migration

Bei Major-Version-Aenderungen:
- Backend sendet uebergangsweise beide Versionen (Feature-Flag)
- Frontend implementiert Version-Check: `if (envelope.version.startsWith("1.")) { ... }`
- Deprecation-Warnings 2 Minor-Versionen vor Entfernung

---

## Fehlerbehandlung

### Error-Modell

Jeder Fehler enthaelt:
- **code**: Maschinenlesbarer Fehlercode (z.B. `SERVICE_RATE_LIMITED`)
- **message**: Menschenlesbare Beschreibung
- **retryable**: Boolean — ob ein Retry sinnvoll ist
- **retryAfterMs**: Empfohlene Wartezeit

### Retry-Strategie

Standard-Policy: Exponential Backoff mit Jitter
- Max 3 Retries
- Basis: 1000ms, Max: 30000ms
- Jitter: 50-100% der berechneten Wartezeit

### Idempotenz

- Jede Nachricht hat eine UUID (`id`)
- Consumer fuehren ein Deduplizierungs-Set (LRU, max 1000 Eintraege)
- `correlationId` verknuepft zusammengehoerige Nachrichten (Request/Response)

---

## User Stories

### US-1: Pipeline-Events strukturiert empfangen
**Als** Dashboard-Entwickler (Persona H)
**moechte ich** strukturierte, typisierte Events vom Backend empfangen,
**damit** ich kein fragiles Regex-Parsing auf unstrukturiertem Text mehr betreiben muss.

**Akzeptanzkriterien:**
- Backend sendet ADP-Envelopes statt roher Log-Zeilen
- Frontend validiert eingehende Nachrichten gegen das Schema
- Unbekannte Event-Typen werden geloggt aber ignoriert (kein Crash)
- Bestehende Mock-Pipeline verwendet das neue Protokoll

### US-2: API-Kosten pro Service ueberwachen
**Als** Power-User (Persona C)
**moechte ich** die Kosten meiner API-Aufrufe (Anthropic, OpenAI, Midjourney) pro Session und Monat sehen,
**damit** ich mein Budget im Blick behalte.

**Akzeptanzkriterien:**
- `service.cost-update` Events werden bei jedem API-Call emitted
- Dashboard aggregiert Kosten nach Service, Modell und Zeitraum
- Token-Verbrauch (Input/Output) wird separat ausgewiesen
- Kosten-Anzeige in der UI aktualisiert sich in Echtzeit

### US-3: Terminal-Sitzungen steuern und ueberwachen
**Als** Pipeline-Entwickler (Persona H)
**moechte ich** Terminal-Instanzen aus dem Dashboard heraus starten und deren Ein-/Ausgabe sehen,
**damit** ich die Pipeline-Ausfuehrung direkt im Dashboard verfolgen und eingreifen kann.

**Akzeptanzkriterien:**
- `terminal.spawn` startet eine neue Shell-Instanz (PowerShell/Bash)
- `terminal.input` sendet Befehle an die Terminal-Instanz
- `terminal.output` streamt stdout/stderr zurueck an das Dashboard
- `terminal.exit` signalisiert das Ende einer Terminal-Sitzung
- Mehrere parallele Terminal-Instanzen werden unterstuetzt

### US-4: OAuth-Tokens sicher verwalten
**Als** Multi-Service-Nutzer (Persona C)
**moechte ich** OAuth-Tokens fuer verschiedene Anbieter (GitHub, Calendar, Midjourney) im Dashboard hinterlegen,
**damit** Terminal-Instanzen und Services automatisch authentifiziert werden.

**Akzeptanzkriterien:**
- `service.auth` Events tracken Token-Lifecycle (stored, refreshed, expired, revoked)
- Tokens werden im Tauri Secure Store gespeichert (nicht im Frontend-State)
- Automatische Token-Erneuerung vor Ablauf
- UI zeigt Auth-Status pro Service an

### US-5: Robuste Kommunikation mit Retry und Idempotenz
**Als** System-Architekt
**moechte ich** dass die Service-Kommunikation fehlgeschlagene Requests automatisch wiederholt und Duplikate erkennt,
**damit** die Pipeline auch bei transienten Fehlern zuverlaessig laeuft.

**Akzeptanzkriterien:**
- Fehlgeschlagene Service-Requests werden gemaess Retry-Policy wiederholt
- Exponential Backoff mit Jitter verhindert Thundering-Herd
- Nachrichten-IDs ermoeglichen Deduplizierung
- `correlationId` verknuepft Request/Response-Paare
- Nach Ausschoepfung der Retries wird ein `system.error` Event mit `retryable: false` emitted

---

## Implementierungsschema (TypeScript)

Die vollstaendige typisierte Schema-Definition befindet sich in:
**`src/protocols/schema.ts`**

Diese Datei enthaelt:
- Envelope-Interface mit generischem Payload-Parameter
- Alle Source/Target-Typen
- Alle Event-Typen als Union Type
- Typisierte Payloads fuer jeden Event-Typ
- Fehlerbehandlungs-Interfaces (ADPError, ADPErrorCode)
- Retry-Policy mit Default-Konfiguration
- Hilfsfunktionen: `createADPMessage()`, `isIdempotent()`, `calculateRetryDelay()`

### Migrations-Pfad vom Ist-Zustand

1. **Phase 1**: Schema-Typen definieren (erledigt: `src/protocols/schema.ts`)
2. **Phase 2**: Rust-Backend um strukturierte Events erweitern (LogEvent -> ADPEnvelope)
3. **Phase 3**: Frontend-Listener auf ADP-Envelopes umstellen, Regex-Parser als Fallback beibehalten
4. **Phase 4**: Mock-Pipeline auf ADP-Protokoll umstellen
5. **Phase 5**: Neue Event-Typen (Terminal, Service, Cost) implementieren
