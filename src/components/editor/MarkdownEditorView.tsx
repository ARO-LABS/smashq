import { useCallback, useEffect, useRef, useState } from "react";
import { FileEdit } from "lucide-react";
import { Button } from "../ui/Button";
import {
  useEditorStore,
  selectIsDirty,
  selectOpenFile,
  selectIsPreviewVisible,
  selectSaveFile,
  selectUpdateContent,
  selectOpenFileFromDialog,
} from "../../store/editorStore";
import { EditorToolbar } from "./EditorToolbar";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { MarkdownPreview } from "./MarkdownPreview";

function EmptyState() {
  const openFileFromDialog = useEditorStore(selectOpenFileFromDialog);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-400">
      <FileEdit className="w-12 h-12 text-neutral-600" />
      <p className="text-sm">Keine Datei geöffnet</p>
      <Button
        variant="primary"
        onClick={openFileFromDialog}
        aria-label="Markdown-Datei öffnen"
      >
        Markdown-Datei öffnen
      </Button>
    </div>
  );
}

export function MarkdownEditorView() {
  const openFile = useEditorStore(selectOpenFile);
  const isPreviewVisible = useEditorStore(selectIsPreviewVisible);
  const isDirty = useEditorStore(selectIsDirty);
  const saveFile = useEditorStore(selectSaveFile);
  const updateContent = useEditorStore(selectUpdateContent);

  // Debounced content for preview (300ms delay)
  const [previewContent, setPreviewContent] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewContent(openFile?.content ?? "");
    }, 300);
    return () => clearTimeout(timer);
  }, [openFile?.content]);

  // Split view resize
  const [splitRatio, setSplitRatio] = useState(0.5);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleSave = useCallback(() => {
    saveFile();
  }, [saveFile]);

  // Global Ctrl+S handler (catches saves when focus is outside CodeMirror)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty) saveFile();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isDirty, saveFile]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const ratio = (ev.clientX - rect.left) / rect.width;
        setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)));
      });
    };

    const onPointerUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
  }, []);

  if (!openFile) {
    return (
      <div className="flex flex-col h-full bg-surface-base">
        <EditorToolbar />
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-base">
      <EditorToolbar />

      <div ref={containerRef} className="flex flex-1 min-h-0 overflow-hidden">
        {/* Editor pane */}
        <div
          className="min-w-0 overflow-hidden"
          style={{ width: isPreviewVisible ? `${splitRatio * 100}%` : "100%" }}
        >
          <CodeMirrorEditor
            value={openFile.content}
            onChange={updateContent}
            onSave={handleSave}
          />
        </div>

        {/* Resize handle */}
        {isPreviewVisible && (
          <div
            onPointerDown={onPointerDown}
            className="w-1 cursor-col-resize bg-neutral-700 hover:bg-accent transition-colors shrink-0"
            role="separator"
            aria-label="Editor und Vorschau Trennlinie"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft")
                setSplitRatio((r) => Math.max(0.2, r - 0.05));
              if (e.key === "ArrowRight")
                setSplitRatio((r) => Math.min(0.8, r + 0.05));
            }}
          />
        )}

        {/* Preview pane */}
        {isPreviewVisible && (
          <div
            className="min-w-0 overflow-hidden border-l border-neutral-800"
            style={{ width: `${(1 - splitRatio) * 100}%` }}
          >
            <MarkdownPreview content={previewContent} />
          </div>
        )}
      </div>
    </div>
  );
}
