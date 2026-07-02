import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FavoriteCard } from "./FavoriteCard";
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

  return (
    // Whole card is the drag surface. The SmartPointerSensor spares the
    // action buttons; the 6px activation distance spares plain clicks
    // (preview). select-none prevents accidental text selection on grab.
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative select-none ${isDragging ? "cursor-grabbing" : ""}`}
      {...attributes}
      {...listeners}
    >
      <FavoriteCard favorite={favorite} onStart={onStart} onRemove={onRemove} />
    </div>
  );
}
