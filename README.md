# Smashq

A desktop app for managing and monitoring multiple [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) sessions. Multi-session terminal with project context, favorites, and notes — built with Tauri v2 and React.

> ⚠️ **v1.6.31 / v1.6.32 — keyboard input is broken in the production build.** Roll back to v1.6.30 via the manual NSIS installer from GitHub Releases; the auto-updater cannot recover from this. See [CHANGELOG.md](CHANGELOG.md).

## Features

- **Multi-Session Terminal** — Run multiple Claude CLI sessions side by side in one window
- **Project Context Tabs** — View CLAUDE.md, Skills, Hooks, and GitHub info for each session's project
- **GitHub Integration** — See current branch, open PRs, and issues directly in the dashboard
- **Library System** — Detect and browse configurations across your favorite projects
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
