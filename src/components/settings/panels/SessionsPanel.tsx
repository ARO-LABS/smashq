import { SettingsPanelHeader } from "../shared/SettingsPanelHeader";
import { NewSessionDefaultsSection } from "../sections/NewSessionDefaultsSection";
import { TerminalScrollbackSection } from "../sections/TerminalScrollbackSection";

/**
 * Sessions-Tab (Tab-Konsolidierung, Issue #52): fasst die frueheren
 * Einzel-Tabs "Sessions" (Neue-Session-Defaults) und "Terminal"
 * (Scrollback-Limit) als zwei Sektionen unter einem Panel zusammen.
 */
export function SessionsPanel() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      <SettingsPanelHeader
        title="Sessions"
        description="Defaults für neue Sessions und wie viel Terminal-Verlauf im Speicher gehalten wird."
      />

      <NewSessionDefaultsSection />
      <TerminalScrollbackSection />
    </div>
  );
}
