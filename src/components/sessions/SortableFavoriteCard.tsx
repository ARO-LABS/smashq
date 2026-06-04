import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FavoriteCard } from "./FavoriteCard";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import type { FavoriteFolder } from "../../store/settingsStore";

interface Props {
  favorite: FavoriteFolder;
  onStart: () => void;
  onRemove: () => void;
}

export function SortableFavoriteCard({ favorite, onStart, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: favorite.id,
      data: { type: "favorite", groupId: favorite.groupId },
    });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const Drag = ICONS.action.dragHandle;

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      <FavoriteCard favorite={favorite} onStart={onStart} onRemove={onRemove} />
      <button
        type="button"
        aria-label="Drag-Handle"
        className="absolute left-0 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity text-neutral-400 cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <Drag className={ICON_SIZE.inline} strokeWidth={2} />
      </button>
    </div>
  );
}
