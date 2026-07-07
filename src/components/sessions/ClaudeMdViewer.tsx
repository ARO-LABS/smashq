import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, FileText, Pencil, Eye, Save, Loader2 } from "lucide-react";
import { getErrorMessage } from "../../utils/adpError";
import { logError } from "../../utils/errorLogger";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import { useUIStore } from "../../store/uiStore";

const CodeMirrorEditor = lazy(() =>
  import("../editor/CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor }))
);

interface ClaudeMdViewerProps {
  folder: string;
}

export function ClaudeMdViewer({ folder }: ClaudeMdViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const addToast = useUIStore((s) => s.addToast);

  const isDirty = isEditing && editContent !== (content ?? "");

  // Ref to avoid stale closure in load() — prevents overwriting unsaved edits
  const isEditingRef = useRef(isEditing);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);

  // Generation counter — discards a slow in-flight load whose folder was
  // superseded (the component stays mounted across folder prop changes, so
  // a stale read_project_file could otherwise overwrite the new folder's content).
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    try {
      // Resolve to the main working tree root — worktree sessions may point to a
      // branch-specific path that lacks or has a different CLAUDE.md.
      const resolvedFolder = await invoke<string>("resolve_project_root", { folder });
      const text = await invoke<string>("read_project_file", {
        folder: resolvedFolder,
        relativePath: "CLAUDE.md",
      });
      if (gen !== loadGenRef.current) return;
      setContent(text || null);
      if (!isEditingRef.current) setEditContent(text || "");
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      logError("ClaudeMdViewer.load", err);
      setContent(null);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    setIsEditing(false);
    load();
  }, [load]);

  const enterEditMode = useCallback(() => {
    setEditContent(content ?? "");
    setIsEditing(true);
  }, [content]);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setEditContent(content ?? "");
  }, [content]);

  const saveFile = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const resolvedFolder = await invoke<string>("resolve_project_root", { folder });
      await invoke("write_project_file", {
        folder: resolvedFolder,
        relativePath: "CLAUDE.md",
        content: editContent,
      });
      setContent(editContent);
      setIsEditing(false);
      addToast({ type: "success", title: "CLAUDE.md gespeichert" });
    } catch (err) {
      logError("ClaudeMdViewer.save", err);
      addToast({ type: "error", title: "Speichern fehlgeschlagen", message: getErrorMessage(err) });
    } finally {
      setIsSaving(false);
    }
  }, [folder, editContent, isSaving, addToast]);

  // Ctrl+S handler in edit mode (stopPropagation prevents double-fire with MarkdownEditorView)
  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (isDirty) saveFile();
      }
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [isEditing, isDirty, saveFile]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade CLAUDE.md...
      </div>
    );
  }

  if (!content && !isEditing) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <FileText className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Keine CLAUDE.md in diesem Projekt gefunden</span>
        <span className="text-xs text-neutral-600">{folder}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400 font-medium uppercase tracking-widest">CLAUDE.md</span>
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-warning" title="Ungespeicherte Änderungen" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {isEditing ? (
            <>
              <button
                onClick={saveFile}
                disabled={!isDirty || isSaving}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-accent hover:bg-accent-a10"
                title="Speichern (Ctrl+S)"
                aria-label="Datei speichern"
              >
                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Speichern
              </button>
              <button
                onClick={exitEditMode}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200 rounded hover:bg-hover-overlay transition-colors"
                title="Zur Vorschau"
                aria-label="Zurück zur Vorschau"
              >
                <Eye className="w-3 h-3" />
                Vorschau
              </button>
            </>
          ) : (
            <button
              onClick={enterEditMode}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-neutral-400 hover:text-neutral-200 rounded hover:bg-hover-overlay transition-colors"
              title="Bearbeiten"
              aria-label="Datei bearbeiten"
            >
              <Pencil className="w-3 h-3" />
              Bearbeiten
            </button>
          )}
          <button
            onClick={load}
            className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Neu laden"
            aria-label="Neu laden"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      {isEditing ? (
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="flex items-center justify-center h-full text-neutral-500 text-sm">Editor laden...</div>}>
            <CodeMirrorEditor
              value={editContent}
              onChange={setEditContent}
              onSave={saveFile}
            />
          </Suspense>
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 cursor-pointer"
          onClick={enterEditMode}
          title="Klicken zum Bearbeiten"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") enterEditMode(); }}
        >
          <MarkdownPreview content={content ?? ""} />
        </div>
      )}
    </div>
  );
}
