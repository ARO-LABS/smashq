import { ICONS } from "../../utils/icons";
import {
  useEditorStore,
  selectIsDirty,
  selectOpenFile,
  selectIsSaving,
  selectIsPreviewVisible,
  selectSaveFile,
  selectTogglePreview,
  selectOpenFileFromDialog,
  selectCloseFile,
} from "../../store/editorStore";

const Save = ICONS.action.save;
const Eye = ICONS.action.preview;
const EyeOff = ICONS.action.previewOff;
const FolderOpen = ICONS.action.folderOpen;
const X = ICONS.action.close;
const FileEdit = ICONS.nav.editor;

export function EditorToolbar() {
  const openFile = useEditorStore(selectOpenFile);
  const isDirty = useEditorStore(selectIsDirty);
  const isSaving = useEditorStore(selectIsSaving);
  const isPreviewVisible = useEditorStore(selectIsPreviewVisible);
  const saveFile = useEditorStore(selectSaveFile);
  const togglePreview = useEditorStore(selectTogglePreview);
  const openFileFromDialog = useEditorStore(selectOpenFileFromDialog);
  const closeFile = useEditorStore(selectCloseFile);

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-base border-b border-neutral-800 min-h-[44px]">
      <FileEdit className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />

      {/* File name */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {openFile ? (
          <>
            <span className="text-sm text-neutral-200 truncate font-mono">
              {openFile.relativePath}
            </span>
            {isDirty && (
              <span
                className="w-2 h-2 rounded-full bg-warning shrink-0"
                title="Ungespeicherte Änderungen"
                aria-label="Ungespeicherte Änderungen"
                role="img"
              />
            )}
          </>
        ) : (
          <span className="text-sm text-neutral-500">
            Keine Datei geöffnet
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={openFileFromDialog}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 hover:bg-hover-overlay rounded-md transition-colors"
          title="Datei öffnen"
          aria-label="Markdown-Datei öffnen"
        >
          <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Öffnen</span>
        </button>

        <button
          onClick={saveFile}
          disabled={!isDirty || isSaving}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md transition-colors ${
            isDirty
              ? "text-accent bg-accent-a10 hover:bg-accent-a15"
              : "text-neutral-500 cursor-not-allowed"
          }`}
          title="Speichern (Ctrl+S)"
          aria-label="Datei speichern"
        >
          <Save className="w-3.5 h-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">
            {isSaving ? "Speichert..." : "Speichern"}
          </span>
        </button>

        <button
          onClick={togglePreview}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-neutral-300 hover:text-neutral-100 hover:bg-hover-overlay rounded-md transition-colors"
          title={isPreviewVisible ? "Vorschau ausblenden" : "Vorschau einblenden"}
          aria-label={isPreviewVisible ? "Vorschau ausblenden" : "Vorschau einblenden"}
        >
          {isPreviewVisible ? (
            <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>

        {openFile && (
          <button
            onClick={closeFile}
            className="flex items-center px-1.5 py-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-hover-overlay rounded-md transition-colors"
            title="Datei schließen"
            aria-label="Datei schließen"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
