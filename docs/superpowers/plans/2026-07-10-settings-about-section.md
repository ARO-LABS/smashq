# About-Section in den Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine neue Settings-Kategorie „Über" zeigt App-Version, Build-Herkunft (Commit, Datum), Plattform und projektbezogene Links, mit „Diagnose kopieren" für Bug-Reports.

**Architecture:** Neues lazy-geladenes Panel `AboutPanel.tsx` (Muster wie `SystemPanel`), verdrahtet über einen Eintrag in `categories.ts`. Dynamische Felder: Version via `getVersion()`, Commit/Build-Datum via Vite-injizierte Konstanten (`__GIT_HASH__`/`__BUILD_DATE__`), Plattform via neuem, dependency-freiem Rust-Command `get_os_info` (`std::env::consts`, Backend = Plattform-Autorität, mockIPC-testbar).

**Tech Stack:** React 18 + TypeScript, Zustand-freies Panel (nur lokaler State), Tauri v2 (`@tauri-apps/api/app`, `@tauri-apps/plugin-shell`), Rust (`std::env::consts`, `serde`), Vitest B-Layer (`mockIPC`), `cargo test`.

## Global Constraints

- **Null neue Dependencies** (kein `@tauri-apps/plugin-os`, keine neue Crate), **keine** Capability-Änderung (`shell:allow-open` + `clipboard-manager:allow-write-text` existieren bereits).
- **Kein** Updater-Pfad berühren, **kein** Version-Bump, **keine** OS-Versionsnummer (`15.5`).
- Deutsche UI-Copy, echte Umlaute (`Über`, `für`), kein `du`/`Sie`, kein Emoji.
- Design-System: `rounded-md`/`rounded-xs`, ein Akzent (azure), Panel-Struktur `flex flex-col gap-6 p-6 max-w-2xl`, Sub-Header `h4` uppercase `tracking-wide`, Icons nur via `ICONS.*`/`ICON_SIZE.*`, Fokus-Ring `focus-visible:ring-2 focus-visible:ring-accent/50` nie unterdrücken.
- Integration-Tests: **nur** `mockIPC` via `installRealIPC`, **niemals** `vi.mock("@tauri-apps/api/core")` oder Store-Mocks. Dateiname endet auf `.integration.test.tsx`.
- Backend-Commands leben im `pub mod commands {}`-Block (E0255-Workaround), Registrierung zentral in `lib.rs` `invoke_handler`.

---

### Task 1: Backend-Command `get_os_info` (Rust)

**Files:**
- Modify: `src-tauri/src/prerequisites.rs` (struct + Mapping-Helfer + Command im `commands`-Block + Tests)
- Modify: `src-tauri/src/lib.rs:329` (Registrierung im `invoke_handler`)

**Interfaces:**
- Produces: Tauri-Command `get_os_info` → JSON `{ os: string, arch: string }` (camelCase). Rust: `pub struct OsInfo { os: String, arch: String }`, `fn display_os(&str) -> String`, `fn display_arch(&str) -> String`, `pub fn get_os_info() -> OsInfo` (in `prerequisites::commands`).

- [ ] **Step 1: Failing-Tests schreiben** — hänge diese Tests in den bestehenden `#[cfg(test)] mod tests` Block am Ende von `src-tauri/src/prerequisites.rs` an (nach dem letzten `#[test]`, vor der schließenden `}` des `mod tests`):

```rust
    #[test]
    fn display_os_maps_known_targets() {
        assert_eq!(display_os("macos"), "macOS");
        assert_eq!(display_os("windows"), "Windows");
        assert_eq!(display_os("linux"), "Linux");
    }

    #[test]
    fn display_os_passes_through_unknown() {
        assert_eq!(display_os("freebsd"), "freebsd");
    }

    #[test]
    fn display_arch_maps_known_targets() {
        assert_eq!(display_arch("aarch64"), "arm64");
        assert_eq!(display_arch("x86_64"), "x64");
    }

    #[test]
    fn display_arch_passes_through_unknown() {
        assert_eq!(display_arch("riscv64"), "riscv64");
    }

    #[test]
    fn os_info_is_non_empty_and_serializes_camel_case() {
        let info = commands::get_os_info();
        assert!(!info.os.is_empty());
        assert!(!info.arch.is_empty());
        let json = serde_json::to_value(&info).unwrap();
        assert!(json.get("os").is_some());
        assert!(json.get("arch").is_some());
    }
```

- [ ] **Step 2: Test-Lauf → muss fehlschlagen (Kompilierfehler)**

Run: `cd src-tauri && source "$HOME/.cargo/env" && cargo test --lib prerequisites`
Expected: FAIL — `cannot find function display_os` / `no function get_os_info in module commands`.

- [ ] **Step 3: Struct + Mapping-Helfer implementieren** — füge in `src-tauri/src/prerequisites.rs` direkt **nach** dem `PrerequisiteStatus`-Struct (vor `fn build_status`) ein:

```rust
/// Host OS family + CPU architecture for the Settings "About" panel. Values are
/// `std::env::consts` compile-time facts — a desktop bundle is built per target,
/// so they accurately describe the running binary. Intentionally no OS *version*
/// number (that would need an extra crate); the About panel shows family + arch.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsInfo {
    pub os: String,
    pub arch: String,
}

/// Map `std::env::consts::OS` to a human label; unknown values pass through.
fn display_os(os: &str) -> String {
    match os {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
    .to_string()
}

/// Map `std::env::consts::ARCH` to a human label; unknown values pass through.
fn display_arch(arch: &str) -> String {
    match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        other => other,
    }
    .to_string()
}
```

- [ ] **Step 4: Command implementieren** — füge innerhalb des bestehenden `pub mod commands { ... }`-Blocks (nach `check_prerequisites`) ein:

```rust
    /// Host OS family + CPU architecture for the Settings "About" panel.
    /// Pure compile-time facts — no side effects, no PATH probing.
    #[tauri::command]
    pub fn get_os_info() -> OsInfo {
        OsInfo {
            os: display_os(std::env::consts::OS),
            arch: display_arch(std::env::consts::ARCH),
        }
    }
```

- [ ] **Step 5: Command registrieren** — in `src-tauri/src/lib.rs`, direkt nach Zeile `prerequisites::commands::check_prerequisites,` (aktuell Zeile 329) hinzufügen:

```rust
            prerequisites::commands::get_os_info,
```

- [ ] **Step 6: Tests + Gates → müssen bestehen**

Run: `cd src-tauri && source "$HOME/.cargo/env" && cargo test --lib prerequisites && cargo clippy -- -D warnings && cargo fmt --check`
Expected: PASS (5 neue Tests grün, kein Clippy-Warning, fmt sauber).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/prerequisites.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): get_os_info command for About panel (os + arch)"
```

---

### Task 2: `AboutPanel`-Komponente + Integration-Test (Frontend)

**Files:**
- Create: `src/components/settings/panels/AboutPanel.tsx`
- Create: `src/components/settings/panels/AboutPanel.integration.test.tsx`

**Interfaces:**
- Consumes: Command `get_os_info` → `{ os, arch }` (aus Task 1). Konstanten `__GIT_HASH__`, `__BUILD_DATE__` (Vite-inject; im Test via `vitest.config.integration.ts` `define`). `getVersion()` (`plugin:app|version`), `open()` (`plugin:shell|open`).
- Produces: `export function AboutPanel()` (React FC, benannter Export — für Task 3).

- [ ] **Step 1: Failing Integration-Test schreiben** — erstelle `src/components/settings/panels/AboutPanel.integration.test.tsx`:

```tsx
/**
 * Layer-B integration test for AboutPanel.
 *
 * Real IPC via mockIPC (never vi.mock on core). The panel reads the app version
 * (plugin:app|version), the platform (get_os_info) and opens external URLs
 * (plugin:shell|open). Build constants come from vitest.config.integration.ts's
 * `define` (__GIT_HASH__="test", __BUILD_DATE__="2026-01-01T00:00").
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { AboutPanel } from "./AboutPanel";
import { installRealIPC, clearTauriIPC } from "../../../test/mockTauriIPC";

afterEach(() => {
  clearTauriIPC();
  vi.restoreAllMocks();
});

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  return writeText;
}

const baseHandlers = {
  "plugin:app|version": async () => "9.9.9",
  get_os_info: async () => ({ os: "macOS", arch: "arm64" }),
};

describe("AboutPanel — Layer-B", () => {
  it("renders version, commit, build date and platform", async () => {
    installRealIPC({ ...baseHandlers });

    render(<AboutPanel />);

    await waitFor(() => expect(screen.getByText("9.9.9")).toBeTruthy());
    expect(screen.getByText("test")).toBeTruthy(); // __GIT_HASH__
    expect(screen.getByText("2026-01-01 00:00")).toBeTruthy(); // __BUILD_DATE__ (T→space)
    await waitFor(() => expect(screen.getByText("macOS · arm64")).toBeTruthy());
  });

  it("copies a diagnostics block to the clipboard", async () => {
    const writeText = stubClipboard();
    installRealIPC({ ...baseHandlers });

    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("macOS · arm64")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Diagnose kopieren/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain("Smashq v9.9.9");
    expect(copied).toContain("Commit: test");
    expect(copied).toContain("Plattform: macOS · arm64");
  });

  it("opens the issues URL when 'Problem melden' is clicked", async () => {
    const openCalls: string[] = [];
    installRealIPC({
      ...baseHandlers,
      "plugin:shell|open": async (args) => {
        openCalls.push(String(args.path));
        return null;
      },
    });

    render(<AboutPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /Problem melden/i }));

    await waitFor(() =>
      expect(openCalls).toContain("https://github.com/ARO-LABS/smashq/issues"),
    );
  });

  it("falls back to 'unbekannt' when get_os_info fails", async () => {
    installRealIPC({
      "plugin:app|version": async () => "9.9.9",
      get_os_info: async () => {
        throw new Error("no backend");
      },
    });

    render(<AboutPanel />);
    await waitFor(() => expect(screen.getByText("9.9.9")).toBeTruthy());
    expect(screen.getByText("unbekannt")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Test-Lauf → muss fehlschlagen**

Run: `npx vitest run --config vitest.config.integration.ts src/components/settings/panels/AboutPanel.integration.test.tsx`
Expected: FAIL — `Cannot find module './AboutPanel'`.

- [ ] **Step 3: `AboutPanel` implementieren** — erstelle `src/components/settings/panels/AboutPanel.tsx`:

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { wrapInvoke } from "../../../utils/perfLogger";
import { logError, logWarn } from "../../../utils/errorLogger";
import { ICONS, ICON_SIZE } from "../../../utils/icons";
import { Button } from "../../ui/Button";

const ExternalLinkIcon = ICONS.action.externalLink;
const CopyIcon = ICONS.action.copy;
const CheckIcon = ICONS.tasks.check;

const REPO_URL = "https://github.com/ARO-LABS/smashq";
const ISSUES_URL = `${REPO_URL}/issues`;
const RELEASES_URL = `${REPO_URL}/releases`;

// Build-time constants injected by Vite (vite.config.ts); mirrored in
// vitest.config.integration.ts's `define` for tests.
const COMMIT = __GIT_HASH__;
const BUILD_DATE = __BUILD_DATE__.replace("T", " ");

/** Mirrors the Rust `OsInfo` (camelCase). */
interface OsInfo {
  os: string;
  arch: string;
}

/** Open an external URL via the shell plugin; failure is logged, never fatal. */
async function openUrl(url: string) {
  try {
    await open(url);
  } catch {
    logWarn("AboutPanel", `shell.open failed for: ${url}`);
  }
}

export function AboutPanel() {
  const [version, setVersion] = useState("—");
  const [platform, setPlatform] = useState("unbekannt");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch((err) => logError("AboutPanel.getVersion", err));

    // OS facts come from the backend (platform authority), mirroring SystemPanel.
    // Outside Tauri (browser dev / jsdom without mockIPC) there is no backend.
    if (!("__TAURI_INTERNALS__" in window)) return;
    wrapInvoke<OsInfo>("get_os_info")
      .then((info) => setPlatform(`${info.os} · ${info.arch}`))
      .catch((err) => logError("AboutPanel.getOsInfo", err));
  }, []);

  const commitUrl = `${REPO_URL}/commit/${COMMIT}`;
  const diagnostics =
    `Smashq v${version}\n` +
    `Commit: ${COMMIT}\n` +
    `Build:  ${BUILD_DATE}\n` +
    `Plattform: ${platform}`;

  // Copy-to-clipboard with optimistic check feedback; failure silent (same
  // contract as KnowledgeSection — a toast is overkill for a Tauri-webview copy).
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // leave UI unchanged
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold text-neutral-200">Über Smashq</h3>
          <span className="text-xs font-mono text-neutral-500">v{version}</span>
        </div>
        <p className="text-xs text-neutral-500">
          Claude-CLI-Sessions verwalten und überwachen.
        </p>
      </header>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
          Build-Info
        </h4>
        <dl className="flex flex-col gap-2 text-sm">
          <InfoRow label="Version" value={version} />
          <InfoRow
            label="Commit"
            value={
              <button
                type="button"
                onClick={() => openUrl(commitUrl)}
                className="text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs"
              >
                {COMMIT}
              </button>
            }
          />
          <InfoRow label="Build-Datum" value={BUILD_DATE} />
          <InfoRow label="Plattform" value={platform} />
        </dl>
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            icon={
              copied ? (
                <CheckIcon className={`${ICON_SIZE.card} text-success`} />
              ) : (
                <CopyIcon className={ICON_SIZE.card} />
              )
            }
          >
            {copied ? "Kopiert" : "Diagnose kopieren"}
          </Button>
        </div>
      </section>

      <section className="rounded-md shadow-hairline p-4 flex flex-col gap-2 bg-surface-base">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">
          Links
        </h4>
        <LinkRow label="Repository" onClick={() => openUrl(REPO_URL)} />
        <LinkRow label="Problem melden" onClick={() => openUrl(ISSUES_URL)} />
        <LinkRow label="Releases / Changelog" onClick={() => openUrl(RELEASES_URL)} />
      </section>

      <p className="text-xs text-neutral-500">© 2026 ARO-LABS · MIT-Lizenz</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="text-neutral-200 font-mono truncate">{value}</dd>
    </div>
  );
}

function LinkRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-sm text-left text-neutral-300 hover:text-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs -mx-1 px-1 py-0.5"
    >
      <ExternalLinkIcon className={`${ICON_SIZE.card} shrink-0`} />
      <span>{label}</span>
    </button>
  );
}
```

- [ ] **Step 4: Test-Lauf → muss bestehen**

Run: `npx vitest run --config vitest.config.integration.ts src/components/settings/panels/AboutPanel.integration.test.tsx`
Expected: PASS (4 Tests grün).

- [ ] **Step 5: Type-Check**

Run: `npx tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/panels/AboutPanel.tsx src/components/settings/panels/AboutPanel.integration.test.tsx
git commit -m "feat(ui): AboutPanel — version, build info, platform, links"
```

---

### Task 3: Kategorie verdrahten + Nav-Test aktualisieren + CHANGELOG

**Files:**
- Modify: `src/components/settings/categories.ts` (+1 Kategorie-Eintrag)
- Modify: `src/components/settings/PreferencesView.test.tsx:15-26` (Wortlaut + Assertions)
- Modify: `CHANGELOG.md` (`[Unreleased] → ### Hinzugefügt`)

**Interfaces:**
- Consumes: `AboutPanel` (aus Task 2).
- Produces: erreichbare Kategorie `about` als letzter Nav-Eintrag „Über".

- [ ] **Step 1: Nav-Test erweitern (Failing)** — in `src/components/settings/PreferencesView.test.tsx` den ersten `it`-Block (Zeilen 15-26) ersetzen durch:

```tsx
  it("renders the page header and the CategoryNav with all 7 categories", () => {
    render(<PreferencesView />);
    expect(screen.getByRole("heading", { level: 2, name: /Einstellungen/i })).toBeTruthy();
    // The left nav exposes all 7 category labels at all times.
    expect(screen.getByRole("button", { name: /Darstellung/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sessions/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Terminal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Benachrichtigungen/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /System/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Erweitert/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Über/i })).toBeTruthy();
  });
```

- [ ] **Step 2: Test-Lauf → muss fehlschlagen**

Run: `npx vitest run src/components/settings/PreferencesView.test.tsx`
Expected: FAIL — kein Button `/Über/i` (Kategorie noch nicht verdrahtet). `/System/i` besteht bereits.

- [ ] **Step 3: Kategorie hinzufügen** — in `src/components/settings/categories.ts`:

(a) Bei den Icon-Konstanten oben (nach `const Bug = ICONS.category.debug;`) ergänzen:

```ts
const InfoIcon = ICONS.toast.info;
```

(b) Als **letzten** Eintrag im `SETTINGS_CATEGORIES`-Array (nach dem `advanced`-Objekt, vor `] as const;`) hinzufügen:

```ts
  {
    id: "about",
    label: "Über",
    icon: InfoIcon,
    Panel: lazy(() => import("./panels/AboutPanel").then((m) => ({ default: m.AboutPanel }))),
  },
```

- [ ] **Step 4: Nav-Test → muss bestehen**

Run: `npx vitest run src/components/settings/PreferencesView.test.tsx`
Expected: PASS.

- [ ] **Step 5: CHANGELOG ergänzen** — in `CHANGELOG.md`, unter `## [Unreleased]` → `### Hinzugefügt`, als neue letzte Zeile der Rubrik:

```markdown
- Neue Einstellungs-Sektion **„Über"**: zeigt App-Version, Build-Commit, Build-Datum und Plattform, mit „Diagnose kopieren" (für Bug-Reports) sowie Links zu Repository, Issues und Releases.
```

- [ ] **Step 6: Volle Gates**

Run: `npx tsc --noEmit && npm run build && npx vitest run src/components/settings && npm run test:integration -- src/components/settings/panels/AboutPanel.integration.test.tsx`
Expected: tsc sauber, Build grün, Unit-Settings-Tests (inkl. aktualisierter Nav-Test) grün, AboutPanel-Integration-Test grün. (Der Default-Config-Lauf schließt `*.integration.test.tsx` bewusst aus — daher der separate Integration-Lauf.)

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/categories.ts src/components/settings/PreferencesView.test.tsx CHANGELOG.md
git commit -m "feat(ui): wire About category into settings nav + changelog"
```

---

## Verifikation (nach allen Tasks)

- `npx tsc --noEmit && npm run build`
- `npm run test:all` (Unit- **und** Integration-Suite; `npx vitest run` allein lässt `*.integration.test.tsx` aus)
- `cd src-tauri && source "$HOME/.cargo/env" && cargo test && cargo clippy -- -D warnings && cargo fmt --check`
- Visuelle Prüfung im lokal gebauten `.app` (Memory `smashq-local-build-no-release`): Settings öffnen → „Über" → Version/Commit/Build/Plattform korrekt, „Diagnose kopieren" legt den Block ab, Links öffnen im Browser.

## Doku-Hygiene

Diese Plan-Datei **und** die Spec (`docs/superpowers/specs/2026-07-10-settings-about-section-design.md`) sind ephemer und werden im selben Commit wie der Feature-Merge gelöscht.
