# Smashq Design System

Design system for **Smashq** — a Tauri v2 + React desktop application for managing and monitoring multiple Claude CLI sessions. Multi-session terminal with project context tabs, favorites, pipeline visualization, and notes. Built for developers who run many Claude CLI sessions in parallel.

> **Tone summary:** German UI, English code. Terse, technical, monospace-adjacent. Dense information. Sharp corners. Dark-mode-native with a first-class light theme. One accent color (azure, hue 230), high-contrast neutrals, semantic colors used structurally never decoratively.

---

## Sources

- **Codebase:** [github.com/hossoOG/agentic-dashboard](https://github.com/hossoOG/agentic-dashboard) (branch: `master`)
  - Design tokens: `src/index.css` — all OKLCH CSS variables, light + dark
  - Tailwind mapping: `tailwind.config.js`
  - Motion primitives: `src/utils/motion.ts`
  - Status config (single source of truth): `src/utils/statusConfig.ts`
  - Core UI: `src/components/ui/` (Button, Input, IconButton, Modal)
  - Shared: `src/components/shared/` (Panel, StatusBadge, Toast, NotesPanel)
  - Views: `src/components/layout/` (AppShell, SideNav), `src/components/sessions/`, `src/components/pipeline/`, `src/components/kanban/`
  - Architecture spec: `Softwareprozess/arc42-specification.md`
  - Conventions: `CLAUDE.md`
- **Fonts:** Google Fonts — Space Grotesk, Instrument Sans, JetBrains Mono (all 400/500/600/700)
- **Icons:** Lucide React (`lucide-react` npm; CDN via unpkg)
- **Logo:** Bracket-Q (`[q_]`) — Marke in `assets/logo.svg` (Form B, Farbmuster F1: Glyphe `currentColor`, Cursor Akzent). App-Icon-Quelle: `/app-icon.svg` (Behandlung I1: dunkle Kachel, helle Glyphe, Azure-Cursor) → generiert `src-tauri/icons/` via `npm run tauri icon app-icon.svg`.

---

## Index

| File | What's in it |
|------|-------------|
| [`colors_and_type.css`](colors_and_type.css) | All CSS variables — colors (light + dark), fonts, spacing, motion, semantic classes |
| [`SKILL.md`](SKILL.md) | Skill front-matter for portable agent use |
| [`preview/`](preview/) | Small HTML cards that populate the Design System tab |
| [`ui-kit/`](ui-kit/) | High-fidelity React recreations of the desktop shell + 3 core views |
| [`assets/`](assets/) | Logo (Bracket-Q), icon references |

---

## CONTENT FUNDAMENTALS

**Language:** German for all UI copy, English for code, identifiers, and technical strings. Never mix in one sentence.

**Tone:** Terse, precise, technical. Written for senior engineers. Assumes the reader knows what a PTY is.

**Casing:** Section headers and panel titles are `UPPERCASE` with wide letter-spacing (`tracking-widest`, `0.12em+`). UI labels and body are sentence case. Never Title Case.

**Pronouns:** No "you"/"du". Imperative or infinitive only. `"Session schließen"` not `"Schließen Sie die Session"`. `"Projektordner wählen"` not `"Wählen Sie Ihren Ordner"`.

**Vocabulary examples** (real copy from the app):
- `Sitzungen`, `Bibliothek`, `Editor`, `Protokolle`, `Kanban`, `Pipeline`, `Verlauf`
- `Läuft seit 2:14` · `Idle seit 0:34` · `Wartet auf Input` · `Fertig (0:48)` · `Fehler (Exit 1)`
- `Ordner im Explorer öffnen` · `Doppelklick zum Umbenennen` · `Benachrichtigung schließen`
- `Agent-Erkennung hat noch keine Agents erkannt.`
- Toast titles: `SESSION FINISHED` · `BUILD FAILED` (uppercase, declarative)

**Numbers & units:** ms for durations in labels (`312 ms`), colon-separated mm:ss for elapsed (`2:14`), SI-style for sizes. Exit codes shown verbatim (`Exit 0`, `Exit 1`).

**Emoji:** Never. No emoji in UI copy, labels, commit messages, or documentation. No unicode-as-icon (`→`, `✓`, `×` only inside code blocks or placeholder SVGs, not as actual UI primitives).

**Vibe:** Terminal-adjacent. The UI is a control surface for an agent fleet; it reads like a build log with better typography. Success is quiet (`✓ Vite dev server ready in 312 ms`), failure is loud (bordered toast, error glow).

---

## VISUAL FOUNDATIONS

### Colors

- **One accent:** azure at hue 230. Light mode `oklch(55% 0.16 230)`, dark mode `oklch(72% 0.14 230)` — same hue, shifted lightness. The entire UI shares one primary.
  - **Exception — per-session accent (#261):** Session cards may vary their accent across a curated 5-hue palette (`src/utils/sessionAccent.ts`) to tell parallel sessions/projects apart. Mechanism: only `--accent-h` is overridden per card; `--accent-l`/`--accent-c`/alpha inherit from the mode tokens in `index.css`, so lightness/contrast stays constant across hues. This is the **only** sanctioned accent variation — all other chrome (buttons, focus ring, toasts, tabs) stays azure.
- **Tinted neutrals:** hue 250 (slightly cool), very low chroma (`0.003–0.012`). Not pure gray — has a faint blue bias that reads as "calm tech."
- **Semantic colors:** success (green 155°), error (red 25°), warning (amber 70°), info (blue 250°) — all at matched chroma so they feel like siblings, not a rainbow.
- **OKLCH everywhere** for perceptual uniformity and predictable theme flips.

### Type

- **Space Grotesk** — display, headings, nav, section labels. Often uppercase + wide tracking.
- **Instrument Sans** — body, UI copy, metadata.
- **JetBrains Mono** — terminals, code, file paths, numeric IDs, timestamps.
- Scale: `xs 12 / sm 14 / base 16 / lg 20 / xl clamp(24-32)`. Dense — most UI sits at `xs` or `sm`.

### Spacing

- 4pt base. Tokens `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48`.
- Dense application. A panel header is `px-4 py-3`; a list row is `px-3 py-2.5`. Whitespace is earned, not default.

### Backgrounds

- Flat surfaces only. No gradients, no textures, no patterns, no illustrations.
- Three surface tokens: `surface-base` (app background), `surface-raised` (cards, modals), `surface-overlay` (menus, dropdowns). ~2–4% lightness steps between them.
- Dark mode is the native look; light mode is first-class but secondary.

### Borders

- Ubiquitous `1px solid var(--neutral-700)` for structural separation.
- `border-2` with semantic color (accent/success/error/warning) for emphasized panels.
- `border-left: 2px` is the signature "active/selected" pattern for nav items, session cards, toasts.

### Corner radii

> **Updated 2026-05-21 — Concept B Rollout.** Sharp-corner default has been replaced by a soft-corner recipe to fix density and hierarchy issues documented in `audit/dossier.md`. The hard rule from v1.0–v1.6 is preserved as a historical note below.

- **Soft by default.** Cards, panels, modals, inputs use `border-radius` from the `--radius-*` scale:
  - `xs` `2px` — inline pills, chip-edges where sharper feel is wanted
  - `sm` `4px` — kanban cards, label chips
  - `md` `6px` — DEFAULT — buttons, inputs, list-row containers, session-cards
  - `lg` `8px` — large containers, modal corners
  - `full` `9999px` — status dots, avatars
- All radii are CSS-variable-backed (`var(--radius-*)`) and exposed via Tailwind: `rounded-xs / rounded-sm / rounded-md / rounded-lg / rounded-full`.

**Historical (pre-2026-05-21):** Sharp corners were the default for panels, buttons, modals, inputs; only kanban cards (`2px`) and status dots (`full`) used radius. This was relaxed to align with Concept B audit findings — see `audit/principles-diff.md` for the rationale.

### Shadows

- Drop shadows not used. Elevation comes from background lightness + borders.
- **Glow system** (`glow-accent`, `glow-success`, `glow-error`, `glow-warning`) — double box-shadow using the semantic color at 0.4 and 0.15 alpha. Softer (1px + 8px spread) in light mode; brighter (6px + 12px) in dark mode. Used for active panels, toasts, focused terminals — never decoratively.

### Hover / press states

- Hover: text brightens one step (`neutral-400 → neutral-200`), background adds `hover-overlay` (4% black in light, 5% white in dark). Borders lighten (`neutral-700 → neutral-500`).
- Primary button hover: reduce opacity to 90% (`bg-neon-green/90`).
- Press: no scale transform. This is a desktop/productivity tool, not a touch app.
- Disabled: `opacity: 0.4` + `cursor-not-allowed`.
- Action buttons on cards (folder/terminal/close): `opacity-0 group-hover:opacity-100` — invisible until the card is hovered.

### Transparency & blur

- Alpha variants for the accent (`accent-a05`, `a10`, `a15`, `a30`, `a40`) — used for active-row tints and hover fills.
- Modal backdrop is `bg-black/70`. No backdrop-blur.
- No glassmorphism.

### Motion

- **100ms instant · 200ms fast · 300ms base · 500ms slow.** Exit = 75% of enter.
- **Easing:** exponential only. `ease-out: cubic-bezier(0.16, 1, 0.3, 1)` for entrance. `ease-in: cubic-bezier(0.7, 0, 0.84, 0)` for exit. **No bounce, no elastic.**
- Only `transform` and `opacity` animated.
- **Pulse** animation (2s infinite, `ease-in-out`) on status dots for `running`/`active`/`planning` — breathes opacity + box-shadow.
- **Spin** for loaders (1.5s linear).
- `@media (prefers-reduced-motion: reduce)` kills everything to 0.01ms.

### Imagery

- No photography, no illustrations, no hand-drawn art, no stock images. This is a dev tool; imagery would feel dishonest.
- Any visuals are data-driven: status dots, progress bars, the isometric pipeline visualization.

### Layout rules

- Desktop-only (Tauri window). No responsive breakpoints for mobile.
- Fixed 128px SideNav on the left (`w-32 min-w-[128px]`).
- Main content fills remaining space with `flex-1 min-w-0 overflow-hidden`.
- Everything uses `overflow-hidden` at the shell; individual panels manage their own scroll with thin (`4px`) scrollbars.
- Grid gaps are small (`gap-0.5` / `gap-2`); density is a feature.
- Scrollbar: 4px wide, thumb uses `--neutral-600`, track is `--surface-raised`.

### Cards

- Sharp corners, `1–2px` border, flat background (`surface-raised`).
- Active/selected state is `border-left-2` in semantic color + tinted background (`accent-a10` / `success-a05`).
- Hover action chrome is positioned absolute, fades in on `group-hover`.

### Focus rings

- `outline: 2px solid var(--color-accent); outline-offset: 2px` on `:focus-visible`. Never `outline: none` without replacement.

---

## ICONOGRAPHY

- **System:** [Lucide React](https://lucide.dev) — imported throughout the codebase (`import { Monitor, Columns3, X, ... } from "lucide-react"`).
- **Stroke:** 2px nominal, `round` linecap and linejoin.
- **Sizes:** `w-3 h-3` (12px, inline nav badge), `w-3.5 h-3.5` (14px, session card buttons), `w-4 h-4` (16px, nav + panel headers), `w-5 h-5` (20px, toast + modal close).
- **Color:** always `currentColor` via Tailwind text classes. Never filled. Never multi-color.
- **CDN fallback:** `https://unpkg.com/lucide-static@latest/icons/<name>.svg` if React isn't loaded.

### Icon vocabulary actually used in the app

| Use | Icon |
|-----|------|
| Sessions nav | `Monitor` |
| Kanban nav | `Columns3` |
| Library nav | `BookOpen` |
| Editor nav | `FileEdit` |
| Logs nav | `ScrollText` |
| Theme toggle | `Sun` / `Moon` |
| Session close / modal close | `X` |
| Folder actions | `FolderOpen` |
| Terminal actions | `Terminal` |
| External link | `ExternalLink` |
| Detach view | `LayoutGrid` |
| Dropdown / collapse | `ChevronDown` |
| Loading | `Loader2` (animate-spin) |
| Toast types | `CheckCircle2`, `AlertTriangle`, `Trophy`, `Info` |
| Update status | `ArrowDownCircle`, `AlertCircle` |

### Emoji & unicode

- **No emoji.** Codebase search confirms zero emoji in UI copy.
- **No unicode-as-icon.** The app uses Lucide SVG even where a single glyph would suffice.

### Logos & imagery

- **Official logo: Bracket-Q** (`[q_]`) — a lowercase q between square brackets with an accent underscore-cursor. Reads as a prompt waiting for input. Mark lives at `assets/logo.svg` (glyph `currentColor`, cursor `var(--color-accent)` with light-mode fallback); favicon at `/public/logo.svg` and app-icon source at `/app-icon.svg` use the solid dark-tile treatment (I1).
- **No generic illustrations, full-bleed images, or stock photography** are used.

---

## UI Kits

| Product | Path | What it covers |
|---------|------|----------------|
| Smashq Desktop | [`ui-kit/`](ui-kit/) | Full desktop shell with SideNav, interactive Sessions view (click to activate, hover actions), Pipeline live tab with task tree, Kanban board |

---

## CAVEATS / flagged substitutions

- **No font files** in the repo — the app loads from Google Fonts CDN. Same here. If self-hosting is required, fetch `.woff2` files from `fonts.google.com` for Space Grotesk, Instrument Sans, JetBrains Mono at weights 400/500/600/700.
- **Light mode** is implemented in code but dark mode is the canonical look; most screenshots and designs in the wild will be dark.
