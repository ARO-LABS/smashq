# Default Permission Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein globales, persistiertes `defaultPermissionMode`-Setting (Einstellungen → Sessions) legt fest, mit welchem Claude-CLI-Permission-Modus neue Sessions und Resumes starten.

**Architecture:** Ein geschlossenes Enum (`default`/`auto`/`plan`/`bypass`) fliesst 1:1 wie die bestehende `defaultShell`-Einstellung durch alle Grenzen: settingsStore → NewSessionDefaultsPanel `<select>` → die drei `create_session`-Invokes in useSessionCreation → Tauri-Command `permission_mode: Option<String>` → `manager.create_session` → `shell_args`. Der Modus wird an jeder Grenze aufs Enum validiert; die claude-Kommandozeile wird ausschliesslich aus `&'static str`-Literalen gebaut (kein User-Text erreicht je die Shell).

**Tech Stack:** React 18 + TypeScript + Zustand (persist middleware) im Frontend; Tauri v2 + Rust (portable-pty) im Backend; vitest (Frontend) + cargo test (Rust).

## Global Constraints

- **Modus-Mapping (exakt):** `default` → *(kein Flag)*, `auto` → `--permission-mode auto`, `plan` → `--permission-mode plan`, `bypass` → `--dangerously-skip-permissions`.
- **Persist-Version:** settingsStore `version` 12 → **13**. Validation in BEIDE Hooks: `migrate` (Schema-Bump) UND `merge`/onRehydrate (same-version-Corruption-Recovery, Issue-#209-Klasse).
- **Fail-safe-Richtung:** unbekannter/korrupter Wert → `default` (sicherster Modus), NIEMALS → `bypass`.
- **Security:** `claude_cmd` nur aus `&'static str`-Literalen; Roh-String erreicht ausschliesslich `PermissionMode::from_pref`. Gleiche Haertung wie der bestehende `--resume`-Charset-Guard.
- **Default-Wert:** `"default"` — bewusste Verhaltensaenderung ggü. dem bisherigen Bypass-überall. Bestands-User werden per Migration auf `default` geseedet und im CHANGELOG/Whats-New gewarnt.
- **Design-System:** Deutsche UI-Copy im Imperativ/Infinitiv (kein `du`/`Sie`), kein Emoji. Kein direkter `lucide-react`-Import. Tailwind, `rounded-md`, ein Akzent.
- **Test-Regeln:** Frontend-Integrationstests via `mockIPC`/`installRealIPC` — NIEMALS `vi.mock("@tauri-apps/api/core")` oder Store-Mocks. 1 Happy-Path + 1 Edge-Case pro Feature, Testdatei im selben Commit.
- **Kein Version-Bump in diesem PR:** App-Version + `src/whatsNew.ts` werden erst beim Release-Tag kuratiert (Release-Prozess). Dieser PR liefert nur den CHANGELOG-`[Unreleased]`-Eintrag.

---

## File Structure

| Datei | Verantwortung | Aktion |
|---|---|---|
| `src-tauri/src/session/manager.rs` | `PermissionMode`-Enum, `shell_args`, `create_session` | Modify |
| `src-tauri/src/session/commands.rs` | Tauri-Command-Boundary `create_session` | Modify |
| `src/store/settingsStore.ts` | Persist-Feld `defaultPermissionMode` + Sanitize | Modify |
| `src/store/settingsStore.test.ts` | Sanitize + Setter + Migration Unit-Tests | Modify |
| `src/components/settings/NewSessionDefaultsPanel.tsx` | Modus-`<select>` + Hilfetext | Modify |
| `src/components/settings/NewSessionDefaultsPanel.test.tsx` | Select-Verhalten | Modify |
| `src/components/sessions/hooks/useSessionCreation.ts` | `permissionMode` an 3 Invokes | Modify |
| `src/components/sessions/hooks/useSessionCreation.integration.test.ts` | Pass-through der 3 Pfade | Modify |
| `CHANGELOG.md` | `[Unreleased]`-Eintrag inkl. Verhaltensaenderung | Modify |
| `tasks/todo.md`, `tasks/lessons.md` | Pflege-Trigger | Modify |
| `docs/superpowers/specs/2026-07-09-*.md`, `docs/superpowers/plans/2026-07-09-*.md` | ephemer | Delete (final) |

---

## Task 1: Rust-Backend — PermissionMode-Enum + shell_args + create_session

**Files:**
- Modify: `src-tauri/src/session/manager.rs:112-122` (`create_session`-Signatur), `:180` (shell_args-Aufruf), `:879-921` (`shell_args`), `:1672-1777` (bestehende shell_args-Tests)
- Modify: `src-tauri/src/session/commands.rs:15-70` (`create_session`-Command)

**Interfaces:**
- Produces: `enum PermissionMode { Default, Auto, Plan, Bypass }` mit `PermissionMode::from_pref(&str) -> PermissionMode` (unbekannt → `Default`) und privat `claude_flag(self) -> &'static str`.
- Produces: `shell_args(shell: &str, platform: ShellPlatform, resume_session_id: Option<&str>, mode: PermissionMode) -> Vec<String>`.
- Produces: `SessionManager::create_session(..., shell: String, permission_mode: String, resume_session_id: Option<String>, ...)` — `permission_mode` NEU, direkt nach `shell`.
- Produces: Tauri-Command `create_session(..., shell: Option<String>, permission_mode: Option<String>, resume_session_id: Option<String>, ...)` — JS `permissionMode` (camelCase) mappt auf `permission_mode`.

**Rust-Toolchain:** Vor jedem cargo-Aufruf `source $HOME/.cargo/env` (cargo liegt unter `~/.cargo/bin`).

- [ ] **Step 1: Enum + from_pref-Test schreiben (kompiliert eigenstaendig)**

In `src-tauri/src/session/manager.rs` direkt VOR `fn shell_args(` (~Zeile 879) einfuegen:

```rust
/// Permission-Modus, mit dem eine neue Claude-Session startet. Geschlossenes
/// Enum — der einzige Weg, wie ein User-String die claude-Kommandozeile
/// beeinflusst, ist `from_pref` (mappt Unbekanntes auf den sichersten Modus).
/// So kann selbst ein manipulierter String nur einen der vier festen Flags
/// (oder keinen) erzeugen; Shell-Injection ist strukturell ausgeschlossen —
/// dieselbe Defense-in-depth wie der `--resume`-Charset-Guard unten.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionMode {
    Default,
    Auto,
    Plan,
    Bypass,
}

impl PermissionMode {
    /// Roh-String von der IPC-Grenze → geschlossenes Enum. Fail-safe: alles
    /// Unbekannte (inkl. "default") wird `Default`, NIE `Bypass`.
    pub fn from_pref(s: &str) -> Self {
        match s {
            "auto" => Self::Auto,
            "plan" => Self::Plan,
            "bypass" => Self::Bypass,
            _ => Self::Default,
        }
    }

    /// Nur &'static-str-Literale — kein User-Text erreicht je die Shell.
    /// Fuehrendes Leerzeichen, damit `format!("claude{}", flag)` sauber joint.
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

Im `#[cfg(test)] mod tests`-Block direkt VOR `// --- shell_args ---` (~Zeile 1670) einfuegen:

```rust
    // --- PermissionMode ---

    #[test]
    fn permission_mode_from_pref_maps_known_values() {
        assert_eq!(PermissionMode::from_pref("auto"), PermissionMode::Auto);
        assert_eq!(PermissionMode::from_pref("plan"), PermissionMode::Plan);
        assert_eq!(PermissionMode::from_pref("bypass"), PermissionMode::Bypass);
        assert_eq!(PermissionMode::from_pref("default"), PermissionMode::Default);
    }

    #[test]
    fn permission_mode_from_pref_unknown_falls_back_to_default() {
        // Fail-safe: garbage/empty darf NIE Bypass werden.
        assert_eq!(PermissionMode::from_pref(""), PermissionMode::Default);
        assert_eq!(PermissionMode::from_pref("YOLO"), PermissionMode::Default);
        assert_eq!(PermissionMode::from_pref("--dangerously"), PermissionMode::Default);
    }
```

- [ ] **Step 2: cargo test — Enum-Tests gruen**

Run: `source $HOME/.cargo/env && cd src-tauri && cargo test permission_mode_from_pref`
Expected: PASS (2 Tests). Der Rest kompiliert unveraendert.

- [ ] **Step 3: shell_args um `mode`-Parameter erweitern**

In `src-tauri/src/session/manager.rs` die Signatur (`:879-883`) aendern zu:

```rust
fn shell_args(
    shell: &str,
    platform: ShellPlatform,
    resume_session_id: Option<&str>,
    mode: PermissionMode,
) -> Vec<String> {
```

Den `claude_cmd`-Block (`:900-903`) ersetzen durch:

```rust
    let mode_flag = mode.claude_flag();
    let claude_cmd = match valid_resume {
        Some(id) => format!("claude{} --resume {}", mode_flag, id),
        None => format!("claude{}", mode_flag),
    };
```

- [ ] **Step 4: Aufruf-Stelle + manager.create_session durchreichen**

`shell_args`-Aufruf (`:180`) aendern zu:

```rust
        for arg in shell_args(&shell, platform, resume_session_id.as_deref(), permission_mode) {
```

`SessionManager::create_session`-Signatur (`:112-122`) — `permission_mode: String` direkt nach `shell: String` ergaenzen:

```rust
    pub fn create_session(
        &self,
        app: AppHandle,
        id: String,
        title: String,
        folder: String,
        shell: String,
        permission_mode: String,
        resume_session_id: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<SessionInfo, ADPError> {
```

Direkt nach der `rows`-Aufloesung (~Zeile 127, vor `let platform = ...`) den String zum Enum aufloesen:

```rust
        // Roh-String von der Grenze sofort ins geschlossene Enum — ab hier
        // existiert nur noch der validierte Wert.
        let permission_mode = PermissionMode::from_pref(&permission_mode);
```

- [ ] **Step 5: Tauri-Command um `permission_mode` erweitern**

In `src-tauri/src/session/commands.rs` die `create_session`-Signatur (`:15-25`) — `permission_mode: Option<String>` direkt nach `shell` ergaenzen:

```rust
    pub async fn create_session(
        app: AppHandle,
        manager: State<'_, Arc<SessionManager>>,
        id: String,
        folder: String,
        title: Option<String>,
        shell: Option<String>,
        permission_mode: Option<String>,
        resume_session_id: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<super::super::manager::SessionInfo, ADPError> {
```

Die Default-Aufloesung direkt nach der `shell`-Zeile (`:58`) ergaenzen:

```rust
        // "default" = Claudes eingebautes Nachfragen (kein CLI-Flag).
        let permission_mode = permission_mode.unwrap_or_else(|| "default".to_string());
```

Den `manager.create_session(...)`-Aufruf (`:60-69`) — `permission_mode` nach `shell` einfuegen:

```rust
        manager.create_session(
            app,
            id,
            title,
            folder,
            shell,
            permission_mode,
            resume_session_id,
            initial_cols,
            initial_rows,
        )
```

Die Debug-Log-Zeile (`:26-34`) um `permission_mode` erweitern:

```rust
        log::debug!(
            "create_session called: id={}, folder={}, shell={:?}, permission_mode={:?}, resume={:?}, size={:?}x{:?}",
            id,
            folder,
            shell,
            permission_mode,
            resume_session_id,
            initial_cols,
            initial_rows
        );
```

- [ ] **Step 6: Bestehende 11 shell_args-Tests auf neue Signatur anpassen**

Jeder bestehende `shell_args(...)`-Aufruf im Testblock (`:1674`, `:1687`, `:1699`, `:1714`, `:1728`, `:1735`, `:1744`, `:1750`, `:1758`, `:1765`, `:1772`) bekommt `PermissionMode::Bypass` als 4. Argument — so bleiben ihre erwarteten `--dangerously-skip-permissions`-Strings unveraendert (sie testen Shell-/Resume-/Charset-Plumbing, nicht den Default). Beispiele:

```rust
        let args = shell_args("powershell", ShellPlatform::Windows, None, PermissionMode::Bypass);
```
```rust
            let args = shell_args(shell, ShellPlatform::MacOs, None, PermissionMode::Bypass);
```
```rust
        let args = shell_args("powershell", ShellPlatform::Windows, Some("abc-123_XY"), PermissionMode::Bypass);
```

(Analog fuer alle 11 Aufrufe: viertes Argument `PermissionMode::Bypass` anhaengen, sonst nichts aendern.)

- [ ] **Step 7: Neue Modus-Mapping-Tests schreiben**

Direkt nach dem letzten shell_args-Test (`shell_args_uuid_style_resume_id_accepted`, ~Zeile 1777) einfuegen:

```rust
    #[test]
    fn shell_args_default_mode_emits_no_flag() {
        let args = shell_args("powershell", ShellPlatform::Windows, None, PermissionMode::Default);
        assert_eq!(args[2], "claude");
    }

    #[test]
    fn shell_args_auto_mode_emits_permission_flag() {
        let args = shell_args("powershell", ShellPlatform::Windows, None, PermissionMode::Auto);
        assert_eq!(args[2], "claude --permission-mode auto");
    }

    #[test]
    fn shell_args_plan_mode_emits_permission_flag() {
        let args = shell_args("powershell", ShellPlatform::Windows, None, PermissionMode::Plan);
        assert_eq!(args[2], "claude --permission-mode plan");
    }

    #[test]
    fn shell_args_bypass_mode_emits_dangerous_flag() {
        let args = shell_args("powershell", ShellPlatform::Windows, None, PermissionMode::Bypass);
        assert_eq!(args[2], "claude --dangerously-skip-permissions");
    }

    #[test]
    fn shell_args_mode_and_resume_combine() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("abc-123_XY"),
            PermissionMode::Auto,
        );
        assert_eq!(args[2], "claude --permission-mode auto --resume abc-123_XY");
    }

    #[test]
    fn shell_args_default_mode_and_resume_combine() {
        let args = shell_args(
            "powershell",
            ShellPlatform::Windows,
            Some("abc-123_XY"),
            PermissionMode::Default,
        );
        assert_eq!(args[2], "claude --resume abc-123_XY");
    }
```

- [ ] **Step 8: cargo test + fmt + clippy — alles gruen**

Run: `source $HOME/.cargo/env && cd src-tauri && cargo test session::manager && cargo fmt --check && cargo clippy -- -D warnings`
Expected: Alle Tests PASS (11 angepasste + 8 neue), fmt clean, keine clippy-Warnungen.
Falls `cargo fmt --check` meckert: `cargo fmt` laufen lassen.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/session/manager.rs src-tauri/src/session/commands.rs
git commit -m "feat(tauri): thread permission mode into claude session command (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: settingsStore — persistiertes `defaultPermissionMode`-Feld

**Files:**
- Modify: `src/store/settingsStore.ts` (Union+Sanitize ~`:107`, Interface `:280`, Setter-Typ `:324`, migrate-defaults `:582`, migrate-coercion `:698`, Store-Default `:793`, Setter-Impl `:1021`, merge-heal `:1364`, resetToDefaults `:1295`, partialize `:1331`, version `:1352`)
- Modify: `src/store/settingsStore.test.ts`

**Interfaces:**
- Consumes: nichts (Basis-Task).
- Produces: `export const PERMISSION_MODES = ["default","auto","plan","bypass"] as const;`
- Produces: `export type PermissionMode = (typeof PERMISSION_MODES)[number];`
- Produces: `export function sanitizePermissionMode(value: unknown): PermissionMode`
- Produces: `SettingsState.defaultPermissionMode: PermissionMode` + `setDefaultPermissionMode(mode: PermissionMode): void`.

- [ ] **Step 1: Failing Test fuer sanitize + setter schreiben**

In `src/store/settingsStore.test.ts` einen Import ergaenzen und einen describe-Block anhaengen:

```ts
import { sanitizePermissionMode, PERMISSION_MODES } from "./settingsStore";
```

```ts
describe("defaultPermissionMode", () => {
  it("sanitizePermissionMode accepts all four known modes", () => {
    for (const mode of PERMISSION_MODES) {
      expect(sanitizePermissionMode(mode)).toBe(mode);
    }
  });

  it("sanitizePermissionMode falls back to 'default' for junk", () => {
    expect(sanitizePermissionMode("bypassPermissions")).toBe("default");
    expect(sanitizePermissionMode(undefined)).toBe("default");
    expect(sanitizePermissionMode(42)).toBe("default");
    expect(sanitizePermissionMode(null)).toBe("default");
    expect(sanitizePermissionMode("")).toBe("default");
  });

  it("setDefaultPermissionMode updates the store", () => {
    useSettingsStore.getState().setDefaultPermissionMode("bypass");
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("bypass");
  });

  it("defaults to 'default' on a fresh store", () => {
    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("default");
  });
});
```

- [ ] **Step 2: Test laeuft ROT (Symbol existiert nicht)**

Run: `npx vitest run src/store/settingsStore.test.ts -t "defaultPermissionMode"`
Expected: FAIL — `sanitizePermissionMode is not a function` / `PERMISSION_MODES` undefined.

- [ ] **Step 3: Union + Sanitize-Helper ergaenzen**

In `src/store/settingsStore.ts` direkt NACH `sanitizeScrollbackLines` (nach Zeile 107) einfuegen:

```ts
/** Erlaubte Permission-Modi fuer neue Sessions (Settings-UI + Persist). */
export const PERMISSION_MODES = ["default", "auto", "plan", "bypass"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * Coerce a persisted/UI permission-mode candidate to a known mode. Fail-safe
 * to "default" (Claudes Nachfragen) — NIE zu "bypass" — bei Unbekanntem,
 * falschem Typ oder fehlendem Feld. Geteilt zwischen Store-Default, migrate
 * und merge/onRehydrate (Issue-#209-Klasse).
 */
export function sanitizePermissionMode(value: unknown): PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value as string)
    ? (value as PermissionMode)
    : "default";
}
```

- [ ] **Step 4: Interface + Setter-Typ ergaenzen**

Nach `defaultShell: "auto" | "powershell" | "bash" | "cmd" | "zsh";` (`:280`) einfuegen:

```ts
  defaultPermissionMode: PermissionMode;
```

Nach `setDefaultShell: (shell: SettingsState["defaultShell"]) => void;` (`:324`) einfuegen:

```ts
  setDefaultPermissionMode: (mode: PermissionMode) => void;
```

- [ ] **Step 5: migrate-defaults + migrate-coercion ergaenzen**

Im migrate-defaults-Objekt nach `defaultShell: "auto" as const,` (`:582`) einfuegen:

```ts
    defaultPermissionMode: "default" as const,
```

In der migrate-Coercion nach der `defaultShell:`-Zeile (`:698`) einfuegen:

```ts
    defaultPermissionMode: sanitizePermissionMode(p.defaultPermissionMode),
```

- [ ] **Step 6: Store-Default + Setter-Impl ergaenzen**

Im Store-Initial-State nach `defaultShell: "auto",` (`:793`) einfuegen:

```ts
      defaultPermissionMode: "default",
```

Nach `setDefaultShell: (shell) => set({ defaultShell: shell }),` (`:1021`) einfuegen:

```ts
      setDefaultPermissionMode: (mode) => set({ defaultPermissionMode: mode }),
```

- [ ] **Step 7: resetToDefaults + partialize + merge-heal + version-bump**

In `resetToDefaults` nach `defaultShell: "auto",` (`:1295`) einfuegen:

```ts
          defaultPermissionMode: "default",
```

In `partialize` nach `defaultShell: state.defaultShell,` (`:1331`) einfuegen:

```ts
        defaultPermissionMode: state.defaultPermissionMode,
```

Im `merge`-Return (`:1364-1368`) das geheilte Feld ergaenzen (same-version-Corruption-Recovery — geht ueber `defaultShell` hinaus, das nur in migrate heilt; hier bewusst robuster gemaess CLAUDE.md "Validation in BEIDE Hooks"):

```ts
        return {
          ...merged,
          favorites: validated.favorites,
          favoriteGroups: validated.favoriteGroups,
          defaultPermissionMode: sanitizePermissionMode(merged.defaultPermissionMode),
        };
```

Die Persist-`version` (`:1352`) von `12` auf `13` erhoehen und den Kommentarblock darueber (nach der v12-Zeile, vor `version: 13,`) ergaenzen:

```ts
      // v13: added defaultPermissionMode (neue Sessions starten mit gewaehltem
      // Permission-Modus, default "default" = Claudes Nachfragen). Migrate
      // sanitizt via sanitizePermissionMode; merge heilt same-version-Corruption.
      // Bewusste Verhaltensaenderung: Bestands-User (bisher hart Bypass) werden
      // auf "default" geseedet — siehe CHANGELOG.
      version: 13,
```

- [ ] **Step 8: Migrations-Test (v12-Blob ohne Feld → default) schreiben**

In `src/store/settingsStore.test.ts` (nutzt den vorhandenen `useSettingsStoreMigrateForTest`-Export — ggf. Import ergaenzen) im `defaultPermissionMode`-describe anhaengen:

```ts
  it("migrate seeds 'default' for a v12 blob without the field", () => {
    const migrated = useSettingsStoreMigrateForTest(
      { defaultShell: "zsh" },
      12,
    );
    expect(migrated.defaultPermissionMode).toBe("default");
  });

  it("migrate coerces a corrupt persisted value to 'default'", () => {
    const migrated = useSettingsStoreMigrateForTest(
      { defaultPermissionMode: "bypassPermissions" },
      12,
    );
    expect(migrated.defaultPermissionMode).toBe("default");
  });

  it("migrate preserves a valid persisted mode", () => {
    const migrated = useSettingsStoreMigrateForTest(
      { defaultPermissionMode: "bypass" },
      12,
    );
    expect(migrated.defaultPermissionMode).toBe("bypass");
  });
```

Import oben in der Testdatei sicherstellen:

```ts
import { useSettingsStoreMigrateForTest } from "./settingsStore";
```

- [ ] **Step 9: Tests + tsc gruen**

Run: `npx vitest run src/store/settingsStore.test.ts && npx tsc --noEmit`
Expected: PASS (alle neuen Tests), tsc ohne Fehler.

- [ ] **Step 10: Commit**

```bash
git add src/store/settingsStore.ts src/store/settingsStore.test.ts
git commit -m "feat(store): persist defaultPermissionMode setting (v13 migration) (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: NewSessionDefaultsPanel — Modus-`<select>`

**Files:**
- Modify: `src/components/settings/NewSessionDefaultsPanel.tsx` (Store-Wiring `:60-64`, JSX innerhalb der `<section>` `:104-160`)
- Modify: `src/components/settings/NewSessionDefaultsPanel.test.tsx`

**Interfaces:**
- Consumes (aus Task 2): `useSettingsStore` Felder `defaultPermissionMode` + `setDefaultPermissionMode`, Typ `PermissionMode`.
- Produces: ein `<select id="default-permission-mode">` mit 4 Optionen + aktivem Hilfetext.

- [ ] **Step 1: Failing Test schreiben**

In `src/components/settings/NewSessionDefaultsPanel.test.tsx` den `beforeEach`-Store-Seed (`:19-22`) um `defaultPermissionMode: "default"` ergaenzen und einen Test anhaengen:

```ts
  it("renders the four permission modes and persists a selection", () => {
    render(<NewSessionDefaultsPanel />);
    const select = screen.getByLabelText(/Permission-Modus/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "default",
      "auto",
      "plan",
      "bypass",
    ]);
    fireEvent.change(select, { target: { value: "bypass" } });
    expect(useSettingsStore.getState().defaultPermissionMode).toBe("bypass");
  });

  it("shows the hint of the active permission mode", () => {
    useSettingsStore.setState({ defaultPermissionMode: "bypass" });
    render(<NewSessionDefaultsPanel />);
    expect(screen.getByText(/Überspringt alle Nachfragen/i)).toBeTruthy();
  });
```

- [ ] **Step 2: Test laeuft ROT (Label nicht gefunden)**

Run: `npx vitest run src/components/settings/NewSessionDefaultsPanel.test.tsx -t "permission"`
Expected: FAIL — `Unable to find a label with the text of: /Permission-Modus/i`.

- [ ] **Step 3: Options-Konstante + Store-Wiring ergaenzen**

In `NewSessionDefaultsPanel.tsx` den Typ-Import (`:3`) um `PermissionMode` erweitern:

```ts
import { useSettingsStore, type SettingsState, type PermissionMode } from "../../store/settingsStore";
```

Nach der `FALLBACK_SHELL_OPTIONS`-Deklaration (nach `:29`) die Optionsliste ergaenzen:

```ts
const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "default", label: "Standard (Nachfragen)", hint: "Claude fragt vor jeder Aktion nach." },
  { value: "auto", label: "Auto", hint: "Erlaubt Aktionen automatisch, außer bei Konflikten." },
  { value: "plan", label: "Plan", hint: "Startet im Planungsmodus ohne Änderungen." },
  { value: "bypass", label: "Bypass / YOLO", hint: "Überspringt alle Nachfragen (bisheriges Verhalten)." },
];
```

Im Komponenten-Body nach den bestehenden Store-Selektoren (`:60-64`) ergaenzen:

```ts
  const defaultPermissionMode = useSettingsStore((s) => s.defaultPermissionMode);
  const setDefaultPermissionMode = useSettingsStore((s) => s.setDefaultPermissionMode);
  const activeModeHint =
    PERMISSION_MODE_OPTIONS.find((o) => o.value === defaultPermissionMode)?.hint ?? "";
```

- [ ] **Step 4: `<select>`-Block ins JSX einfuegen**

Innerhalb der `<section>` (`:104`), direkt NACH dem schliessenden `</div>` des Standard-Shell-Blocks (nach `:126`) und VOR dem Standard-Projektordner-Block (`:128`) einfuegen:

```tsx
        <div className="flex flex-col gap-1.5">
          <label htmlFor="default-permission-mode" className="text-xs font-medium text-neutral-300">
            Permission-Modus
          </label>
          <select
            id="default-permission-mode"
            value={defaultPermissionMode}
            onChange={(e) => setDefaultPermissionMode(e.target.value as PermissionMode)}
            className="w-full rounded-md bg-surface-raised shadow-hairline text-neutral-200 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent focus:ring-inset transition-shadow duration-150"
          >
            {PERMISSION_MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-neutral-500">{activeModeHint}</p>
        </div>
```

- [ ] **Step 5: Tests + tsc gruen**

Run: `npx vitest run src/components/settings/NewSessionDefaultsPanel.test.tsx && npx tsc --noEmit`
Expected: PASS (bestehende + 2 neue Tests), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/NewSessionDefaultsPanel.tsx src/components/settings/NewSessionDefaultsPanel.test.tsx
git commit -m "feat(ui): permission-mode selector in new-session defaults (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: useSessionCreation — `permissionMode` an alle drei Invokes

**Files:**
- Modify: `src/components/sessions/hooks/useSessionCreation.ts` (Resume `:64-100`, QuickStart `:105-143`, NewFromDefaults `:150-222`)
- Modify: `src/components/sessions/hooks/useSessionCreation.integration.test.ts`

**Interfaces:**
- Consumes (aus Task 2): `useSettingsStore.getState().defaultPermissionMode`.
- Consumes (aus Task 1): der Tauri-Command akzeptiert das `permissionMode`-Feld (camelCase → snake_case).
- Produces: keine neuen Symbole; alle drei `wrapInvoke("create_session", {...})` uebergeben `permissionMode`.

- [ ] **Step 1: Failing Integration-Tests schreiben**

In `src/components/sessions/hooks/useSessionCreation.integration.test.ts` innerhalb `describe("useSessionCreation.handleNewSessionFromDefaults — Layer-B", ...)` anhaengen:

```ts
  it("passes the global defaultPermissionMode through to create_session", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");
    useSettingsStore.getState().setDefaultPermissionMode("auto");

    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].permissionMode).toBe("auto");
  });

  it("defaults permissionMode to 'default' when unset", async () => {
    useSettingsStore.getState().setDefaultProjectPath("C:\\Projects\\test");

    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleNewSessionFromDefaults();
    });

    expect(calls[0].permissionMode).toBe("default");
  });
```

Innerhalb `describe("useSessionCreation.handleQuickStart — Layer-B ...", ...)` anhaengen:

```ts
  it("passes the global defaultPermissionMode through on quick-start", async () => {
    useSettingsStore.getState().setDefaultPermissionMode("plan");
    const { handler, calls } = buildCreateSessionHandler();
    installRealIPC({ create_session: handler });

    const { result } = renderHook(() => useSessionCreation());
    await act(async () => {
      await result.current.handleQuickStart(favorite);
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].permissionMode).toBe("plan");
  });
```

(`useSettingsStore` ist in dieser Datei bereits importiert; der `favorite`-Fixture existiert im QuickStart-describe.)

- [ ] **Step 2: Tests laufen ROT**

Run: `npx vitest run src/components/sessions/hooks/useSessionCreation.integration.test.ts -t "permissionMode"`
Expected: FAIL — `calls[0].permissionMode` ist `undefined`.

- [ ] **Step 3: Resume-Pfad verdrahten**

In `handleResumeSession` (`:64`) nach `const shell = "auto";` (`:70`) einfuegen:

```ts
      const permissionMode = useSettingsStore.getState().defaultPermissionMode;
```

Das Invoke-Objekt (`:73-79`) um `permissionMode` erweitern:

```ts
        const result = await wrapInvoke<CreateSessionResult>("create_session", {
          id,
          folder: cwd,
          title,
          shell,
          permissionMode,
          resumeSessionId,
        });
```

- [ ] **Step 4: QuickStart-Pfad verdrahten**

In `handleQuickStart` (`:105`) nach `const shell = favorite.shell;` (`:109`) einfuegen:

```ts
    const permissionMode = useSettingsStore.getState().defaultPermissionMode;
```

Das Invoke-Objekt (`:112-117`) erweitern:

```ts
      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id,
        folder,
        title,
        shell,
        permissionMode,
      });
```

- [ ] **Step 5: NewFromDefaults-Pfad verdrahten**

In `handleNewSessionFromDefaults` (`:150`) — `settings` ist bereits als `useSettingsStore.getState()` (`:151`) vorhanden. Nach `const shell = settings.defaultShell;` (`:174`) einfuegen:

```ts
    const permissionMode = settings.defaultPermissionMode;
```

Das Invoke-Objekt (`:178-183`) erweitern:

```ts
      const result = await wrapInvoke<CreateSessionResult>("create_session", {
        id,
        folder,
        title,
        shell,
        permissionMode,
      });
```

- [ ] **Step 6: Tests + tsc gruen**

Run: `npx vitest run src/components/sessions/hooks/useSessionCreation.integration.test.ts && npx tsc --noEmit`
Expected: PASS (bestehende + 3 neue Tests), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/sessions/hooks/useSessionCreation.ts src/components/sessions/hooks/useSessionCreation.integration.test.ts
git commit -m "feat(store): pass defaultPermissionMode to all create_session calls (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Doku, CHANGELOG, Pflege-Trigger, Cleanup + PR

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `tasks/todo.md`, `tasks/lessons.md`
- Delete: `docs/superpowers/specs/2026-07-09-default-permission-mode-design.md`, `docs/superpowers/plans/2026-07-09-default-permission-mode.md`

- [ ] **Step 1: CHANGELOG `[Unreleased]` ergaenzen**

Unter `## [Unreleased]` in `CHANGELOG.md` (Keep-a-Changelog, deutsch) ergaenzen — die Verhaltensaenderung MUSS unter „Geaendert" prominent stehen:

```markdown
### Hinzugefuegt
- Einstellbarer **Permission-Modus fuer neue Sessions** (Einstellungen → Sessions): Standard (Nachfragen), Auto, Plan oder Bypass / YOLO. Gilt fuer neue Sessions und Resumes. (#11)

### Geaendert
- **Verhaltensaenderung:** Neue Sessions starten jetzt standardmaessig im Modus **Standard (Nachfragen)** statt wie bisher mit `--dangerously-skip-permissions`. Wer das bisherige Verhalten will, stellt den Modus einmalig auf **Bypass / YOLO** (Einstellungen → Sessions). (#11)

### Sicherheit
- Der Permission-Modus wird an jeder Grenze auf ein geschlossenes Enum validiert; die claude-Kommandozeile wird nur aus festen Literalen gebaut (kein Roh-Text erreicht die Shell). (#11)
```

- [ ] **Step 2: Pflege-Trigger — tasks/todo.md + lessons.md**

`tasks/todo.md`: Issue #11 als aktive Phase auf „erledigt/in Review" setzen bzw. den Backlog-Eintrag schliessen (an vorhandener Struktur orientieren).
`tasks/lessons.md`: eine Lesson im Format Fehler → Korrektur → Regel ergaenzen:

```markdown
- **Permission-Flag hart in shell_args (nur Bypass):** Der einzige claude-Start-Pfad kodierte `--dangerously-skip-permissions` fest. → Korrektur: Modus als geschlossenes `PermissionMode`-Enum durch alle Grenzen (Store → 3 Invokes → Command → shell_args), Kommandozeile nur aus `&'static str`. → Regel: User-beeinflusste CLI-Flags NIE als Roh-String interpolieren — immer erst in ein geschlossenes Enum mappen (Unbekanntes → sicherster Wert), dann feste Literale emittieren. Gilt wie beim `--resume`-Charset-Guard.
```

- [ ] **Step 3: Ephemere Spec/Plan loeschen (Doku-Hygiene)**

```bash
git rm docs/superpowers/specs/2026-07-09-default-permission-mode-design.md docs/superpowers/plans/2026-07-09-default-permission-mode.md
```

- [ ] **Step 4: Volle Gates**

Run: `npx tsc --noEmit && npm run build && npx vitest run && source $HOME/.cargo/env && cd src-tauri && cargo test && cargo clippy -- -D warnings && cargo fmt --check`
Expected: TS-Check clean, Build gruen, alle vitest-Tests PASS, cargo test PASS, clippy clean, fmt clean.

- [ ] **Step 5: Commit + PR**

```bash
git add CHANGELOG.md tasks/todo.md tasks/lessons.md
git commit -m "docs(session): document default permission mode + behavior change (#11)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push -u origin feat/issue-11-default-permission-mode
```

PR-Body (Highlights + „Worauf achten") via `gh pr create`. Muss enthalten:
- Was: einstellbarer Permission-Modus (4 Modi), gilt fuer neue Sessions + Resumes.
- **Verhaltensaenderung** klar markiert (Default Bypass → Nachfragen; Bestands-User seedet Migration auf `default`).
- Security-Note (Enum-Mapping, feste Literale).
- Hinweis fuer den Release: App-Version bumpen + `src/whatsNew.ts`-Watchout kuratieren beim naechsten Tag (kein Version-Bump in diesem PR).
- Abschluss: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## Self-Review

**Spec coverage:** Modus→Flag-Mapping (Task 1), Storage/Migration v13 (Task 2), UI-Select (Task 3), 3-Invoke-Threading (Task 4), Security-Enum an allen Grenzen (Task 1+2), Verhaltensaenderung + CHANGELOG (Task 5), Tests je Ebene (Tasks 1-4). Alle Spec-Abschnitte haben eine Task. ✔

**Placeholder scan:** Keine TBD/TODO; jeder Code-Step zeigt vollstaendigen Code, jeder Test-Step echten Testcode. ✔

**Type consistency:** `PermissionMode`-Werte (`default|auto|plan|bypass`) identisch in TS-Union, Rust-`from_pref` und claude-Flags. `setDefaultPermissionMode(mode: PermissionMode)` konsistent zwischen Interface (Task 2 Step 4), Impl (Step 6) und UI-Consumer (Task 3 Step 3). Invoke-Feld heisst ueberall `permissionMode` (camelCase), Rust-Param `permission_mode` (snake_case) — Tauri-v2-Mapping wie bei `resumeSessionId`/`resume_session_id`. ✔
