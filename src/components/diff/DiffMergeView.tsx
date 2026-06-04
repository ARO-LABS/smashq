import { useEffect, useRef, useState } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { neonEditorTheme } from "../editor/editorTheme";
import { codeLanguages } from "../editor/languageSupport";
import { logError } from "../../utils/errorLogger";
import type { DiffFile, DiffViewMode } from "./types";

interface DiffMergeViewProps {
  file: DiffFile;
  mode: DiffViewMode;
}

/**
 * Pickt eine `LanguageDescription` aus der App-Language-Registry anhand der
 * Dateiendung. Faellt zurueck auf Plaintext (kein Highlighting), wenn keine
 * passende Sprache existiert.
 */
function pickLanguage(path: string): LanguageDescription | null {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return codeLanguages.find((l) => l.extensions.includes(ext)) ?? null;
}

/**
 * CodeMirror-Merge-Wrapper. Reaktiert auf `mode` (Side-by-Side vs Inline)
 * indem die View beim Mode-Wechsel komplett neu aufgebaut wird — der einfachste
 * stabile Weg, da MergeView und unifiedMergeView verschiedene Mount-Pfade
 * haben.
 */
export function DiffMergeView({ file, mode }: DiffMergeViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [langSupport, setLangSupport] = useState<LanguageSupport | null>(null);

  // Async-load passende Sprache. Plain Text wenn keine Description matched.
  useEffect(() => {
    let cancelled = false;
    const desc = pickLanguage(file.path);
    if (!desc) {
      setLangSupport(null);
      return;
    }
    desc
      .load()
      .then((support) => {
        if (!cancelled) setLangSupport(support);
      })
      .catch((err: unknown) => {
        logError("DiffMergeView.loadLanguage", err);
        if (!cancelled) setLangSupport(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = "";

    if (file.oversize) {
      const banner = document.createElement("div");
      banner.className = "p-4 text-xs text-warning";
      banner.textContent =
        "Datei ueberschreitet das Performance-Budget (500 KB). Inhalt ausgelassen.";
      container.appendChild(banner);
      return;
    }

    const oldContent = file.oldContent ?? "";
    const newContent = file.newContent ?? "";

    const baseExt: Extension[] = [
      neonEditorTheme,
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
    ];
    if (langSupport) baseExt.push(langSupport);

    if (mode === "inline") {
      // Unified-View — rendert eine einzige Editor-Spalte mit Inline-Markern.
      // `mergeControls: false` versteckt die Library-Default Accept/Reject-Widgets;
      // sie tun in einem readOnly-Editor nichts und das Feature ist Backlog-Scope.
      const view = new EditorView({
        state: EditorState.create({
          doc: newContent,
          extensions: [
            ...baseExt,
            unifiedMergeView({
              original: oldContent,
              highlightChanges: true,
              gutter: true,
              mergeControls: false,
            }),
          ],
        }),
        parent: container,
      });
      return () => view.destroy();
    }

    // Side-by-Side (Default). Kein `mergeControls`-Flag noetig — MergeView rendert
    // keine Accept/Reject-Buttons (das Konzept gibt's nur in unifiedMergeView).
    const merge = new MergeView({
      a: { doc: oldContent, extensions: baseExt },
      b: { doc: newContent, extensions: baseExt },
      parent: container,
      collapseUnchanged: { margin: 3, minSize: 4 },
      highlightChanges: true,
      gutter: true,
    });

    // MergeView syncs vertical scroll automatisch (line-aligned), aber nicht
    // horizontal. Wir spiegeln scrollLeft beidseitig mit Anti-Loop-Flag via rAF.
    const scrollA = merge.a.scrollDOM;
    const scrollB = merge.b.scrollDOM;
    let syncing = false;
    const mirror = (src: HTMLElement, dst: HTMLElement) => {
      if (syncing || dst.scrollLeft === src.scrollLeft) return;
      syncing = true;
      dst.scrollLeft = src.scrollLeft;
      requestAnimationFrame(() => {
        syncing = false;
      });
    };
    const onScrollA = () => mirror(scrollA, scrollB);
    const onScrollB = () => mirror(scrollB, scrollA);
    scrollA.addEventListener("scroll", onScrollA, { passive: true });
    scrollB.addEventListener("scroll", onScrollB, { passive: true });

    return () => {
      scrollA.removeEventListener("scroll", onScrollA);
      scrollB.removeEventListener("scroll", onScrollB);
      merge.destroy();
    };
  }, [file, mode, langSupport]);

  return (
    <div className="flex flex-col h-full bg-surface-base">
      <div className="px-3 py-2 border-b border-neutral-700 flex items-center gap-2">
        <span className="text-xs font-mono text-neutral-300 truncate">{file.path}</span>
        <span className="ml-auto text-[10px] font-mono">
          <span className="text-success">+{file.additions}</span>
          <span className="px-0.5 text-neutral-500">/</span>
          <span className="text-error">-{file.deletions}</span>
        </span>
      </div>
      <div
        ref={containerRef}
        data-testid="diff-merge-container"
        className="flex-1 overflow-auto"
      />
    </div>
  );
}
