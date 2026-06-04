---
name: agentic-explorer-design
description: Use this skill to generate well-branded interfaces and assets for AgenticExplorer (a Tauri + React desktop app for managing Claude CLI sessions), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

Key files:
- `README.md` — brand context, CONTENT FUNDAMENTALS, VISUAL FOUNDATIONS, ICONOGRAPHY
- `colors_and_type.css` — all CSS variables (light + dark), semantic type classes, glow utilities
- `ui-kit/` — React components for SideNav, SessionCard, KanbanCard, Panel, Button, Toast, etc.
- `preview/` — small HTML cards showing every visual primitive in isolation

Non-negotiable rules:
- German UI copy, English code identifiers. No emoji. No unicode-as-icon.
- Sharp corners (radius 0) for panels/buttons/modals/inputs. 2px for kanban cards only. Full-round for status dots only.
- One accent color (cyan-teal hue 190) used across light + dark — do not introduce new accents.
- Exponential easing (`cubic-bezier(0.16, 1, 0.3, 1)`) for motion, no bounce, 100/300/500 durations.
- Lucide icons only, 2px stroke, currentColor.
- Flat surfaces — no gradients, glassmorphism, blur, or illustrations.
- Uppercase + wide tracking for panel headers and section labels (`tracking-widest`, `0.12em+`).
