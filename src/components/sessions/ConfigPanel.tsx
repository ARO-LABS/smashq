import { ICONS } from "../../utils/icons";
import { useUIStore } from "../../store/uiStore";
import { ConfigPanelContent } from "./configPanelShared";
import { ConfigPanelTabList } from "./ConfigPanelTabList";
import {
  accentCssVars,
  hashFolderToAccent,
  type AccentName,
} from "../../utils/sessionAccent";

interface ConfigPanelProps {
  folder: string;
  width?: number;
  /** Session-Akzent (z.B. mit Per-Session-Override aufgeloest). Default: Ordner-Hash. */
  accent?: AccentName;
  onResumeSession?: (sessionId: string, cwd: string, title?: string) => void;
  onClose?: () => void;
}

const X = ICONS.action.close;

export function ConfigPanel({ folder, width, accent, onResumeSession, onClose }: ConfigPanelProps) {
  const configSubTab = useUIStore((s) => s.configSubTab);
  const setConfigPanelCollapsed = useUIStore((s) => s.setConfigPanelCollapsed);

  return (
    <div
      className="flex flex-col min-h-0 shrink-0 m-2 rounded-md shadow-hairline overflow-hidden bg-surface-base"
      // --accent-h-Override: alle text-accent/bg-accent-a*-Klassen im Panel
      // (aktive Tabs, Icons) erben die Session-Farbe statt des globalen Cyan.
      style={{ width: width ?? 400, ...accentCssVars(accent ?? hashFolderToAccent(folder)) }}
    >
      {/* Tab header */}
      <div className="flex items-center h-9 bg-surface-base border-b border-neutral-800 shrink-0">
        <div className="flex items-center flex-1 gap-0 px-1 overflow-x-auto">
          <ConfigPanelTabList folder={folder} size="md" />
        </div>
        <button
          onClick={() => (onClose ? onClose() : setConfigPanelCollapsed(true))}
          className="p-1.5 mr-1 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="Panel schließen"
          aria-label="Konfig-Panel schließen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Config viewer content */}
      <div className="flex-1 min-h-0 overflow-auto">
        <ConfigPanelContent folder={folder} activeTab={configSubTab} onResumeSession={onResumeSession} />
      </div>
    </div>
  );
}
