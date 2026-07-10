# Spec: About-Section in den Settings

**Datum:** 2026-07-10
**Branch:** `feat/settings-about-section`
**Status:** Design abgenommen ("passt"), OS-Quelle abgenommen ("an main orientieren, kein Overengineering")

## Ziel

Eine neue Settings-Kategorie **„Über"** zeigt App-Identität, Build-Herkunft und
projektbezogene Links an einem Ort. Nutzen: Support/Bug-Reports (welche Version,
welcher Commit, welche Plattform) und schneller Sprung ins Repo.

## Nicht-Ziele (YAGNI)

- **Kein** „Nach Updates suchen"-Button — der Updater bleibt ausschließlich über
  das v-Badge im `SessionPanelDock` erreichbar (geschützter Pfad, wird nicht
  dupliziert).
- **Kein** neues natives Plugin (`@tauri-apps/plugin-os`), **keine** neue
  Rust-Crate (`os_info`/`sysinfo`), **keine** Capability-Änderung.
- **Kein** Version-Bump, **keine** OS-Versionsnummer (`15.5`) — bewusst
  weggelassen, um eine neue Dependency zu vermeiden.
- Keine Änderung an anderen Panels, an `PreferencesView` oder `CategoryNav`.

## Platzierung & Struktur

- Neue Kategorie als **letzter** Eintrag in
  `src/components/settings/categories.ts` (`SETTINGS_CATEGORIES`):
  `{ id: "about", label: "Über", icon: ICONS.toast.info, Panel: lazy(AboutPanel) }`.
  Reihenfolge danach: Darstellung · Sessions · Terminal · Benachrichtigungen ·
  System · Erweitert · **Über**.
- Neues Panel `src/components/settings/panels/AboutPanel.tsx` — lazy-geladen,
  exakt dem Muster von `NotificationsPanel`/`SystemPanel` folgend
  (`flex flex-col gap-6 p-6 max-w-2xl`, Header `h3` + `p`, Sektionen
  `rounded-md shadow-hairline p-4 bg-surface-base`, Sub-Header `h4` uppercase).
- `PreferencesView` und `CategoryNav` bleiben unangetastet (iterieren nur über
  das Schema).
- Läuft im bestehenden `detached-settings`-Fenster — alle benötigten
  Capabilities (`shell:allow-open`, `clipboard-manager:allow-write-text`) sind
  in `capabilities/default.json` bereits vorhanden.

## Inhalt & Layout (AboutPanel)

**Kopf:** „Über Smashq" + Kurzbeschreibung („Claude-CLI-Sessions verwalten und
überwachen") + Version prominent (`v1.0.23`).

**Block „Build-Info"** — Definition-Rows (Label links, Wert mono rechts):

| Feld       | Quelle                              | Anzeige-Beispiel        |
|------------|-------------------------------------|-------------------------|
| Version    | `getVersion()` (`@tauri-apps/api/app`) | `1.0.23`             |
| Commit     | `__GIT_HASH__` (Vite-inject, short) | `a989923` (klickbar)    |
| Build-Datum| `__BUILD_DATE__` (Vite-inject)      | `2026-07-10 14:30`      |
| Plattform  | `get_os_info` (Rust-Command)        | `macOS · arm64`         |

Darunter Button **„Diagnose kopieren"** (`ui/Button`, `variant="secondary"`,
`size="sm"`) mit Häkchen-Feedback wie in `KnowledgeSection`.

**Block „Links"** — Zeilen mit `ICONS.action.externalLink`:

- Repository → `https://github.com/ARO-LABS/smashq`
- Problem melden → `…/issues`
- Releases / Changelog → `…/releases`

**Fuß:** dezent `© 2026 ARO-LABS · MIT-Lizenz` (`text-xs text-neutral-500`).

## Datenquellen & -fluss

Ein defensiver Read-Helfer im Panel sammelt die dynamischen Felder; jedes Feld
hat einen Fallback, damit das Panel außerhalb der App (jsdom/Browser-Dev) nie
crasht:

- **Version:** `getVersion()` async in `useEffect`, `try/catch` → Fallback `"—"`.
- **Commit / Build-Datum:** die von Vite injizierten Konstanten `__GIT_HASH__` /
  `__BUILD_DATE__` (synchron; in Produktion durch `vite.config.ts` gesetzt, im
  Test durch `vitest.config.integration.ts` `define`). Build-Datum wird per
  `replace("T", " ")` menschenlesbar gemacht.
- **OS/Plattform:** `wrapInvoke<OsInfo>("get_os_info")`, gespiegelt vom
  `SystemPanel`-Muster inkl. Guard `if (!("__TAURI_INTERNALS__" in window)) return;`
  und `logError`-Catch → Fallback `"unbekannt"`.

## Backend: `get_os_info` (Rust)

Neuer, minimaler Command — **null neue Dependencies**:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo { os: String, arch: String }

#[tauri::command]
pub fn get_os_info() -> OsInfo {
    OsInfo {
        os: display_os(std::env::consts::OS),     // "macos" -> "macOS", ...
        arch: display_arch(std::env::consts::ARCH) // "aarch64" -> "arm64", ...
    }
}
```

- `display_os`: `"macos"→"macOS"`, `"windows"→"Windows"`, `"linux"→"Linux"`,
  sonst der Rohwert.
- `display_arch`: `"aarch64"→"arm64"`, `"x86_64"→"x64"`, sonst der Rohwert.
- Home: `src-tauri/src/prerequisites.rs` (das bestehende „System-Fakten"-Modul
  neben `check_prerequisites`) — kein neues Modul, um Parallel-Struktur zu
  vermeiden.
- Registrierung: ein Eintrag im `invoke_handler`-Block in `lib.rs`.
- Kein Capability-Eintrag nötig (App-eigene Commands werden nicht über
  Capabilities gegated — `check_prerequisites` hat auch keinen).

## Interaktionen

- **Links + klickbarer Commit-Hash** → `open(url)` aus `@tauri-apps/plugin-shell`
  (Muster: `GitHubViewer.openUrl` mit `logWarn`-Catch). Commit-URL:
  `https://github.com/ARO-LABS/smashq/commit/<hash>`.
- **„Diagnose kopieren"** → `navigator.clipboard.writeText(...)` mit dem Block:

  ```
  Smashq v1.0.23
  Commit: a989923
  Build:  2026-07-10 14:30
  Plattform: macOS · arm64
  ```

  Optimistisches Häkchen-Feedback (2 s), Failure still (Muster
  `KnowledgeSection`).

## Konstanten (zentral im Panel)

```ts
const REPO_URL = "https://github.com/ARO-LABS/smashq";
// issues: `${REPO_URL}/issues`, releases: `${REPO_URL}/releases`,
// commit:  `${REPO_URL}/commit/${hash}`
```

## Tests

**Frontend — `AboutPanel.integration.test.tsx`** (B-Layer, `mockIPC`; **kein**
`vi.mock("@tauri-apps/api/core")`):

- Happy-Path: Version rendert (mockIPC liefert `getVersion`), Commit + Build-Datum
  rendern aus den `define`'ten Konstanten, Plattform rendert aus gemocktem
  `get_os_info`, „Diagnose kopieren" legt den korrekt zusammengesetzten Block in
  `navigator.clipboard.writeText`.
- Links: Klick auf „Problem melden" ruft `open` mit `…/issues`; Klick auf
  Commit-Hash ruft `open` mit `…/commit/<hash>`.
- Edge: `get_os_info` schlägt fehl → Plattform-Zeile zeigt Fallback `"unbekannt"`,
  Panel rendert weiter (kein Crash).

**Backend — `prerequisites.rs`** (Rust-Unit-Test):

- `get_os_info()` liefert nicht-leere `os`/`arch`.
- `display_arch("aarch64") == "arm64"`, `display_os("macos") == "macOS"`
  (Mapping-Happy-Path) + ein unbekannter Rohwert fällt durch (Edge).

## Betroffene Dateien

**Neu:**
- `src/components/settings/panels/AboutPanel.tsx`
- `src/components/settings/panels/AboutPanel.integration.test.tsx`

**Geändert:**
- `src/components/settings/categories.ts` (+1 Kategorie-Eintrag)
- `src-tauri/src/prerequisites.rs` (+`get_os_info` + Mapping-Helfer + Test)
- `src-tauri/src/lib.rs` (+1 Zeile `invoke_handler`)
- `CHANGELOG.md` (`[Unreleased] → ### Hinzugefügt`)

## Quality Gates

- `npx tsc --noEmit && npm run build`
- `npx vitest run` (Frontend, inkl. neuer Integration-Test)
- `cd src-tauri && cargo check && cargo test && cargo clippy -- -D warnings && cargo fmt --check`
- Visuelle Prüfung im gebauten `.app` (lokaler Build, siehe Memory
  `smashq-local-build-no-release`).

## Doku-Hygiene

Diese Spec + der Implementation-Plan sind ephemer und werden im selben Commit
wie der Feature-Merge gelöscht.
