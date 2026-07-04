import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Stub the sensor hooks so renderHook doesn't try to wire real PointerSensor /
// KeyboardSensor (jsdom-incompatible). We DO NOT stub anything else from the
// module — the type export `DragEndEvent` etc. stays available, and the hook's
// handleDragEnd dispatch logic runs unmodified. Trade-off: sensor config
// (`activationConstraint: { distance: 6 }`) is not exercised by this file —
// it's a static value covered by manual smoke + by the build-time @dnd-kit
// type-check.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useSensor: () => null,
    useSensors: () => [],
  };
});

import {
  useSidebarDnd,
  isInteractiveTarget,
  SmartPointerSensor,
  SmartKeyboardSensor,
} from "./useSidebarDnd";
import { useSettingsStore } from "../../../store/settingsStore";

/**
 * Build a minimal DragEndEvent for the three dispatch paths.
 *
 * useSidebarDnd only reads active.id, over.id, active.data.current.type,
 * and over.data.current.{type, groupId}. Plain object literals suffice; the
 * `as never` cast is a deliberate escape from @dnd-kit/core's wide internal
 * DragEndEvent shape for unit-test purposes.
 */
function makeEvent(
  active: { id: string; type: "group" | "favorite" },
  over: { id: string; type: "group" | "groupBody" | "favorite"; groupId?: string } | null,
) {
  return {
    active: { id: active.id, data: { current: { type: active.type } } },
    over: over
      ? { id: over.id, data: { current: { type: over.type, groupId: over.groupId } } }
      : null,
  };
}

describe("useSidebarDnd.handleDragEnd", () => {
  // Explicit action-mocks are reset for each test. We replace the store's
  // actions directly via setState (Zustand merges partial state via
  // Object.assign), so the hook's selector reads our vi.fn() rather than the
  // real action. This is more robust than vi.spyOn on getState() — which
  // depends on enumerable-property copying surviving setState — and it gives
  // perfect test isolation (no action-pollution between tests or files).
  let moveFavorite: ReturnType<typeof vi.fn>;
  let reorderFavorites: ReturnType<typeof vi.fn>;
  let reorderFavoriteGroups: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    moveFavorite = vi.fn();
    reorderFavorites = vi.fn();
    reorderFavoriteGroups = vi.fn();
    useSettingsStore.setState({
      favorites: [],
      favoriteGroups: [],
      moveFavorite,
      reorderFavorites,
      reorderFavoriteGroups,
    });
  });

  it("returns no-op when over is null", () => {
    const { result } = renderHook(() => useSidebarDnd());
    result.current.handleDragEnd(makeEvent({ id: "f1", type: "favorite" }, null) as never);
    expect(moveFavorite).not.toHaveBeenCalled();
    expect(reorderFavorites).not.toHaveBeenCalled();
    expect(reorderFavoriteGroups).not.toHaveBeenCalled();
  });

  it("returns no-op when active.id === over.id", () => {
    const { result } = renderHook(() => useSidebarDnd());
    result.current.handleDragEnd(
      makeEvent({ id: "f1", type: "favorite" }, { id: "f1", type: "favorite" }) as never,
    );
    expect(moveFavorite).not.toHaveBeenCalled();
    expect(reorderFavorites).not.toHaveBeenCalled();
    expect(reorderFavoriteGroups).not.toHaveBeenCalled();
  });

  it("group→group dispatches reorderFavoriteGroups with the new order", () => {
    useSettingsStore.setState({
      favoriteGroups: [
        { id: "g1", label: "A", sortIndex: 0 },
        { id: "g2", label: "B", sortIndex: 1000 },
        { id: "g3", label: "C", sortIndex: 2000 },
      ],
    });
    const { result } = renderHook(() => useSidebarDnd());
    // Drag g1 onto g3: ids = ["g1","g2","g3"]; splice(0,1) → ["g2","g3"];
    // splice(2,0,"g1") → ["g2","g3","g1"].
    result.current.handleDragEnd(
      makeEvent({ id: "g1", type: "group" }, { id: "g3", type: "group" }) as never,
    );
    expect(reorderFavoriteGroups).toHaveBeenCalledWith(["g2", "g3", "g1"]);
  });

  it("favorite→groupBody dispatches moveFavorite with targetIndex=0", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "f1",
          path: "/f1",
          label: "F1",
          shell: "powershell",
          addedAt: 1,
          lastUsedAt: 1,
          groupId: null,
          sortIndex: 0,
        },
      ],
      favoriteGroups: [{ id: "g1", label: "A", sortIndex: 0 }],
    });
    const { result } = renderHook(() => useSidebarDnd());
    result.current.handleDragEnd(
      makeEvent(
        { id: "f1", type: "favorite" },
        { id: "group-body-g1", type: "groupBody", groupId: "g1" },
      ) as never,
    );
    expect(moveFavorite).toHaveBeenCalledWith("f1", "g1", 0);
  });

  it("favorite↔favorite SAME group dispatches reorderFavorites with the new order", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "a",
          path: "/a",
          label: "A",
          shell: "powershell",
          addedAt: 1,
          lastUsedAt: 1,
          groupId: "g1",
          sortIndex: 0,
        },
        {
          id: "b",
          path: "/b",
          label: "B",
          shell: "powershell",
          addedAt: 2,
          lastUsedAt: 2,
          groupId: "g1",
          sortIndex: 1000,
        },
        {
          id: "c",
          path: "/c",
          label: "C",
          shell: "powershell",
          addedAt: 3,
          lastUsedAt: 3,
          groupId: "g1",
          sortIndex: 2000,
        },
      ],
      favoriteGroups: [{ id: "g1", label: "A", sortIndex: 0 }],
    });
    const { result } = renderHook(() => useSidebarDnd());
    // Drag "a" onto "c": ids = ["a","b","c"]; splice(0,1) → ["b","c"];
    // splice(2,0,"a") → ["b","c","a"].
    result.current.handleDragEnd(
      makeEvent({ id: "a", type: "favorite" }, { id: "c", type: "favorite" }) as never,
    );
    expect(reorderFavorites).toHaveBeenCalledWith("g1", ["b", "c", "a"]);
  });

  it("favorite↔favorite CROSS-group dispatches moveFavorite at the over-index", () => {
    useSettingsStore.setState({
      favorites: [
        {
          id: "a",
          path: "/a",
          label: "A",
          shell: "powershell",
          addedAt: 1,
          lastUsedAt: 1,
          groupId: "g1",
          sortIndex: 0,
        },
        {
          id: "b1",
          path: "/b1",
          label: "B1",
          shell: "powershell",
          addedAt: 2,
          lastUsedAt: 2,
          groupId: "g2",
          sortIndex: 0,
        },
        {
          id: "b2",
          path: "/b2",
          label: "B2",
          shell: "powershell",
          addedAt: 3,
          lastUsedAt: 3,
          groupId: "g2",
          sortIndex: 1000,
        },
      ],
      favoriteGroups: [
        { id: "g1", label: "A", sortIndex: 0 },
        { id: "g2", label: "B", sortIndex: 1000 },
      ],
    });
    const { result } = renderHook(() => useSidebarDnd());
    // Drag "a" (in g1) onto "b2" (idx 1 within g2 siblings).
    result.current.handleDragEnd(
      makeEvent({ id: "a", type: "favorite" }, { id: "b2", type: "favorite" }) as never,
    );
    expect(moveFavorite).toHaveBeenCalledWith("a", "g2", 1);
  });

  it("favorite→group (outer section drop) dispatches moveFavorite with targetIndex=0", () => {
    // Regression guard for the "drop on empty group placeholder does nothing" bug.
    // closestCenter can pick the outer group sortable (covering header+body)
    // instead of the inner groupBody droppable — happens for empty groups, for
    // collapsed groups (no body droppable mounted), and for header drops. Drop
    // intent is "this favorite lands in this group" regardless of which droppable
    // wins collision.
    useSettingsStore.setState({
      favorites: [
        {
          id: "f1",
          path: "/f1",
          label: "F1",
          shell: "powershell",
          addedAt: 1,
          lastUsedAt: 1,
          groupId: null,
          sortIndex: 0,
        },
      ],
      favoriteGroups: [{ id: "g1", label: "A", sortIndex: 0 }],
    });
    const { result } = renderHook(() => useSidebarDnd());
    result.current.handleDragEnd(
      makeEvent(
        { id: "f1", type: "favorite" },
        // overType is "group" — the outer useSortable on the section.
        // over.id IS the group id (useSortable uses group.id as droppable id).
        { id: "g1", type: "group" },
      ) as never,
    );
    expect(moveFavorite).toHaveBeenCalledWith("f1", "g1", 0);
  });

  it("ignores group→groupBody (unsupported drop)", () => {
    const { result } = renderHook(() => useSidebarDnd());
    result.current.handleDragEnd(
      makeEvent(
        { id: "g1", type: "group" },
        { id: "group-body-g2", type: "groupBody", groupId: "g2" },
      ) as never,
    );
    expect(moveFavorite).not.toHaveBeenCalled();
    expect(reorderFavoriteGroups).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SmartPointerSensor — whole-tile drag activation guard
// ---------------------------------------------------------------------------

describe("SmartPointerSensor guard", () => {
  function pointerEvent(target: Element, init?: { button?: number; isPrimary?: boolean }) {
    const native = new MouseEvent("pointerdown", { button: init?.button ?? 0 });
    Object.defineProperty(native, "isPrimary", { value: init?.isPrimary ?? true });
    Object.defineProperty(native, "target", { value: target });
    return { nativeEvent: native } as unknown as React.PointerEvent;
  }

  it("isInteractiveTarget matches buttons/inputs and their descendants", () => {
    const btn = document.createElement("button");
    const icon = document.createElement("span");
    btn.appendChild(icon);
    const input = document.createElement("input");
    const div = document.createElement("div");
    expect(isInteractiveTarget(btn)).toBe(true);
    expect(isInteractiveTarget(icon)).toBe(true); // closest() greift auch fuer Icon im Button
    expect(isInteractiveTarget(input)).toBe(true);
    expect(isInteractiveTarget(div)).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });

  it("activator refuses interactive targets, accepts plain tile surface", () => {
    const handler = SmartPointerSensor.activators[0].handler;
    const btn = document.createElement("button");
    const div = document.createElement("div");
    expect(handler(pointerEvent(btn))).toBe(false);
    expect(handler(pointerEvent(div))).toBe(true);
  });

  it("activator keeps the default guards: secondary button and non-primary pointer", () => {
    const handler = SmartPointerSensor.activators[0].handler;
    const div = document.createElement("div");
    // Rechtsklick muss das Accent-Kontextmenue oeffnen, nie einen Drag starten.
    expect(handler(pointerEvent(div, { button: 2 }))).toBe(false);
    expect(handler(pointerEvent(div, { isPrimary: false }))).toBe(false);
  });

  it("data-no-dnd opts an element out of drag activation", () => {
    const el = document.createElement("div");
    el.setAttribute("data-no-dnd", "true");
    expect(isInteractiveTarget(el)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SmartKeyboardSensor — keyboard-drag activation guard for editable targets
// ---------------------------------------------------------------------------

describe("SmartKeyboardSensor guard", () => {
  // dnd-kit's KeyboardSensor treats Space AND Enter as drag-start activator
  // codes and calls preventDefault() on them. Spread whole-tile via {...listeners},
  // that swallows the space/enter of an inline rename <input>. The guard must
  // let editable targets keep those keys for text entry.
  function keyboardEvent(target: Element, code: string) {
    const preventDefault = vi.fn();
    const event = {
      target,
      nativeEvent: { code },
      preventDefault,
    } as unknown as React.KeyboardEvent;
    return { event, preventDefault };
  }

  // The default handler reads active.activatorNode.current; null means "no
  // dedicated drag handle" (our whole-tile case), so its own guard is skipped.
  const context = { active: { activatorNode: { current: null } } } as never;

  it("ignores Space on an input so the rename field keeps the space", () => {
    const handler = SmartKeyboardSensor.activators[0].handler;
    const input = document.createElement("input");
    const { event, preventDefault } = keyboardEvent(input, "Space");
    expect(handler(event, {}, context)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("ignores Enter on an input (Enter is also a dnd-kit start code)", () => {
    const handler = SmartKeyboardSensor.activators[0].handler;
    const input = document.createElement("input");
    const { event, preventDefault } = keyboardEvent(input, "Enter");
    expect(handler(event, {}, context)).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("starts the drag on Space for a plain tile surface", () => {
    const handler = SmartKeyboardSensor.activators[0].handler;
    const div = document.createElement("div");
    const { event, preventDefault } = keyboardEvent(div, "Space");
    expect(handler(event, {}, context)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });
});
