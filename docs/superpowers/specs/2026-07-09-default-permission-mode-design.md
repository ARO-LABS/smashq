# Design-Spec: Globaler Default-Permission-Modus (Issue #11)

**Status:** Genehmigt (Brainstorming abgeschlossen 2026-07-09)
**Ephemer:** Diese Datei wird im selben Commit wie der Feature-Merge geloescht (Doku-Hygiene, CLAUDE.md).

## Problem

Neue Claude-CLI-Sessions starten aktuell hart mit `claude --dangerously-skip-permissions`
(Bypass/YOLO) — der Flag ist an genau einer Stelle in `manager.rs::shell_args`
einkodiert. Der User (Issue #11) will den Permission-Modus, mit dem neue Sessions
starten, selbst waehlen koennen: von "immer nachfragen" bis "alles erlauben".

## Ziel & Scope

- **In-Scope:** Eine globale, persistierte Einstellung `defaultPermissionMode` in
  Settings → Sessions. Gilt fuer **neue Sessions und Resumes**. 4 Modi.
- **Out-of-Scope (YAGNI):** Kein Per-Favorit-Override. Keine Laufzeit-Umschaltung
  einer bereits laufenden Session (Modus wirkt nur beim Start). Kein zusaetzlicher
  claude-Modus ausser den vier unten (`acceptEdits`/`manual`/`dontAsk` bewusst weggelassen —
  koennen spaeter additiv ergaenzt werden).

## Modi → CLI-Flag (geschlossenes Enum)

| UI-Label (DE)          | Persist-Wert | claude-Flag                        |
|------------------------|--------------|------------------------------------|
| Standard (Nachfragen)  | `default`    | *(kein Flag)* — natives Prompting  |
| Auto                   | `auto`       | `--permission-mode auto`           |
| Plan                   | `plan`       | `--permission-mode plan`           |
| Bypass / YOLO          | `bypass`     | `--dangerously-skip-permissions`   |

Belegt gegen `claude --help` (v2.1.205): `--permission-mode` akzeptiert u.a. `auto`
und `plan`; einen Wert `default` gibt es dort NICHT — deshalb mappt "Standard" auf
gar keinen Flag (plain `claude` = Claudes eingebautes interaktives Nachfragen).

## Architektur & Datenfluss

Exakt die bestehende `defaultShell`-Naht gespiegelt — ein globales Top-Level-Feld,
das durch dieselben Grenzen bis zum PTY-Spawn fliesst:

```
settingsStore.defaultPermissionMode
   └─ NewSessionDefaultsPanel <select>            (UI, 4 Optionen + Hilfetext)
   └─ useSessionCreation: permissionMode an ALLE 3 create_session-Invokes
        └─ commands.rs  create_session(permission_mode: Option<String>)   (Tauri-Boundary)
             └─ manager.rs create_session(..., permission_mode: String)
                  └─ shell_args(shell, platform, resume, mode: PermissionMode)
                       └─ claude_cmd aus &'static-str-Literalen
```

### 1. Storage — `src/store/settingsStore.ts`

Neues Top-Level-Feld analog `defaultShell` an **allen** Naht-Stellen:

- **Union-Typ + Konstante:** `export const PERMISSION_MODES = ["default","auto","plan","bypass"] as const;`
  und `export type PermissionMode = (typeof PERMISSION_MODES)[number];`
- **Sanitize-Helper** (geteilt zwischen Store-Default, migrate, onRehydrate, UI):
  ```ts
  export function sanitizePermissionMode(value: unknown): PermissionMode {
    return PERMISSION_MODES.includes(value as PermissionMode)
      ? (value as PermissionMode)
      : "default";
  }
  ```
- Interface-Feld (`:280`-Naehe): `defaultPermissionMode: PermissionMode;`
- Setter-Typ (`:324`): `setDefaultPermissionMode: (mode: PermissionMode) => void;`
- Setter-Impl (`:1021`): `setDefaultPermissionMode: (mode) => set({ defaultPermissionMode: mode }),`
- Store-Default (`:793`): `defaultPermissionMode: "default",`
- migrate-defaults-Objekt (`:582`): `defaultPermissionMode: "default" as const,`
- migrate-Coercion (`:698`, `.includes`-Muster wie `defaultShell`):
  `defaultPermissionMode: sanitizePermissionMode(p.defaultPermissionMode),`
- `onRehydrateStorage`: Feld ueber denselben Sanitize normalisieren (same-version-Corruption-Recovery, Issue-#209-Klasse).
- partialize (`:1331`): `defaultPermissionMode: state.defaultPermissionMode,`
- resetToDefaults (`:1295`): `defaultPermissionMode: "default",`
- **Persist-Version 12 → 13.**

### 2. UI — `src/components/settings/NewSessionDefaultsPanel.tsx`

Ein `<select>` neben "Standard-Shell" (JSX-Vorlage `:104-126`, Store-Wiring `:61-64`).
Statische Options-Liste im Panel:

```ts
const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Standard (Nachfragen)", hint: "Claude fragt vor jeder Aktion nach." },
  { value: "auto",    label: "Auto",                   hint: "Erlaubt Aktionen automatisch, ausser bei Konflikten." },
  { value: "plan",    label: "Plan",                   hint: "Startet im Planungsmodus ohne Aenderungen." },
  { value: "bypass",  label: "Bypass / YOLO",          hint: "Ueberspringt alle Nachfragen (bisheriges Verhalten)." },
];
```

Panel ist in `categories.ts:30-35` (id `"sessions"`) registriert — keine Aenderung noetig.
Hilfetext unter dem Select zeigt den `hint` des aktiven Modus. Deutsche UI-Copy im
Imperativ/Infinitiv, kein `du`/`Sie`, kein Emoji (Design-System).

### 3. Session-Erzeugung — `src/components/sessions/hooks/useSessionCreation.ts`

An **allen drei** `wrapInvoke("create_session", {...})`-Aufrufen das Feld ergaenzen:

- Resume (`:73-79`)
- Favoriten-Quickstart (`:112-117`)
- Neu-aus-Defaults (`:178-183`)

Jeweils `permissionMode: settings.defaultPermissionMode` ins Objekt-Literal
(camelCase → Tauri mappt auf snake_case `permission_mode`). Alle drei Pfade lesen den
GLOBALEN Store-Wert — Scope ist bewusst global, kein Per-Favorit-Feld.

### 4. Tauri-Boundary — `src-tauri/src/session/commands.rs`

`create_session`-Command um `permission_mode: Option<String>` erweitern (nach `shell`).
Default an der Grenze wie bei `shell`:
```rust
let permission_mode = permission_mode.unwrap_or_else(|| "default".to_string());
```
An `manager.create_session(...)` durchreichen. Debug-Log-Zeile (`:26-34`) um `permission_mode` ergaenzen.
Keine String-Interpolation in Shell hier — nur Weitergabe.

### 5. Manager + shell_args — `src-tauri/src/session/manager.rs`

**Neues Rust-Enum (Security-Kern):**
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Default,
    Auto,
    Plan,
    Bypass,
}

impl PermissionMode {
    /// Roh-String von der Grenze → geschlossenes Enum. Unbekanntes → Default
    /// (fail-safe zum sichersten, nicht zum gefaehrlichsten Modus).
    pub fn from_pref(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "plan" => Self::Plan,
            "bypass" => Self::Bypass,
            _ => Self::Default, // "default" UND alles Unbekannte
        }
    }

    /// Nur &'static-str-Literale — kein User-Text erreicht je die Shell.
    fn claude_flag(self) -> &'static str {
        match self {
            Self::Default => "",
            Self::Auto => " --permission-mode auto",
            Self::Plan => " --permission-mode plan",
            Self::Bypass => " --dangerously-skip-permissions",
        }
    }
}
```

- `create_session`-Signatur (`:112-122`) um `permission_mode: String` erweitern;
  direkt zu `PermissionMode::from_pref(&permission_mode)` aufloesen.
- `shell_args`-Signatur (`:879`) um `mode: PermissionMode` erweitern; Aufruf `:180` anpassen.
- `claude_cmd`-Bau (`:900-903`) neu:
  ```rust
  let mode_flag = mode.claude_flag();
  let claude_cmd = match valid_resume {
      Some(id) => format!("claude{} --resume {}", mode_flag, id),
      None => format!("claude{}", mode_flag),
  };
  ```
  Ergibt z.B. `claude --permission-mode auto --resume abc`, `claude` (Default),
  `claude --dangerously-skip-permissions`.

## Sicherheit

- Der Modus wird an **jeder** Grenze aufs Enum validiert: Frontend-Sanitize (Fallback
  `default`), Tauri-Default (`default`), Rust `from_pref` (Unbekanntes → `Default`).
- `claude_cmd` wird ausschliesslich aus `&'static str`-Literalen zusammengesetzt —
  identische Haertung wie der bestehende `--resume`-Charset-Guard (`shell_args:888-899`).
  Selbst wenn ein manipulierter String die Grenze passiert, kann er nur einen der vier
  festen Flags oder gar keinen erzeugen; Shell-Injection ist strukturell ausgeschlossen.
- Fail-safe-Richtung: unbekannt → `Default` (nachfragen), NICHT → `Bypass`.

## ⚠️ Verhaltensaenderung (bewusst)

Bestands-User starten Sessions heute im **Bypass**. Nach dem Update ist der Default
**Standard (Nachfragen)** → neue Sessions fragen dann nach Berechtigungen. Das ist eine
absichtliche Sicherheits-Verbesserung, muss aber sichtbar kommuniziert werden:

- **CHANGELOG.md:** prominent unter "Geaendert" (Breaking-artig, auch wenn technisch kein Bruch).
- **`src/whatsNew.ts`:** Watchout beim naechsten Release ("Neue Sessions fragen jetzt
  standardmaessig nach — auf Bypass/YOLO umstellen in Einstellungen → Sessions").
- Migration (v12→13) seedet fuer Bestands-User explizit `default` (kein stilles Bypass-Erben).

Wer das bisherige Verhalten behalten will, stellt den Modus einmal auf **Bypass / YOLO**.

## Tests (Quality Gate: 1 Happy + 1 Edge pro Feature)

**Rust (`manager.rs` `#[cfg(test)]`):**
- Bestehende ~10 `shell_args`-Tests (`:1674-1780`) auf neue Signatur anpassen: sie
  testen Shell-/Resume-/Charset-Plumbing, NICHT den Default-Modus — daher bekommen sie
  alle `PermissionMode::Bypass` uebergeben, sodass ihre erwarteten `--dangerously-skip-permissions`-Strings
  unveraendert bleiben. Der Default-Wechsel wird von den NEUEN Mapping-Tests abgedeckt.
- Neu: 1 Mapping-Test pro Modus (`Default`→kein Flag, `Auto`→`--permission-mode auto`,
  `Plan`→`--permission-mode plan`, `Bypass`→`--dangerously-skip-permissions`).
- Neu: `from_pref`-Test inkl. Unbekannt→`Default` (Edge/Security).
- Neu: Kombination Resume + Modus (`claude --permission-mode auto --resume <id>`).

**Frontend:**
- `settingsStore`-Test: `sanitizePermissionMode` (gueltig/ungueltig/undefined → `default`).
- Migrations-Test: v12-Blob ohne Feld → nach migrate `default`; korrupter Wert → `default`.
- `NewSessionDefaultsPanel.test.tsx`: Select rendert 4 Optionen, `onChange` ruft
  `setDefaultPermissionMode`, aktiver Hilfetext wechselt mit Auswahl.
- `useSessionCreation`: alle drei Invoke-Pfade uebergeben `permissionMode` (mockIPC,
  Real-IPC-Muster — kein `vi.mock` des core).

## Betroffene Dateien (Zusammenfassung)

| Datei | Aenderung |
|---|---|
| `src/store/settingsStore.ts` | Feld + Setter + Default + Sanitize + migrate(12→13) + onRehydrate + partialize + reset |
| `src/components/settings/NewSessionDefaultsPanel.tsx` | `<select>` + Options-Konstante + Hilfetext |
| `src/components/sessions/hooks/useSessionCreation.ts` | `permissionMode` an 3 Invokes |
| `src-tauri/src/session/commands.rs` | `permission_mode: Option<String>` + Default + Durchreichen + Log |
| `src-tauri/src/session/manager.rs` | `PermissionMode`-Enum + Signaturen (`create_session`, `shell_args`) + `claude_cmd` |
| Tests (Rust + 4 Frontend-Dateien) | s.o. |
| `CHANGELOG.md`, `src/whatsNew.ts`, `tasks/todo.md`, `tasks/lessons.md` | Doku/Verhaltensaenderung |

## Nicht-Ziele / offene Punkte

- Kein Per-Favorit-Modus (Scope-Entscheidung: global).
- `SessionInfo` speichert den Modus NICHT zurueck (nur Start-Parameter) — falls die UI
  spaeter den aktiven Modus einer Session anzeigen soll, ist das ein Folge-Feature.
