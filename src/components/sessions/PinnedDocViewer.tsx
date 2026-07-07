import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, FileText, Pencil, Eye, Save, Loader2, Pin } from "lucide-react";
import { getErrorMessage } from "../../utils/adpError";
import { logError } from "../../utils/errorLogger";
import { MarkdownPreview } from "../editor/MarkdownPreview";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore, normalizeProjectKey } from "../../store/settingsStore";

const CodeMirrorEditor = lazy(() =>
  import("../editor/CodeMirrorEditor").then((m) => ({ default: m.CodeMirrorEditor }))
);

interface PinnedDocViewerProps {
  folder: string;
  pinId: string;
}

export function PinnedDocViewer({ folder, pinId }: PinnedDocViewerProps) {
  const pin = useSettingsStore(
    (s) => (s.pinnedDocs[normalizeProjectKey(folder)] ?? []).find((p) => p.id === pinId) ?? null
  );
  const relativePath = pin?.relativePath ?? "";
  const label = pin?.label ?? relativePath;

  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const addToast = useUIStore((s) => s.addToast);
  const setHasDirtyEditor = useUIStore((s) => s.setHasDirtyEditor);

  const isDirty = isEditing && editContent !== (content ?? "");

  // Propagate dirty state to uiStore so tab-switch guard can warn the user
  useEffect(() => {
    setHasDirtyEditor(isDirty);
    return () => setHasDirtyEditor(false);
  }, [isDirty, setHasDirtyEditor]);

  // Ref to avoid stale closure in load() — prevents overwriting unsaved edits
  const isEditingRef = useRef(isEditing);
  useEffect(() => {
    isEditingRef.current = isEditing;
  }, [isEditing]);

  // Generation counter — discards a slow in-flight load whose folder/pin was
  // superseded (the component stays mounted across prop changes, so a stale
  // read_project_file could otherwise overwrite the current doc's content).
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const gen = ++loadGenRef.current;
    if (!relativePath) return;
    setLoading(true);
    setLoadError(null);
    try {
      const text = await invoke<string>("read_project_file", {
        folder,
        relativePath,
      });
      if (gen !== loadGenRef.current) return;
      setContent(text || null);
      if (!isEditingRef.current) setEditContent(text || "");
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      logError("PinnedDocViewer.load", err);
      setContent(null);
      setLoadError(getErrorMessage(err));
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [folder, relativePath]);

  // Reload when pin changes (different file pinned)
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
    if (isSaving || !relativePath) return;
    setIsSaving(true);
    try {
      await invoke("write_project_file", {
        folder,
        relativePath,
        content: editContent,
      });
      setContent(editContent);
      setIsEditing(false);
      addToast({ type: "success", title: `${label} gespeichert` });
    } catch (err) {
      logError("PinnedDocViewer.save", err);
      addToast({ type: "error", title: "Speichern fehlgeschlagen", message: getErrorMessage(err) });
    } finally {
      setIsSaving(false);
    }
  }, [folder, relativePath, label, editContent, isSaving, addToast]);

  // Ctrl+S handler in edit mode
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

  if (!pin) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <FileText className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Pin nicht gefunden</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade {relativePath}...
      </div>
    );
  }

  if (loadError && !isEditing) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500 px-4 text-center">
        <FileText className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Fehler beim Laden</span>
        <span className="text-xs text-neutral-600 max-w-md break-words">{loadError}</span>
        <button
          onClick={load}
          className="mt-2 px-3 py-1 text-xs text-accent border border-accent rounded hover:bg-accent-a10 transition-colors"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!content && !isEditing) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <FileText className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Datei existiert nicht oder ist leer</span>
        <span className="text-xs text-neutral-600 font-mono">{relativePath}</span>
        <button
          onClick={enterEditMode}
          className="mt-2 flex items-center gap-1 px-3 py-1 text-xs text-accent border border-accent rounded hover:bg-accent-a10 transition-colors"
        >
          <Pencil className="w-3 h-3" />
          Bearbeiten (leere Datei)
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center gap-1.5 text-xs text-neutral-400 font-medium truncate" title={relativePath}>
            <Pin className="w-3 h-3 shrink-0" aria-hidden="true" />
            {label}
          </span>
          {label !== relativePath && (
            <span className="text-[10px] text-neutral-600 font-mono truncate hidden md:inline" title={relativePath}>
              {relativePath}
            </span>
          )}
          {isDirty && (
            <span className="w-2 h-2 rounded-full bg-warning shrink-0" title="Ungespeicherte Änderungen" />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
                Editor laden...
              </div>
            }
          >
            <CodeMirrorEditor value={editContent} onChange={setEditContent} onSave={saveFile} />
          </Suspense>
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 cursor-pointer"
          onClick={enterEditMode}
          title="Klicken zum Bearbeiten"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") enterEditMode();
          }}
        >
          <MarkdownPreview content={content ?? ""} />
        </div>
      )}
    </div>
  );
}
