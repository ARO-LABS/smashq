import { describe, it, expect } from "vitest";
import { CONFIG_TABS } from "./configPanelShared";

describe("CONFIG_TABS", () => {
  it("defines all eight configuration tabs (kanban moved to its own window)", () => {
    expect(CONFIG_TABS).toHaveLength(8);
  });

  it("gives every tab a unique id", () => {
    const ids = CONFIG_TABS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every tab a non-empty label and an icon", () => {
    for (const tab of CONFIG_TABS) {
      expect(tab.label.length).toBeGreaterThan(0);
      expect(tab.icon).toBeTypeOf("object");
    }
  });

  it("assigns every tab to a known group", () => {
    const groups = new Set(["context", "project", "history"]);
    for (const tab of CONFIG_TABS) {
      expect(groups.has(tab.group)).toBe(true);
    }
  });

  it("requires a presence artifact for every context-group tab", () => {
    const contextTabs = CONFIG_TABS.filter((t) => t.group === "context");
    expect(contextTabs.length).toBeGreaterThan(0);
    for (const tab of contextTabs) {
      expect(tab.requiresPresence).toBeDefined();
    }
  });

  it("does not gate the history tab behind a presence artifact", () => {
    const history = CONFIG_TABS.find((t) => t.id === "history");
    expect(history).toBeDefined();
    expect(history!.requiresPresence).toBeUndefined();
  });

  it("does not include a kanban tab (moved to its own window)", () => {
    expect(CONFIG_TABS.find((t) => t.id === "kanban")).toBeUndefined();
  });
});
