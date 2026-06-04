import type { JSX } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, X } from "lucide-react";
import { ICONS } from "../../../utils/icons";
import type {
  WindowPos,
  WindowSize,
  PointerDragHandlers,
} from "../../../hooks/useDraggableWindow";
import type { ProjectNotesContext } from "./useProjectNotesContext";
import { NotesTextarea } from "./NotesTextarea";

/**
 * The portal-mounted floating notes window: segmented tab control, optional
 * folder picker, the shared textarea and the drag/resize handles. All window
 * geometry + gesture wiring is owned by `useDraggableWindow`; this component
 * only spreads the handlers onto the explicit corner elements.
 *
 * ─────────────────────────────────────────────────────────────────
 * Z-Order policy (Concept B Rollout 2026-05-21):
 *  - NotesWindow uses z-50 (fixed position via portal)
 *  - PreferencesView modal uses z-50 too — but mounts later so it
 *    naturally covers the notes panel via paint order
 *  - Toasts use higher z-index — always on top
 * If both notes + settings are open at once, settings wins. Closing
 * settings reveals notes underneath — this is intentional.
 * ─────────────────────────────────────────────────────────────────
 */
export function NotesWindow({
  ctx,
  pos,
  size,
  dragHandlers,
  resizeHandlers,
  onClose,
}: {
  ctx: ProjectNotesContext;
  pos: WindowPos | null;
  size: WindowSize;
  dragHandlers: PointerDragHandlers;
  resizeHandlers: PointerDragHandlers;
  onClose: () => void;
}): JSX.Element {
  const {
    activeTab,
    setActiveTab,
    folderPickerOpen,
    setFolderPickerOpen,
    setSelectedFolder,
    effectiveFolderKey,
    currentProjectNotes,
    setProjectNotes,
    globalNotes,
    setGlobalNotes,
    availableFolders,
    hasAnyProjectNotes,
    projectTabLabel,
    showFolderPicker,
    hasProjectContext,
  } = ctx;

  return createPortal(
    <div
      role="dialog"
      aria-label="Notizen"
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        width: size.w,
        height: size.h,
      }}
      className="z-50 bg-surface-raised rounded-md shadow-modal flex flex-col"
    >
      {/* Header: segmented-control tabs + close. Replaces brutalist
          border-b-2 underline pattern with Concept-B rounded chip tabs. */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-neutral-800">
        <div className="inline-flex p-0.5 rounded-md bg-surface-base gap-0.5 min-w-0">
          <button
            onClick={() => setActiveTab("project")}
            aria-label="Projekt-Notizen"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors truncate min-w-0 ${
              activeTab === "project"
                ? "bg-accent-a10 text-accent"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
            }`}
          >
            <span className="truncate">{projectTabLabel}</span>
            {hasAnyProjectNotes && (
              <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" aria-hidden="true" />
            )}
          </button>
          <button
            onClick={() => setActiveTab("global")}
            aria-label="Globale Notizen"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors shrink-0 ${
              activeTab === "global"
                ? "bg-accent-a10 text-accent"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
            }`}
          >
            Globale Notizen
            {globalNotes && (
              <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" aria-hidden="true" />
            )}
          </button>
        </div>
        {/* Close button — outside segmented control. The hook's
            closest("button") guard skips drag-start on this click. */}
        <button
          onClick={onClose}
          className="p-1 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-hover-overlay transition-colors"
          aria-label="Notizen schliessen"
          title="Schliessen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {activeTab === "project" ? (
        <>
          {/* Folder Picker (shown when no session active). The project
              name lives in the tab label, so the trigger is a small link
              "Projektordner wechseln" instead of a full row repeating the
              folder name (dossier §5 duplicate-header fix). */}
          {showFolderPicker && (
            <div className="relative px-3 pt-2 pb-1">
              <button
                onClick={() => setFolderPickerOpen(!folderPickerOpen)}
                aria-label="Projektordner wechseln"
                className="text-xs text-neutral-500 hover:text-accent underline-offset-2 hover:underline transition-colors"
              >
                {folderPickerOpen ? "Ordner-Wahl schliessen" : "Projektordner wechseln"}
              </button>

              {folderPickerOpen && (
                <div className="absolute left-3 right-3 top-full mt-1 z-10 max-h-48 overflow-y-auto bg-surface-overlay rounded-md shadow-lift">
                  {availableFolders.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-neutral-500 text-center">
                      Keine Projekte vorhanden — starte eine Session oder
                      fuege Favoriten hinzu
                    </div>
                  ) : (
                    availableFolders.map((f) => (
                      <button
                        key={f.key}
                        onClick={() => {
                          setSelectedFolder(f.key);
                          setFolderPickerOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                          f.key === effectiveFolderKey
                            ? "bg-accent-a15 text-accent"
                            : "text-neutral-300 hover:bg-hover-overlay"
                        }`}
                        title={f.originalPath}
                      >
                        <FolderOpen className="w-3 h-3 shrink-0 opacity-60" />
                        <span className="truncate flex-1 text-left">
                          {f.label}
                        </span>
                        {f.hasNotes && (
                          <span className="w-1.5 h-1.5 bg-accent rounded-full shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Notes Textarea */}
          {hasProjectContext ? (
            <NotesTextarea
              value={currentProjectNotes}
              onChange={(value) => setProjectNotes(effectiveFolderKey, value)}
              placeholder="Notizen für dieses Projekt..."
            />
          ) : (
            <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-neutral-500">
              {availableFolders.length === 0
                ? "Keine Projekte vorhanden"
                : "Projekt wählen um Notizen zu sehen"}
            </div>
          )}
        </>
      ) : (
        <NotesTextarea
          value={globalNotes}
          onChange={setGlobalNotes}
          placeholder="Globale Stichsaetze, Ideen, TODOs..."
        />
      )}

      {/* Drag-Handle (bottom-left) — 4-direction move arrows visually
          distinct from the diagonal resize-handle in the bottom-right.
          Drag is EXCLUSIVELY via this handle; the rest of the window is
          inert for pointer-down. Non-button element so the hook's
          interactive-element guard does not skip it. */}
      <span
        {...dragHandlers}
        role="button"
        aria-label="Notizen-Fenster verschieben"
        className="absolute left-0.5 bottom-0.5 p-0.5 cursor-move text-neutral-600 hover:text-neutral-300 transition-colors"
        style={{ touchAction: "none" }}
      >
        <ICONS.action.move className="w-3 h-3" aria-hidden="true" />
      </span>

      {/* Resize-Handle (bottom-right) — pointer-capture-resize via
          useDraggableWindow. Two diagonal strokes visually mirror the
          drag-handle to its left. */}
      <span
        {...resizeHandlers}
        role="button"
        aria-label="Notizen-Fenster vergroessern"
        className="absolute right-0 bottom-0 w-3 h-3 cursor-nwse-resize text-neutral-600 hover:text-neutral-300 transition-colors"
        style={{ touchAction: "none" }}
      >
        <svg viewBox="0 0 12 12" className="w-full h-full" aria-hidden="true">
          <path
            d="M11 5 L5 11 M11 9 L9 11"
            stroke="currentColor"
            strokeWidth="1"
            fill="none"
          />
        </svg>
      </span>
    </div>,
    document.body,
  );
}
