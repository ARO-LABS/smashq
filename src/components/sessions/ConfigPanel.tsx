import { X } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import { ConfigPanelContent } from "./configPanelShared";
import { ConfigPanelTabList } from "./ConfigPanelTabList";

interface ConfigPanelProps {
  folder: string;
  width?: number;
  onResumeSession?: (sessionId: string, cwd: string, title?: string) => void;
  onClose?: () => void;
}

export function ConfigPanel({ folder, width, onResumeSession, onClose }: ConfigPanelProps) {
  const configSubTab = useUIStore((s) => s.configSubTab);
  const setConfigPanelOpen = useUIStore((s) => s.setConfigPanelOpen);

  return (
    <div
      className="flex flex-col min-h-0 shrink-0 m-2 rounded-md shadow-hairline overflow-hidden bg-surface-base"
      style={{ width: width ?? 400 }}
    >
      {/* Tab header */}
      <div className="flex items-center h-9 bg-surface-base border-b border-neutral-800 shrink-0">
        <div className="flex items-center flex-1 gap-0 px-1 overflow-x-auto">
          <ConfigPanelTabList folder={folder} size="md" />
        </div>
        <button
          onClick={() => onClose ? onClose() : setConfigPanelOpen(false)}
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
