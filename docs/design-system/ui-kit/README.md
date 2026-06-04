# AgenticExplorer UI Kit

High-fidelity React recreation of the AgenticExplorer desktop shell.

## Components

| File | What's in it |
|------|-------------|
| `Icon.jsx` | Lucide-style SVG icons (2px stroke, currentColor) — 23 icons covering the real app's vocabulary |
| `Button.jsx` | `AEButton` — primary / secondary / ghost / danger. Sharp corners, no scale on press |
| `Panel.jsx` | `Panel` (uppercase header + bordered frame), `StatusDot`, `StatusBadge` |
| `SideNav.jsx` | 128px fixed sidebar — Sitzungen / Pipeline / Kanban / Bibliothek / Editor / Protokolle + theme toggle |
| `SessionsView.jsx` | Three-pane layout: session list · terminal · details + notes |
| `KanbanView.jsx` | 5-column board (Backlog / Planning / Active / Review / Done) with draggable cards |
| `index.html` | Click-through prototype — tab switching, new/close session with toast feedback, theme toggle |

## Views covered

1. **Sitzungen** — browse sessions, click to activate, hover for folder/terminal/detach/close actions, terminal output, details sidebar, notes log
2. **Kanban** — 5-column board with tag chips, status dots, session attribution

## Not implemented

Library, Editor, Protokolle tabs are stubbed as placeholders. The real app has them, but screens were not explored in depth — see `Softwareprozess/arc42-specification.md` in the source repo.
