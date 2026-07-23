import type { ReactNode } from "react";

export interface SettingsPanelHeaderProps {
  title: string;
  description: ReactNode;
  titleAside?: ReactNode; // AboutPanel: Versions-Badge neben dem Titel
}

export function SettingsPanelHeader({ title, description, titleAside }: SettingsPanelHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-neutral-200">{title}</h3>
        {titleAside ?? null}
      </div>
      <p className="text-xs text-neutral-500">{description}</p>
    </header>
  );
}
