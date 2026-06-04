import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore, isPinTab, getPinIdFromTab, type ConfigSubTab } from "./uiStore";

// ============================================================================
// Helpers
// ============================================================================

function getState() {
  return useUIStore.getState();
}

// ============================================================================
// Reset
// ============================================================================

beforeEach(() => {
  useUIStore.setState({
    detailPanel: { isOpen: false, type: null, targetId: null },
    toasts: [],
    libraryScopeOpen: {},
    librarySectionOpen: {},
  });
});

// ============================================================================
// Initial State / Defaults
// ============================================================================

describe("initial state", () => {
  it("defaults detailPanel to closed", () => {
    expect(getState().detailPanel).toEqual({
      isOpen: false,
      type: null,
      targetId: null,
    });
  });

  it("defaults toasts to empty array", () => {
    expect(getState().toasts).toEqual([]);
  });
});

// ============================================================================
// DetailPanel
// ============================================================================

describe("detailPanel", () => {
  it("opens with type and targetId", () => {
    getState().openDetailPanel("session", "s1");
    expect(getState().detailPanel).toEqual({
      isOpen: true,
      type: "session",
      targetId: "s1",
    });
  });

  it("closes and resets fields", () => {
    getState().openDetailPanel("session", "s1");
    getState().closeDetailPanel();
    expect(getState().detailPanel).toEqual({
      isOpen: false,
      type: null,
      targetId: null,
    });
  });

  it("can reopen with different target", () => {
    getState().openDetailPanel("session", "s1");
    getState().openDetailPanel("worktree", "w2");
    expect(getState().detailPanel).toEqual({
      isOpen: true,
      type: "worktree",
      targetId: "w2",
    });
  });
});

// ============================================================================
// Toasts
// ============================================================================

describe("toasts", () => {
  it("adds a toast with auto-generated ID", () => {
    getState().addToast({ type: "info", title: "Hello" });
    const toasts = getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe("info");
    expect(toasts[0].title).toBe("Hello");
    expect(toasts[0].id).toMatch(/^toast-\d+$/);
  });

  it("adds multiple toasts with unique IDs", () => {
    getState().addToast({ type: "info", title: "First" });
    getState().addToast({ type: "error", title: "Second" });
    getState().addToast({ type: "achievement", title: "Third" });
    const toasts = getState().toasts;
    expect(toasts).toHaveLength(3);
    const ids = new Set(toasts.map((t) => t.id));
    expect(ids.size).toBe(3);
  });

  it("removes toast by ID", () => {
    getState().addToast({ type: "info", title: "Stay" });
    getState().addToast({ type: "error", title: "Remove" });
    const toastToRemove = getState().toasts[1];
    getState().removeToast(toastToRemove.id);
    expect(getState().toasts).toHaveLength(1);
    expect(getState().toasts[0].title).toBe("Stay");
  });

  it("removeToast is a no-op for non-existent ID", () => {
    getState().addToast({ type: "info", title: "Stay" });
    getState().removeToast("toast-nonexistent");
    expect(getState().toasts).toHaveLength(1);
  });

  it("preserves optional fields (message, duration)", () => {
    getState().addToast({
      type: "achievement",
      title: "Level Up",
      message: "You reached level 5",
      duration: 5000,
    });
    const toast = getState().toasts[0];
    expect(toast.message).toBe("You reached level 5");
    expect(toast.duration).toBe(5000);
  });

  // FIX: Toast array is capped at 10 entries
  it("limits toasts to max 10", () => {
    for (let i = 0; i < 100; i++) {
      getState().addToast({ type: "info", title: `Toast ${i}` });
    }
    expect(getState().toasts).toHaveLength(10);
    // Should keep the most recent 10
    expect(getState().toasts[0].title).toBe("Toast 90");
    expect(getState().toasts[9].title).toBe("Toast 99");
  });

  // Note: toastCounter is a module-level let, meaning IDs are globally
  // incrementing across tests and app lifetime. This is not a bug per se
  // but means IDs are not reset between test runs.
  it("toast IDs are monotonically increasing across calls", () => {
    getState().addToast({ type: "info", title: "A" });
    getState().addToast({ type: "info", title: "B" });
    const [a, b] = getState().toasts;
    const idA = parseInt(a.id.replace("toast-", ""), 10);
    const idB = parseInt(b.id.replace("toast-", ""), 10);
    expect(idB).toBeGreaterThan(idA);
  });

  it("addToast returns the generated id", () => {
    const id = getState().addToast({ type: "info", title: "X" });
    expect(typeof id).toBe("string");
    expect(getState().toasts.at(-1)!.id).toBe(id);
  });

  it("updateToast merges a partial into the matching toast", () => {
    const id = getState().addToast({ type: "info", title: "DL", progress: 0 });
    getState().updateToast(id, { progress: 42 });
    expect(getState().toasts.find((t) => t.id === id)!.progress).toBe(42);
  });

  it("updateToast is a no-op for an unknown id", () => {
    getState().addToast({ type: "info", title: "Y" });
    const before = getState().toasts;
    getState().updateToast("toast-does-not-exist", { progress: 99 });
    expect(getState().toasts).toEqual(before);
  });
});

// ============================================================================
// libraryScopeOpen — persists per scope
// ============================================================================

describe("libraryScopeOpen_setScopeOpen_persists_per_scope", () => {
  it("defaults to empty record", () => {
    expect(getState().libraryScopeOpen).toEqual({});
  });

  it("sets a scope open state", () => {
    getState().setLibraryScopeOpen("global", true);
    expect(getState().libraryScopeOpen["global"]).toBe(true);
  });

  it("sets a scope closed state", () => {
    getState().setLibraryScopeOpen("global", true);
    getState().setLibraryScopeOpen("global", false);
    expect(getState().libraryScopeOpen["global"]).toBe(false);
  });

  it("tracks multiple scopes independently", () => {
    getState().setLibraryScopeOpen("global", true);
    getState().setLibraryScopeOpen("project:/foo/bar", false);
    getState().setLibraryScopeOpen("fav:fav-123", true);
    expect(getState().libraryScopeOpen["global"]).toBe(true);
    expect(getState().libraryScopeOpen["project:/foo/bar"]).toBe(false);
    expect(getState().libraryScopeOpen["fav:fav-123"]).toBe(true);
  });

  it("unknown scope returns undefined (component falls back to defaultOpen)", () => {
    expect(getState().libraryScopeOpen["unknown-scope"]).toBeUndefined();
  });
});

// ============================================================================
// librarySectionOpen — persists per key
// ============================================================================

describe("librarySectionOpen_setSectionOpen_persists_per_key", () => {
  it("defaults to empty record", () => {
    expect(getState().librarySectionOpen).toEqual({});
  });

  it("sets a section open state", () => {
    getState().setLibrarySectionOpen("global:skills", true);
    expect(getState().librarySectionOpen["global:skills"]).toBe(true);
  });

  it("sets a section closed state", () => {
    getState().setLibrarySectionOpen("global:skills", true);
    getState().setLibrarySectionOpen("global:skills", false);
    expect(getState().librarySectionOpen["global:skills"]).toBe(false);
  });

  it("tracks multiple sections independently", () => {
    getState().setLibrarySectionOpen("global:skills", true);
    getState().setLibrarySectionOpen("global:agents", false);
    getState().setLibrarySectionOpen("project:hooks", true);
    expect(getState().librarySectionOpen["global:skills"]).toBe(true);
    expect(getState().librarySectionOpen["global:agents"]).toBe(false);
    expect(getState().librarySectionOpen["project:hooks"]).toBe(true);
  });

  it("unknown key returns undefined (component falls back to defaultOpen)", () => {
    expect(getState().librarySectionOpen["nonexistent:key"]).toBeUndefined();
  });
});

// ============================================================================
// isPinTab — type guard
// ============================================================================

describe("isPinTab", () => {
  it("returns true for a pin: prefixed tab", () => {
    expect(isPinTab("pin:abc123")).toBe(true);
  });

  it("returns true for pin: with empty id", () => {
    expect(isPinTab("pin:" as ConfigSubTab)).toBe(true);
  });

  it("returns false for non-pin sub-tabs", () => {
    expect(isPinTab("claude-md")).toBe(false);
    expect(isPinTab("skills")).toBe(false);
    expect(isPinTab("hooks")).toBe(false);
    expect(isPinTab("github")).toBe(false);
    expect(isPinTab("history")).toBe(false);
  });

  it("returns false when 'pin' appears but not as prefix", () => {
    expect(isPinTab("settings" as ConfigSubTab)).toBe(false);
  });

  it("returns false for a tab merely containing 'pin' mid-string", () => {
    expect(isPinTab("notapin:x" as ConfigSubTab)).toBe(false);
  });
});

// ============================================================================
// getPinIdFromTab — extraction helper
// ============================================================================

describe("getPinIdFromTab", () => {
  it("extracts the id after the pin: prefix", () => {
    expect(getPinIdFromTab("pin:doc-42")).toBe("doc-42");
  });

  it("returns empty string for 'pin:' with no id", () => {
    expect(getPinIdFromTab("pin:" as ConfigSubTab)).toBe("");
  });

  it("returns null for non-pin tabs", () => {
    expect(getPinIdFromTab("claude-md")).toBeNull();
    expect(getPinIdFromTab("kanban")).toBeNull();
  });

  it("preserves colons inside the pin id", () => {
    expect(getPinIdFromTab("pin:a:b:c" as ConfigSubTab)).toBe("a:b:c");
  });
});

// ============================================================================
// configSubTab
// ============================================================================

describe("configSubTab", () => {
  it("defaults to 'claude-md'", () => {
    useUIStore.setState({ configSubTab: "claude-md" });
    expect(getState().configSubTab).toBe("claude-md");
  });

  it("sets a standard sub-tab", () => {
    getState().setConfigSubTab("hooks");
    expect(getState().configSubTab).toBe("hooks");
  });

  it("sets a dynamic pin: sub-tab", () => {
    getState().setConfigSubTab("pin:my-pin");
    expect(getState().configSubTab).toBe("pin:my-pin");
    expect(isPinTab(getState().configSubTab)).toBe(true);
  });
});

// ============================================================================
// configPanel — open/toggle/width
// ============================================================================

describe("configPanel", () => {
  beforeEach(() => {
    useUIStore.setState({ configPanelOpen: false, configPanelWidth: 400 });
  });

  it("defaults configPanelOpen to false", () => {
    expect(getState().configPanelOpen).toBe(false);
  });

  it("toggleConfigPanel flips false → true", () => {
    getState().toggleConfigPanel();
    expect(getState().configPanelOpen).toBe(true);
  });

  it("toggleConfigPanel flips true → false", () => {
    getState().toggleConfigPanel();
    getState().toggleConfigPanel();
    expect(getState().configPanelOpen).toBe(false);
  });

  it("setConfigPanelOpen sets explicit state", () => {
    getState().setConfigPanelOpen(true);
    expect(getState().configPanelOpen).toBe(true);
    getState().setConfigPanelOpen(false);
    expect(getState().configPanelOpen).toBe(false);
  });

  it("defaults configPanelWidth to 400", () => {
    expect(getState().configPanelWidth).toBe(400);
  });

  it("setConfigPanelWidth accepts an in-range value", () => {
    getState().setConfigPanelWidth(500);
    expect(getState().configPanelWidth).toBe(500);
  });

  it("clamps width below 250 up to 250", () => {
    getState().setConfigPanelWidth(100);
    expect(getState().configPanelWidth).toBe(250);
  });

  it("clamps width above 800 down to 800", () => {
    getState().setConfigPanelWidth(2000);
    expect(getState().configPanelWidth).toBe(800);
  });

  it("accepts the exact lower boundary 250", () => {
    getState().setConfigPanelWidth(250);
    expect(getState().configPanelWidth).toBe(250);
  });

  it("accepts the exact upper boundary 800", () => {
    getState().setConfigPanelWidth(800);
    expect(getState().configPanelWidth).toBe(800);
  });

  it("clamps negative width to 250", () => {
    getState().setConfigPanelWidth(-50);
    expect(getState().configPanelWidth).toBe(250);
  });
});

// ============================================================================
// hasDirtyEditor
// ============================================================================

describe("hasDirtyEditor", () => {
  beforeEach(() => {
    useUIStore.setState({ hasDirtyEditor: false });
  });

  it("defaults to false", () => {
    expect(getState().hasDirtyEditor).toBe(false);
  });

  it("sets dirty true", () => {
    getState().setHasDirtyEditor(true);
    expect(getState().hasDirtyEditor).toBe(true);
  });

  it("sets dirty back to false", () => {
    getState().setHasDirtyEditor(true);
    getState().setHasDirtyEditor(false);
    expect(getState().hasDirtyEditor).toBe(false);
  });
});

// ============================================================================
// previewFolder
// ============================================================================

describe("previewFolder", () => {
  beforeEach(() => {
    useUIStore.setState({ previewFolder: null });
  });

  it("defaults to null", () => {
    expect(getState().previewFolder).toBeNull();
  });

  it("openPreview sets the folder", () => {
    getState().openPreview("/projects/foo");
    expect(getState().previewFolder).toBe("/projects/foo");
  });

  it("closePreview resets to null", () => {
    getState().openPreview("/projects/foo");
    getState().closePreview();
    expect(getState().previewFolder).toBeNull();
  });

  it("openPreview can replace an existing folder", () => {
    getState().openPreview("/a");
    getState().openPreview("/b");
    expect(getState().previewFolder).toBe("/b");
  });

  it("openPreview accepts an empty string", () => {
    getState().openPreview("");
    expect(getState().previewFolder).toBe("");
  });
});

// ============================================================================
// toasts — action field + ordering
// ============================================================================

describe("toasts — action + ordering", () => {
  it("preserves an inline action button", () => {
    const onClick = () => {};
    getState().addToast({ type: "info", title: "Undo me", action: { label: "Rückgängig", onClick } });
    expect(getState().toasts[0].action?.label).toBe("Rückgängig");
    expect(getState().toasts[0].action?.onClick).toBe(onClick);
  });

  it("appends new toasts to the end", () => {
    getState().addToast({ type: "info", title: "First" });
    getState().addToast({ type: "info", title: "Second" });
    expect(getState().toasts[0].title).toBe("First");
    expect(getState().toasts[1].title).toBe("Second");
  });

  it("removeToast on empty list is a no-op", () => {
    getState().removeToast("anything");
    expect(getState().toasts).toEqual([]);
  });

  it("removing the only toast empties the list", () => {
    getState().addToast({ type: "success", title: "Solo" });
    getState().removeToast(getState().toasts[0].id);
    expect(getState().toasts).toEqual([]);
  });

  it("supports all four toast types", () => {
    (["achievement", "error", "info", "success"] as const).forEach((t) =>
      getState().addToast({ type: t, title: t }),
    );
    expect(getState().toasts.map((t) => t.type)).toEqual([
      "achievement",
      "error",
      "info",
      "success",
    ]);
  });

  it("at the 10-cap the oldest toast is dropped first", () => {
    for (let i = 0; i < 11; i++) {
      getState().addToast({ type: "info", title: `T${i}` });
    }
    expect(getState().toasts).toHaveLength(10);
    expect(getState().toasts[0].title).toBe("T1");
  });
});

// ============================================================================
// libraryScopeOpen / librarySectionOpen — overwrite + key isolation
// ============================================================================

describe("library open-state overwrite semantics", () => {
  it("setLibraryScopeOpen overwrites without touching sibling keys", () => {
    getState().setLibraryScopeOpen("a", true);
    getState().setLibraryScopeOpen("b", true);
    getState().setLibraryScopeOpen("a", false);
    expect(getState().libraryScopeOpen).toEqual({ a: false, b: true });
  });

  it("setLibrarySectionOpen overwrites without touching sibling keys", () => {
    getState().setLibrarySectionOpen("x", true);
    getState().setLibrarySectionOpen("y", false);
    getState().setLibrarySectionOpen("x", false);
    expect(getState().librarySectionOpen).toEqual({ x: false, y: false });
  });

  it("scope and section records are independent", () => {
    getState().setLibraryScopeOpen("shared", true);
    getState().setLibrarySectionOpen("shared", false);
    expect(getState().libraryScopeOpen["shared"]).toBe(true);
    expect(getState().librarySectionOpen["shared"]).toBe(false);
  });
});

// ============================================================================
// favoriteGroupsCollapsed — toggle collapse state per group
// ============================================================================

describe("favoriteGroupsCollapsed", () => {
  beforeEach(() => {
    useUIStore.setState({ favoriteGroupsCollapsed: {} });
  });

  it("toggles collapsed state for a groupId", () => {
    getState().toggleFavoriteGroupCollapsed("grp-1");
    expect(getState().favoriteGroupsCollapsed["grp-1"]).toBe(true);
    getState().toggleFavoriteGroupCollapsed("grp-1");
    expect(getState().favoriteGroupsCollapsed["grp-1"]).toBe(false);
  });

  it("toggles independently per groupId", () => {
    getState().toggleFavoriteGroupCollapsed("grp-a");
    getState().toggleFavoriteGroupCollapsed("grp-b");
    expect(getState().favoriteGroupsCollapsed["grp-a"]).toBe(true);
    expect(getState().favoriteGroupsCollapsed["grp-b"]).toBe(true);
    getState().toggleFavoriteGroupCollapsed("grp-a");
    expect(getState().favoriteGroupsCollapsed["grp-a"]).toBe(false);
    expect(getState().favoriteGroupsCollapsed["grp-b"]).toBe(true);
  });

  it("defaults to empty map (all groups expanded)", () => {
    expect(getState().favoriteGroupsCollapsed).toEqual({});
  });
});
