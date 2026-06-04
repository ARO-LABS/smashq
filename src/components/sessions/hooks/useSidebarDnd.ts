import { useMemo } from "react";
import {
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useSettingsStore } from "../../../store/settingsStore";

export interface UseSidebarDndResult {
  sensors: SensorDescriptor<SensorOptions>[];
  handleDragEnd: (event: DragEndEvent) => void;
}

export function useSidebarDnd(): UseSidebarDndResult {
  const moveFavorite = useSettingsStore((s) => s.moveFavorite);
  const reorderFavorites = useSettingsStore((s) => s.reorderFavorites);
  const reorderFavoriteGroups = useSettingsStore((s) => s.reorderFavoriteGroups);
  const favorites = useSettingsStore((s) => s.favorites);
  const groups = useSettingsStore((s) => s.favoriteGroups);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useMemo(
    () => (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeType = active.data.current?.type;
      const overType = over.data.current?.type;

      // 1) Group reorder: header → header
      if (activeType === "group" && overType === "group") {
        const ids = [...groups].sort((a, b) => a.sortIndex - b.sortIndex).map((g) => g.id);
        const from = ids.indexOf(String(active.id));
        const to = ids.indexOf(String(over.id));
        if (from < 0 || to < 0) return;
        const next = [...ids];
        next.splice(from, 1);
        next.splice(to, 0, String(active.id));
        reorderFavoriteGroups(next);
        return;
      }

      // 2) Favorite dropped onto a group section → insert at index 0
      //
      // Two overlapping droppables exist for the same section:
      //   - groupBody: the inner body wrapper (only mounted when !collapsed)
      //   - group:     the outer useSortable wrapper covering header + body
      //
      // closestCenter picks whichever center is closer to the active rect, which
      // flips unpredictably for empty groups (tiny body height) and ALWAYS picks
      // "group" for collapsed groups (body droppable absent) and for header drops.
      // Handling both overTypes here makes the drop intent ("land this favorite
      // in this group") robust regardless of which droppable wins collision.
      if (activeType === "favorite" && (overType === "groupBody" || overType === "group")) {
        // groupBody carries groupId in its data; the outer group sortable uses
        // group.id as its own droppable id, so over.id IS the target group id.
        const targetGroupId =
          overType === "groupBody"
            ? String(over.data.current!.groupId)
            : String(over.id);
        moveFavorite(String(active.id), targetGroupId, 0);
        return;
      }

      // 3) Favorite-to-favorite drop
      if (activeType === "favorite" && overType === "favorite") {
        const activeFav = favorites.find((f) => f.id === active.id);
        const overFav = favorites.find((f) => f.id === over.id);
        if (!activeFav || !overFav) return;

        const targetGroupId = overFav.groupId;
        const siblings = favorites
          .filter((f) => f.groupId === targetGroupId)
          .sort((a, b) => a.sortIndex - b.sortIndex);
        const overIdx = siblings.findIndex((s) => s.id === overFav.id);

        if (activeFav.groupId === targetGroupId) {
          // Same group → reorder
          const ids = siblings.map((s) => s.id);
          const fromIdx = ids.indexOf(String(active.id));
          const next = [...ids];
          next.splice(fromIdx, 1);
          next.splice(overIdx, 0, String(active.id));
          reorderFavorites(targetGroupId, next);
        } else {
          // Cross-group → move
          moveFavorite(String(active.id), targetGroupId, overIdx);
        }
      }
    },
    [favorites, groups, moveFavorite, reorderFavorites, reorderFavoriteGroups],
  );

  return { sensors, handleDragEnd };
}
