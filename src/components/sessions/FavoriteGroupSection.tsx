import { useState } from "react";
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { SortableFavoriteCard } from "./SortableFavoriteCard";
import { useUIStore } from "../../store/uiStore";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { FavoriteFolder, FavoriteGroup } from "../../store/settingsStore";

interface Props {
  group: FavoriteGroup;
  items: FavoriteFolder[];
  onStartFavorite: (fav: FavoriteFolder) => void;
  onRemoveFavorite: (id: string) => void;
  onRequestDeleteGroup: (id: string) => void;
  onRenameGroup: (id: string, label: string) => void;
}

export function FavoriteGroupSection({
  group,
  items,
  onStartFavorite,
  onRemoveFavorite,
  onRequestDeleteGroup,
  onRenameGroup,
}: Props): React.ReactElement {
  const collapsed = useUIStore((s) => !!s.favoriteGroupsCollapsed[group.id]);
  const toggleCollapsed = useUIStore((s) => s.toggleFavoriteGroupCollapsed);

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(group.label);

  // Header itself is sortable (drives group-reordering).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: group.id,
      data: { type: "group" },
    });

  // Body of the group is a droppable area (id used by the sidebar DnD hook).
  const { setNodeRef: setBodyRef } = useDroppable({
    id: `group-body-${group.id}`,
    data: { type: "groupBody", groupId: group.id },
  });

  // ICONS.groupCollapse = ChevronDown (added in T9).
  const Chevron = ICONS.groupCollapse;
  const CloseIcon = ICONS.action.close;

  const sortedItems = [...items].sort((a, b) => a.sortIndex - b.sortIndex);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  function commitRename(): void {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== group.label) onRenameGroup(group.id, trimmed);
    setRenaming(false);
  }

  return (
    <div ref={setNodeRef} style={style} className="mt-1 group">
      {/* Header row = drag surface. Listeners live HERE (not on the section
          root) so favorite drags inside the body don't bubble into the group
          sensor. Chevron/delete/rename-input are spared by the
          SmartPointerSensor interactive guard. */}
      <div
        className={`flex items-center justify-between px-3 py-2 hover:bg-hover-overlay transition-colors select-none ${isDragging ? "cursor-grabbing" : ""}`}
        {...attributes}
        {...listeners}
      >
        <div className="flex items-center gap-1.5 flex-1">
          <button
            type="button"
            aria-label="Gruppe ein- oder ausklappen"
            onClick={() => toggleCollapsed(group.id)}
            className="text-neutral-500"
          >
            <Chevron
              className={`${ICON_SIZE.inline} transition-transform duration-100 ${collapsed ? "-rotate-90" : ""}`}
              strokeWidth={2}
            />
          </button>
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraft(group.label);
                  setRenaming(false);
                }
              }}
              className="bg-surface-raised text-neutral-100 text-xs tracking-wide px-1 py-0.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-accent"
            />
          ) : (
            <span
              onDoubleClick={() => setRenaming(true)}
              className="text-xs tracking-wide font-semibold text-neutral-400 cursor-text select-none"
            >
              {group.label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 tabular-nums">{items.length}</span>
          <button
            type="button"
            aria-label="Gruppe löschen"
            onClick={() => onRequestDeleteGroup(group.id)}
            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-error transition-all"
          >
            <CloseIcon className={ICON_SIZE.card} strokeWidth={2} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div ref={setBodyRef} className="pl-2">
          <SortableContext
            items={sortedItems.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            {sortedItems.length === 0 ? (
              <div className="border border-dashed border-neutral-700 py-3 text-center text-xs text-neutral-500 rounded-sm">
                Favorit hierhin ziehen
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {sortedItems.map((fav) => (
                  <SortableFavoriteCard
                    key={fav.id}
                    favorite={fav}
                    onStart={() => onStartFavorite(fav)}
                    onRemove={() => onRemoveFavorite(fav.id)}
                  />
                ))}
              </div>
            )}
          </SortableContext>
        </div>
      )}
    </div>
  );
}
