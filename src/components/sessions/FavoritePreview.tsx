import { ICONS } from "../../utils/icons";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ConfigPanelContent } from "./configPanelShared";
import { ConfigPanelTabList } from "./ConfigPanelTabList";
import { accentCssVars, hashFolderToAccent, isAccentName } from "../../utils/sessionAccent";

const X = ICONS.action.close;
const FolderOpen = ICONS.action.folderOpen;

interface FavoritePreviewProps {
  folder: string;
  onClose: () => void;
  onResumeSession?: (sessionId: string, cwd: string, title?: string) => void;
}

export function FavoritePreview({ folder, onClose, onResumeSession }: FavoritePreviewProps) {
  const configSubTab = useUIStore((s) => s.configSubTab);
  const folderOverride = useSettingsStore((s) => s.folderAccents[folder]);

  const projectName = folder.split(/[/\\]/).filter(Boolean).pop() ?? folder;
  const accentName = isAccentName(folderOverride) ? folderOverride : hashFolderToAccent(folder);

  return (
    // --accent-h-Override: Header-Icon + aktive Tabs erben die Projekt-Farbe
    // (gleiche Hue-Quelle wie Sidebar-Punkt und Grid-Rahmen).
    <div className="flex flex-col h-full" style={accentCssVars(accentName)}>
      {/* Header */}
      <div className="flex items-center h-10 px-4 border-b border-neutral-800 shrink-0 bg-surface-base">
        <FolderOpen className="w-3.5 h-3.5 text-accent mr-2 shrink-0" />
        <span className="text-sm font-bold text-neutral-200 truncate mr-3">{projectName}</span>
        <span className="text-[11px] text-neutral-500 truncate mr-auto" title={folder}>{folder}</span>

        {/* Tabs (shared state with ConfigPanel via uiStore).
            isPrimary=false so the preview cannot auto-switch the global
            configSubTab when an artifact is missing for this folder. */}
        <div className="flex items-center gap-0 mx-4 overflow-x-auto">
          <ConfigPanelTabList folder={folder} size="sm" isPrimary={false} />
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-neutral-500 hover:text-neutral-300 transition-colors ml-2"
          title="Preview schließen"
          aria-label="Preview schließen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ConfigPanelContent folder={folder} activeTab={configSubTab} onResumeSession={onResumeSession} />
      </div>
    </div>
  );
}
