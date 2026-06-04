import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSettingsStore } from "../../store/settingsStore";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { FavoriteCard } from "./FavoriteCard";
import { FavoriteGroupSection } from "./FavoriteGroupSection";
import { SortableFavoriteCard } from "./SortableFavoriteCard";
import { useSidebarDnd } from "./hooks/useSidebarDnd";
import type { FavoriteFolder } from "../../store/settingsStore";

// no-op handler for overlay clones — overlay is purely visual, drop logic runs in handleDragEnd
const NOOP = (): void => undefined;

interface FavoritesListProps {
  onQuickStart: (favorite: FavoriteFolder) => void;
}

const AddGroupIcon = ICONS.groupCreate;

export function FavoritesList({ onQuickStart }: FavoritesListProps) {
  const favorites = useSettingsStore((s) => s.favorites);
  const groups = useSettingsStore((s) => s.favoriteGroups);
  const removeFavorite = useSettingsStore((s) => s.removeFavorite);
  const addFavoriteGroup = useSettingsStore((s) => s.addFavoriteGroup);
  const renameFavoriteGroup = useSettingsStore((s) => s.renameFavoriteGroup);
  const removeFavoriteGroup = useSettingsStore((s) => s.removeFavoriteGroup);
  const { sensors, handleDragEnd } = useSidebarDnd();

  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupDraft, setGroupDraft] = useState("");
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const ungrouped = favorites
    .filter((f) => f.groupId === null)
    .sort((a, b) => a.sortIndex - b.sortIndex);
  const sortedGroups = [...groups].sort((a, b) => a.sortIndex - b.sortIndex);

  // Overlay lookup — null when nothing dragged, otherwise the favorite or group being moved.
  // Looking up by id covers both source SortableContexts (ungrouped + per-group bodies).
  const activeFavorite = activeId
    ? favorites.find((f) => f.id === activeId) ?? null
    : null;
  const activeGroup = activeId
    ? groups.find((g) => g.id === activeId) ?? null
    : null;
  const activeGroupMemberCount = activeGroup
    ? favorites.filter((f) => f.groupId === activeGroup.id).length
    : 0;

  function handleDragStart(event: DragStartEvent): void {
    setActiveId(String(event.active.id));
  }

  function handleDragEndWrapped(event: DragEndEvent): void {
    handleDragEnd(event);
    setActiveId(null);
  }

  function handleDragCancel(): void {
    setActiveId(null);
  }

  function commitGroup() {
    if (groupDraft.trim()) addFavoriteGroup(groupDraft);
    setGroupDraft("");
    setCreatingGroup(false);
  }

  const pendingGroup = pendingDelete ? groups.find((g) => g.id === pendingDelete) : null;
  const pendingMemberCount = pendingDelete
    ? favorites.filter((f) => f.groupId === pendingDelete).length
    : 0;

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEndWrapped}
        onDragCancel={handleDragCancel}
      >
        {/* Ungrouped favorites — no header, no box; flat rows */}
        {ungrouped.length > 0 && (
          <div className="pl-2">
            <SortableContext
              items={ungrouped.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              {ungrouped.map((fav) => (
                <SortableFavoriteCard
                  key={fav.id}
                  favorite={fav}
                  onStart={() => onQuickStart(fav)}
                  onRemove={() => removeFavorite(fav.id)}
                />
              ))}
            </SortableContext>
          </div>
        )}

        {/* Groups */}
        <SortableContext items={sortedGroups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
          {sortedGroups.map((g) => {
            const itemsInGroup = favorites.filter((f) => f.groupId === g.id);
            return (
              <FavoriteGroupSection
                key={g.id}
                group={g}
                items={itemsInGroup}
                onStartFavorite={(fav) => onQuickStart(fav)}
                onRemoveFavorite={(id) => removeFavorite(id)}
                onRequestDeleteGroup={(id) => setPendingDelete(id)}
                onRenameGroup={(id, label) => renameFavoriteGroup(id, label)}
              />
            );
          })}
        </SortableContext>

        {/*
          DragOverlay: portal-mounted visual clone that follows the cursor.
          Required because sources live in multiple SortableContexts (ungrouped + per-group
          bodies). Without it, dragging a favorite over a group body triggers layout shifts
          inside the inner SortableContext that visually hide the 40%-opacity source.
        */}
        <DragOverlay dropAnimation={null}>
          {activeFavorite ? (
            <FavoriteCard favorite={activeFavorite} onStart={NOOP} onRemove={NOOP} />
          ) : activeGroup ? (
            <div className="px-3 py-2 flex items-center gap-2 bg-surface-raised rounded-md shadow-lift">
              <span className="text-xs uppercase tracking-widest font-semibold text-neutral-200">
                {activeGroup.label}
              </span>
              <span className="text-xs text-neutral-500 tabular-nums">
                {activeGroupMemberCount}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* "+ Neue Gruppe" footer */}
      <div className="px-3 py-2">
        {creatingGroup ? (
          <input
            autoFocus
            value={groupDraft}
            onChange={(e) => setGroupDraft(e.target.value)}
            placeholder="Gruppen-Name…"
            onBlur={commitGroup}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitGroup();
              if (e.key === "Escape") {
                setGroupDraft("");
                setCreatingGroup(false);
              }
            }}
            className="w-full bg-surface-raised text-neutral-100 text-xs px-2 py-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
        ) : (
          <button
            onClick={() => setCreatingGroup(true)}
            aria-label="Neue Gruppe erstellen"
            className="flex items-center gap-1.5 text-[11px] text-neutral-600 hover:text-accent transition-colors"
          >
            <AddGroupIcon className={ICON_SIZE.inline} />
            <span>Neue Gruppe</span>
          </button>
        )}
      </div>

      {/* Empty global state */}
      {favorites.length === 0 && groups.length === 0 && (
        <div className="px-3 py-2 text-xs text-neutral-600">
          Ordner hinzufügen für Schnellstart
        </div>
      )}

      {/* Cascade-Modal */}
      {pendingGroup && (
        <CascadeModal
          group={pendingGroup}
          memberCount={pendingMemberCount}
          onCancel={() => setPendingDelete(null)}
          onUnassign={() => {
            removeFavoriteGroup(pendingGroup.id, "unassign");
            setPendingDelete(null);
          }}
          onDelete={() => {
            removeFavoriteGroup(pendingGroup.id, "delete");
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}

interface CascadeModalProps {
  group: { id: string; label: string };
  memberCount: number;
  onCancel: () => void;
  onUnassign: () => void;
  onDelete: () => void;
}

function CascadeModal({ group, memberCount, onCancel, onUnassign, onDelete }: CascadeModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      onClick={onCancel}
    >
      <div
        className="bg-surface-raised rounded-lg p-6 max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm uppercase tracking-widest font-semibold text-neutral-100 mb-2">
          Gruppe „{group.label}" löschen
        </h2>
        <p className="text-sm text-neutral-300 mb-4">
          Diese Gruppe enthält {memberCount} {memberCount === 1 ? "Favorit" : "Favoriten"}.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onUnassign}
            className="px-3 py-2 text-sm text-left bg-surface-base hover:bg-hover-overlay rounded-sm transition-colors"
          >
            Favoriten behalten, Gruppe auflösen
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-2 text-sm text-left bg-surface-base hover:bg-error/10 hover:text-error rounded-sm transition-colors"
          >
            Gruppe + alle Favoriten löschen
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 text-sm text-center text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
