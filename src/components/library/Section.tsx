import { ICONS, type LucideIcon } from "../../utils/icons";
import { useUIStore } from "../../store/uiStore";

const ChevronDown = ICONS.action.collapse;
const ChevronRight = ICONS.action.chevronRight;

// ── Collapsible Section ──────────────────────────────────────────────

interface SectionProps {
  icon: LucideIcon;
  title: string;
  count: number;
  defaultOpen?: boolean;
  sectionKey: string;
  children: React.ReactNode;
}

export function Section({
  icon: Icon,
  title,
  count,
  defaultOpen = false,
  sectionKey,
  children,
}: SectionProps): JSX.Element | null {
  const open = useUIStore((s) => s.librarySectionOpen[sectionKey] ?? defaultOpen);
  const setLibrarySectionOpen = useUIStore((s) => s.setLibrarySectionOpen);

  if (count === 0) return null;

  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <button
        onClick={() => setLibrarySectionOpen(sectionKey, !open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover-overlay transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neutral-500 shrink-0" />
        )}
        <Icon className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        <span className="text-xs font-medium text-neutral-300">{title}</span>
        <span className="text-[10px] text-neutral-500 ml-auto">{count}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
