import { describe, it, expect } from "vitest";
import { ICONS, ICON_SIZE } from "./icons";

describe("ICONS registry", () => {
  it("exports stable nav keys", () => {
    expect(Object.keys(ICONS.nav).sort()).toEqual(
      ["editor", "kanban", "library", "logs", "sessions", "settings"],
    );
  });

  it("exports stable theme keys", () => {
    expect(Object.keys(ICONS.theme).sort()).toEqual(["dark", "light"]);
  });

  it("exports stable toast keys", () => {
    expect(Object.keys(ICONS.toast).sort()).toEqual(
      ["achievement", "error", "info", "ready", "success"],
    );
  });

  it("exports stable update keys", () => {
    expect(Object.keys(ICONS.update).sort()).toEqual(["available", "error"]);
  });

  it("exports stable action keys", () => {
    expect(Object.keys(ICONS.action).sort()).toEqual([
      "addFavorite",
      "chevronLeft",
      "chevronRight",
      "close",
      "collapse",
      "detach",
      "diff",
      "download",
      "externalLink",
      "folderOpen",
      "loading",
      "move",
      "newSession",
      "refresh",
      "retry",
      "scrollToBottom",
      "search",
      "terminal",
      "trash",
    ]);
  });

  it("exposes every nav icon as a callable component", () => {
    for (const Icon of Object.values(ICONS.nav)) {
      expect(typeof Icon).toBe("object"); // Lucide icons are forwardRef objects
      expect(Icon).toBeTruthy();
    }
  });

  it("includes the Pin icon at the top level", () => {
    expect(ICONS.pin).toBeTruthy();
  });
});

describe("ICON_SIZE tokens", () => {
  it("maps the four canonical sizes to Tailwind classes", () => {
    expect(ICON_SIZE.inline).toBe("w-3 h-3");
    expect(ICON_SIZE.card).toBe("w-3.5 h-3.5");
    expect(ICON_SIZE.nav).toBe("w-4 h-4");
    expect(ICON_SIZE.close).toBe("w-5 h-5");
  });

  it("exposes exactly four size keys (prevents silent expansion)", () => {
    expect(Object.keys(ICON_SIZE).sort()).toEqual(
      ["card", "close", "inline", "nav"],
    );
  });

  it("every size token uses a symmetric w-/h- Tailwind pair", () => {
    for (const cls of Object.values(ICON_SIZE)) {
      const [w, h] = cls.split(" ");
      expect(w.startsWith("w-")).toBe(true);
      expect(h.startsWith("h-")).toBe(true);
      expect(w.slice(2)).toBe(h.slice(2));
    }
  });

  it("size tokens are all distinct values", () => {
    const values = Object.values(ICON_SIZE);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("ICONS registry — completeness & validity", () => {
  it("exposes the icon groups plus top-level pin + notes + tasks + group icons", () => {
    expect(Object.keys(ICONS).sort()).toEqual(
      ["action", "groupCollapse", "groupCreate", "nav", "notes", "pin", "tasks", "theme", "toast", "update"],
    );
  });

  it("exposes every action icon as a valid component", () => {
    for (const Icon of Object.values(ICONS.action)) {
      expect(Icon).toBeTruthy();
      expect(typeof Icon).toBe("object");
    }
  });

  it("exposes every theme icon as a valid component", () => {
    for (const Icon of Object.values(ICONS.theme)) {
      expect(Icon).toBeTruthy();
      expect(typeof Icon).toBe("object");
    }
  });

  it("exposes every toast icon as a valid component", () => {
    for (const Icon of Object.values(ICONS.toast)) {
      expect(Icon).toBeTruthy();
      expect(typeof Icon).toBe("object");
    }
  });

  it("exposes every update icon as a valid component", () => {
    for (const Icon of Object.values(ICONS.update)) {
      expect(Icon).toBeTruthy();
      expect(typeof Icon).toBe("object");
    }
  });

  it("light and dark theme icons are different components", () => {
    expect(ICONS.theme.light).not.toBe(ICONS.theme.dark);
  });

  it("toast.success and update.error are different components", () => {
    expect(ICONS.toast.success).not.toBe(ICONS.update.error);
  });

  it("loading icon is the Loader2 spinner component", () => {
    expect(ICONS.action.loading).toBeTruthy();
    expect(ICONS.action.loading).not.toBe(ICONS.action.refresh);
  });

  it("every leaf in every group resolves to a truthy component", () => {
    const groups = [ICONS.nav, ICONS.theme, ICONS.action, ICONS.toast, ICONS.update];
    for (const group of groups) {
      for (const Icon of Object.values(group)) {
        expect(Icon).toBeTruthy();
      }
    }
  });

  it("pin top-level icon is an object component (not a group)", () => {
    expect(typeof ICONS.pin).toBe("object");
  });

  it("action group has 19 distinct icon entries", () => {
    // dragHandle entfiel mit dem Whole-Tile-Drag (Grip-Handles entfernt).
    expect(Object.keys(ICONS.action).length).toBe(19);
  });
});
