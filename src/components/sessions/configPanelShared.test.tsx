import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CONFIG_TABS, ConfigPanelContent } from "./configPanelShared";

// Lazy-Viewer stumpf mocken: vi.mock fängt auch den dynamic import ab — der
// Suspense-Fallback ist damit im synchronen Erst-Render sichtbar, ohne den
// echten ClaudeMdViewer (Tauri-IPC on mount) in jsdom zu ziehen.
vi.mock("./ClaudeMdViewer", () => ({ ClaudeMdViewer: () => null }));

describe("CONFIG_TABS", () => {
  it("defines all nine configuration tabs (kanban moved to its own window)", () => {
    expect(CONFIG_TABS).toHaveLength(9);
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

  // (The former "does not include a kanban tab" test is now enforced by the
  // type system itself — "kanban" was removed from the ConfigSubTab union.)
});

describe("ConfigPanelContent Suspense-Fallback", () => {
  it("zeigt ein stilles Panel-Skeleton (role=status) statt Text „Laden...“", async () => {
    render(<ConfigPanelContent folder="/test" activeTab="claude-md" />);

    // Erst-Render: lazy-Chunk noch nicht aufgelöst → Fallback sichtbar.
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-label")).toBe("Ansicht wird geladen");
    expect(screen.queryByText("Laden...")).toBeNull();

    // Lazy-Auflösung noch im Test abwarten (vermeidet die act-Warnung) und
    // gleichzeitig festnageln: das Skeleton verschwindet, sobald der Viewer da ist.
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
