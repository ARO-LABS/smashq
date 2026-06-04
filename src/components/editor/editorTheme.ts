import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

const theme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--surface-base)",
      color: "var(--neutral-200)",
      fontFamily: "var(--font-mono)",
      fontSize: "14px",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--color-accent)",
      padding: "12px 16px",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--color-accent)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "var(--accent-a15)",
    },
    ".cm-activeLine": {
      backgroundColor: "var(--accent-a05)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--surface-raised)",
      color: "var(--neutral-500)",
      borderRight: "1px solid var(--neutral-800)",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "var(--accent-a10)",
      color: "var(--neutral-200)",
    },
    ".cm-foldPlaceholder": {
      backgroundColor: "var(--accent-a10)",
      color: "var(--color-accent)",
      border: "none",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--surface-overlay)",
      border: "1px solid var(--neutral-800)",
      borderRadius: "var(--radius-md)",
      color: "var(--neutral-200)",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      overflow: "auto",
    },

    /* ── Diff classes (@codemirror/merge) — no-ops when the view is not a diff ── */
    ".cm-deletedLine, .cm-deletedChunk": {
      backgroundColor: "var(--diff-removed-bg)",
    },
    ".cm-insertedLine, .cm-insertedChunk": {
      backgroundColor: "var(--diff-added-bg)",
    },
    ".cm-changedLine": {
      backgroundColor: "var(--diff-added-bg)",
    },
    ".cm-deletedText": {
      backgroundColor: "var(--diff-removed-emph)",
    },
    ".cm-changedText": {
      backgroundColor: "var(--diff-added-emph)",
    },
    ".cm-deletedChunkGutter, .cm-changedLineGutter": {
      color: "var(--color-error)",
    },
    ".cm-insertedChunkGutter": {
      color: "var(--color-success)",
    },
    /* Hide @codemirror/merge accept/reject widgets — feature is out-of-scope
       per tasks/2026-05-12-session-diff-window-design.md (backlog: needs
       file-write backend command + conflict detection). Clicking did nothing
       anyway because the editor is readOnly. */
    ".cm-acceptChunk, .cm-rejectChunk, .cm-mergeControl, .cm-deletedChunk button, .cm-insertedChunk button, .cm-changedLineGutter button": {
      display: "none",
    },
  },
  // Note: dark: false allows CSS variables to control both modes.
  // The CSS variables (--surface-base, --neutral-*, etc.) switch automatically
  // between light and dark values via :root / .dark selectors in index.css.
  { dark: false },
);

const highlighting = HighlightStyle.define([
  { tag: tags.heading1, color: "var(--color-accent)", fontWeight: "700", fontSize: "1.4em" },
  { tag: tags.heading2, color: "var(--color-accent-light)", fontWeight: "600", fontSize: "1.25em" },
  { tag: tags.heading3, color: "var(--color-accent-light)", fontWeight: "600", fontSize: "1.1em" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: "var(--color-accent-light)", fontWeight: "500" },
  { tag: tags.strong, fontWeight: "700", color: "var(--neutral-100)" },
  { tag: tags.emphasis, fontStyle: "italic", color: "var(--neutral-200)" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--neutral-400)" },
  { tag: tags.link, color: "var(--color-info)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--color-info)" },
  { tag: [tags.monospace, tags.processingInstruction], color: "var(--color-success)", fontFamily: "var(--font-mono)" },
  { tag: tags.quote, color: "var(--neutral-400)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--neutral-500)" },
  { tag: tags.comment, color: "var(--neutral-500)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--color-accent)" },
  { tag: tags.string, color: "var(--color-success)" },
  { tag: tags.number, color: "var(--color-warning)" },
  { tag: tags.bool, color: "var(--color-warning)" },
  { tag: tags.operator, color: "var(--neutral-300)" },
  { tag: tags.punctuation, color: "var(--neutral-400)" },
  { tag: tags.labelName, color: "var(--color-accent)" },
  { tag: tags.contentSeparator, color: "var(--neutral-600)" },
]);

export const neonEditorTheme: Extension = [
  theme,
  syntaxHighlighting(highlighting),
];
