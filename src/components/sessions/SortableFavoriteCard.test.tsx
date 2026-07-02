import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableFavoriteCard } from "./SortableFavoriteCard";
import type { FavoriteFolder } from "../../store/settingsStore";

const fav: FavoriteFolder = {
  id: "f1",
  path: "/f1",
  label: "F1",
  shell: "powershell",
  addedAt: 1,
  lastUsedAt: 1,
  groupId: null,
  sortIndex: 0,
};

describe("SortableFavoriteCard", () => {
  it("renders the FavoriteCard label", () => {
    render(
      <DndContext>
        <SortableContext items={["f1"]}>
          <SortableFavoriteCard
            favorite={fav}
            onStart={() => {}}
            onRemove={() => {}}
          />
        </SortableContext>
      </DndContext>
    );
    expect(screen.getByText("F1")).toBeInTheDocument();
  });

  it("makes the whole card the drag surface (no dedicated grip handle)", () => {
    const { container } = render(
      <DndContext>
        <SortableContext items={["f1"]}>
          <SortableFavoriteCard
            favorite={fav}
            onStart={() => {}}
            onRemove={() => {}}
          />
        </SortableContext>
      </DndContext>
    );
    expect(screen.queryByLabelText("Drag-Handle")).not.toBeInTheDocument();
    // dnd-kit attributes now live on the sortable root itself
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-roledescription")).toBe("sortable");
  });

  it("forwards onStart and onRemove callbacks to FavoriteCard", () => {
    const onStart = vi.fn();
    const onRemove = vi.fn();
    render(
      <DndContext>
        <SortableContext items={["f1"]}>
          <SortableFavoriteCard
            favorite={fav}
            onStart={onStart}
            onRemove={onRemove}
          />
        </SortableContext>
      </DndContext>
    );
    expect(onStart).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
