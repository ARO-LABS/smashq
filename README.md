# Smashq

A desktop app for managing and monitoring multiple [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) sessions. Multi-session terminal with project context, favorites, and notes — built with Tauri v2 and React.

## Features

- **Multi-Session Terminal** — Run multiple Claude CLI sessions side by side in one window
- **Project Context Tabs** — View CLAUDE.md, Skills, Hooks, and GitHub info for each session's project
- **GitHub Integration** — See current branch, open PRs, and issues directly in the dashboard
- **Markdown Editor** — Open and edit `.md` files by path — paste a path in the session panel, or let a Claude session open one automatically (see [below](#opening-markdown-files-by-path))
- **Library System** — Detect and manage Claude configurations across the global scope, the active session's project, and your favorite projects
- **Worktree Viewer** — Monitor active git worktrees per project
- **Favorites & Groups** — Pin projects, organize into groups, drag-and-drop reorder, with global or per-project notes
- **Agents** — Browse declared sub-agents from each project's `.claude/agents/` directory
- **Pipeline View** — Isometric 2.5D visualization of agent workflows (mock mode)
- **Theming** — Light and dark mode support
- **Auto-Update** — Automatic update notifications via GitHub Releases

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Zustand, Tailwind CSS, Framer Motion
- **Backend**: Tauri v2, Rust
- **Terminal**: xterm.js with PTY sessions

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and configured

## Getting Started

```bash
# Clone the repository
git clone https://github.com/ARO-LABS/smashq.git
cd smashq

# Install dependencies
npm install

# Run in development mode (starts Vite dev server + Tauri)
npm run tauri dev
```

## Building

```bash
# Build the desktop app (frontend + Rust)
npm run tauri build
```

The installer will be created in `src-tauri/target/release/bundle/`.

## Other Commands

```bash
npm run dev          # Vite dev server only (port 5173, no Tauri)
npm run build        # Frontend build only (TypeScript check + Vite)
npx tsc --noEmit     # Type checking without build
npm run test         # Run tests
npm run lint         # Run ESLint
```

## Opening Markdown Files by Path

The Markdown editor can open a file directly from a path — no file dialog needed.
This is handy because Claude CLI sessions often create `.md` files (`tasks/todo.md`,
plans, reports) that you then want to inspect.

Paste a path into the input field in the session panel (or in the empty editor
view) and confirm. The editor window opens (or focuses) and loads the file in
one step. Relative paths resolve against the session's working directory;
absolute paths are used as-is. If the editor has unsaved changes, the open is
skipped (you are notified) so your edits are never clobbered.

## Betrieb hinter Corporate Proxy

Smashq hat drei netzwerkrelevante Komponenten mit jeweils eigenem Proxy-Mechanismus.
Kurzfassung: **Alle drei Pfade folgen den Standard-Umgebungsvariablen
`HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` / `NO_PROXY`** — die Proxy-Einstellungen
des Betriebssystems (Windows „Internetoptionen", PAC-Skripte) werden dagegen vom
Auto-Updater **nicht** ausgewertet.

> **Ungetestet:** Die reale Verifikation hinter einem Corporate Proxy steht aus
> ([#25](https://github.com/ARO-LABS/smashq/issues/25)). Die folgenden Aussagen
> sind aus Quellcode und Crate-Doku belegt, aber noch nicht gegen eine echte
> Proxy-Infrastruktur (inkl. TLS-Interception und Proxy-Auth) geprüft.

### 1. Auto-Updater (`tauri-plugin-updater`)

- **HTTP-Client:** `reqwest` 0.13 mit rustls (`src-tauri/Cargo.lock`; Plugin-Feature
  `rustls-tls`). Endpoint ist `github.com` (`src-tauri/tauri.conf.json`,
  `plugins.updater.endpoints`).
- **Proxy-Quelle:** reqwest baut seinen Client standardmäßig mit System-Proxy-Matcher;
  dessen Env-Zweig (`HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY`, Groß- wie
  Kleinschreibung) ist **immer aktiv** — unabhängig von Feature-Flags
  (hyper-util `proxy/matcher.rs`, `Builder::from_env`). Smashq setzt weder einen
  expliziten Proxy noch `no_proxy()` (`check()` in `src/hooks/useAutoUpdate.ts:64`
  ohne Optionen), der Env-Mechanismus greift also ungefiltert.
- **Bekannte Lücke — OS-Proxy:** Das reqwest-Feature `system-proxy` (liest Windows-Registry
  bzw. macOS-Systemkonfiguration) ist im Updater-Plugin **deaktiviert**
  (`default-features = false`, nur `json`+`stream`; Beleg: kein `windows-registry`-Crate
  in `src-tauri/Cargo.lock`). Ein nur in den Windows-Internetoptionen oder per
  PAC-Skript konfigurierter Proxy wird vom Updater **nicht** übernommen —
  die Env-Variablen müssen gesetzt sein.
- **TLS-Interception:** Zertifikate prüft rustls über den **OS-Zertifikatsspeicher**
  (`rustls-platform-verifier`, via reqwest-Feature `rustls-no-provider`). Eine im
  Windows-/macOS-Zertifikatsspeicher installierte Corporate-CA (SSL-Inspection)
  wird damit akzeptiert.
- **Proxy-Auth:** Basic-Auth über die Proxy-URL (`http://user:pass@proxy:port`) wird
  von reqwest unterstützt; NTLM/Kerberos/Negotiate **nicht** (~85 % sicher —
  reqwest bietet dafür keinen Mechanismus). Hinter reinen NTLM-Proxys hilft nur
  ein lokaler Auth-Relay (z. B. Px/Cntlm).

### 2. GitHub-Integration (`gh` CLI — Kanban, Issues, PRs)

- **Spawn-Pfad:** `gh` (und `git`) laufen als normale Kindprozesse via
  `std::process::Command` (`src-tauri/src/util.rs:11` `silent_command`,
  `src-tauri/src/github/commands.rs:106` `run_command` / `:284` `run_gh`).
  Es gibt **kein `env_clear`** — Kindprozesse erben die komplette Prozess-Umgebung
  von Smashq, inklusive aller Proxy-Variablen.
- **Proxy-Quelle:** `gh` respektiert `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` über die
  Go-Standardbibliothek (~90 % sicher — dokumentiertes Go-`net/http`-Verhalten,
  gh hat keine eigene Proxy-Konfiguration). Sind die Variablen für den
  Smashq-Prozess sichtbar, gelten sie auch für alle Kanban-/Issue-Aufrufe.

### 3. Claude CLI in PTY-Sessions

- **Env-Vererbung:** `portable-pty` seedet die Umgebung jedes PTY-Kindes aus der
  vollen Prozess-Umgebung (`CommandBuilder::new` → `get_base_env()` →
  `std::env::vars_os()`); unter Windows werden zusätzlich die Registry-Zweige
  `HKLM`/`HKCU … \Environment` eingemischt. Proxy-Variablen erreichen die
  Claude CLI also auf beiden Wegen.
- **macOS-Besonderheit:** Die PTY-Shell startet als **Login-Shell** (`-l`,
  `src-tauri/src/session/manager.rs`) und sourced dabei `.zprofile`/`.zshrc` —
  dort gesetzte Proxy-Variablen wirken in der Session, selbst wenn der
  App-Prozess (Finder-/Dock-Start) sie nicht hat.
- **Bekannte Lücke — macOS-GUI-Start:** `hydrate_path_from_login_shell`
  (`src-tauri/src/util.rs:148`) übernimmt aus der Login-Shell **nur `PATH`**,
  keine Proxy-Variablen. Ein aus Finder/Dock gestartetes Smashq sieht Proxy-Variablen
  aus Shell-Profilen daher **nicht** — Updater und `gh` laufen dann proxylos,
  obwohl die PTY-Sessions (via Login-Shell) den Proxy nutzen. Abhilfe:
  `launchctl setenv HTTPS_PROXY …` oder App-Start aus dem Terminal.
  Unter Windows gilt das nicht: Benutzer-Umgebungsvariablen (Systemsteuerung)
  erreichen auch GUI-Prozesse.

### 4. Sonstige Netzpfade

- **Externe Links** (Kanban-Karten, „Über"-Panel, Whats-New-Modal) öffnen über
  `shell.open()` im Default-Browser — es gilt dessen eigene Proxy-Konfiguration.
- **Google Fonts** (`index.html:9-11`) lädt die WebView (WebView2/WKWebView) mit dem
  **System-Proxy des OS**. Schlägt das fehl, greifen die Fallback-Fonts —
  die App bleibt voll funktionsfähig.
- Direkte `fetch()`-Aufrufe ins Netz gibt es im Frontend aktuell nicht
  (CSP-Freigaben in `tauri.conf.json` sind Vorhalte).

### Schnellreferenz

| Komponente | Mechanismus | Env-Variablen | OS-Proxy (Internetoptionen/PAC) |
|---|---|---|---|
| Auto-Updater | reqwest (rustls, Platform-Verifier) | `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY` | nein |
| `gh` / `git` | Env-Vererbung an Kindprozess, Go `net/http` | `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | nein |
| Claude CLI (PTY) | Env-Vererbung + Login-Shell-Profile (macOS) | wie von Claude CLI unterstützt (`HTTPS_PROXY` u. a.) | nein |
| Externe Links / Fonts | Default-Browser bzw. WebView | — | ja (Browser/WebView) |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | Conventions, architecture, quality gates (AI-assisted contributing guide) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, code style, PR workflow |
| [tasks/todo.md](tasks/todo.md) | Sprint backlog with current plan |
| [tasks/lessons.md](tasks/lessons.md) | Lessons learned from past sprints |
| [Softwareprozess/arc42-specification.md](Softwareprozess/arc42-specification.md) | Architecture & roadmap (single source of truth, updated each sprint) |
| [CHANGELOG.md](CHANGELOG.md) | Release history (Keep-a-Changelog format) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute.

## License

[MIT](LICENSE)
