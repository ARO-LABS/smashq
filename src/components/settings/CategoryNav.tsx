import { SETTINGS_CATEGORIES, type SettingsCategory } from "./categories";

interface CategoryNavProps {
  activeId: string;
  onSelect: (id: string) => void;
}

export function CategoryNav({ activeId, onSelect }: CategoryNavProps) {
  return (
    <nav
      className="w-48 shrink-0 border-r border-neutral-800 flex flex-col py-2 gap-0.5"
      aria-label="Einstellungs-Kategorien"
    >
      {SETTINGS_CATEGORIES.map((cat) => (
        <CategoryNavItem
          key={cat.id}
          category={cat}
          isActive={cat.id === activeId}
          onClick={() => onSelect(cat.id)}
        />
      ))}
    </nav>
  );
}

function CategoryNavItem({
  category,
  isActive,
  onClick,
}: {
  category: SettingsCategory;
  isActive: boolean;
  onClick: () => void;
}) {
  const Icon = category.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-2 mx-1 rounded-md text-sm text-left transition-colors
        focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2
        ${isActive
          ? "border-l-2 border-accent bg-accent-a05 text-accent"
          : "border-l-2 border-transparent text-neutral-400 hover:bg-hover-overlay hover:text-neutral-200"
        }
      `}
      aria-current={isActive ? "page" : undefined}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{category.label}</span>
    </button>
  );
}
