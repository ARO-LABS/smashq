import type { ReactNode } from "react";

export interface SettingsSectionProps {
  title: string;
  children: ReactNode;
  headerAction?: ReactNode;
}

export function SettingsSection({ title, children, headerAction }: SettingsSectionProps) {
  return (
    <section className="rounded-md shadow-hairline p-4 flex flex-col gap-3 bg-surface-base">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wide">{title}</h4>
        {headerAction ?? null}
      </div>
      {children}
    </section>
  );
}
