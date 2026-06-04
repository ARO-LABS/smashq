import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { FavoriteGroupSection } from "./FavoriteGroupSection";
import { useUIStore } from "../../store/uiStore";
import type { FavoriteGroup, FavoriteFolder } from "../../store/settingsStore";

const group: FavoriteGroup = { id: "grp-1", label: "Arbeit", sortIndex: 0 };
const sampleItem: FavoriteFolder = {
  id: "f1", path: "/f1", label: "F1", shell: "powershell",
  addedAt: 1, lastUsedAt: 1, groupId: "grp-1", sortIndex: 0,
};

describe("FavoriteGroupSection", () => {
  beforeEach(() => {
    useUIStore.setState({ favoriteGroupsCollapsed: {} });
  });

  it("renders header with UPPERCASE label and item count", () => {
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[sampleItem]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    // Header text is the raw label; CSS uppercases it. Search by getByText for the raw value.
    expect(screen.getByText("Arbeit")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // count badge
  });

  it("hides items when collapsed via uiStore", () => {
    useUIStore.setState({ favoriteGroupsCollapsed: { "grp-1": true } });
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[sampleItem]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    expect(screen.queryByText("F1")).toBeNull();
  });

  it("collapses when chevron-button is clicked", () => {
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[sampleItem]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    expect(screen.getByText("F1")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Gruppe ein- oder ausklappen"));
    expect(screen.queryByText("F1")).toBeNull();
  });

  it("shows empty drop-zone when items array is empty", () => {
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    expect(screen.getByText(/Favorit hierhin ziehen/)).toBeInTheDocument();
  });

  it("requests group delete via the X button", () => {
    const onDelete = vi.fn();
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={onDelete}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    fireEvent.click(screen.getByLabelText("Gruppe löschen"));
    expect(onDelete).toHaveBeenCalledWith("grp-1");
  });

  it("inline-renames on double-click then commits on Enter", () => {
    const onRename = vi.fn();
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={onRename}
        />
      </DndContext>
    );
    fireEvent.doubleClick(screen.getByText("Arbeit"));
    const input = screen.getByDisplayValue("Arbeit");
    fireEvent.change(input, { target: { value: "Work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("grp-1", "Work");
  });

  it("renders a dedicated drag-handle button at the left of the header", () => {
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    expect(screen.getByLabelText("Gruppen-Drag-Handle")).toBeInTheDocument();
  });

  it("keeps the group delete button hidden until header hover", () => {
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[sampleItem]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    const del = screen.getByRole("button", { name: "Gruppe löschen" });
    expect(del).toHaveClass("opacity-0");
  });

  it("does NOT spread drag-listeners on the label span (rename area stays click-safe)", () => {
    // After refactor, the span carrying the group label must not carry
    // useSortable's aria-roledescription. If it does, the parent drag-listeners
    // are still on the rename area and could conflict with double-click.
    render(
      <DndContext>
        <FavoriteGroupSection
          group={group}
          items={[]}
          onStartFavorite={() => {}}
          onRemoveFavorite={() => {}}
          onRequestDeleteGroup={() => {}}
          onRenameGroup={() => {}}
        />
      </DndContext>
    );
    const labelSpan = screen.getByText("Arbeit");
    expect(labelSpan.getAttribute("aria-roledescription")).toBeNull();
    // Smoke: double-click reliably enters rename mode (no drag interference).
    fireEvent.doubleClick(labelSpan);
    expect(screen.getByDisplayValue("Arbeit")).toBeInTheDocument();
  });
});
