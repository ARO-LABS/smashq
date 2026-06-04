import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
});

// Block event handler attrs, data attributes, and dangerous URI schemes (XSS prevention).
// type/checked/disabled are allowed to preserve GitHub-style task-list checkboxes rendered
// by markdown-it as <input type="checkbox" checked disabled>.
const PURIFY_ALLOWED_ATTR = [
  "href", "title", "alt", "src", "class", "id",
  "type", "checked", "disabled",
];
const PURIFY_FORBID_ATTR = [
  "onerror", "onload", "onclick", "onmouseover", "onmouseout",
  "onfocus", "onblur", "onsubmit", "onchange", "oninput",
];
const PURIFY_ALLOWED_URI = /^(?:https?|mailto|tel|#):/i;

function renderMarkdown(content: string): string {
  const raw = md.render(content);
  return DOMPurify.sanitize(raw, {
    ALLOWED_ATTR: PURIFY_ALLOWED_ATTR,
    FORBID_ATTR: PURIFY_FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: PURIFY_ALLOWED_URI,
  });
}

// ============================================================================
// MarkdownBody — slim inline renderer (no wrapper padding/background).
// Use inside modals, sidebars, or any context that provides its own layout.
// ============================================================================

interface MarkdownBodyProps {
  content: string;
  className?: string;
}

export function MarkdownBody({ content, className }: MarkdownBodyProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div
      className={`md-preview${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ============================================================================
// MarkdownPreview — full-page editor preview with scroll and background.
// Used by MarkdownEditorView, LibraryDetailContent, ClaudeMdViewer, PinnedDocViewer.
// ============================================================================

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return (
    <div className="h-full overflow-auto p-6 bg-surface-raised">
      <div
        className="md-preview max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
