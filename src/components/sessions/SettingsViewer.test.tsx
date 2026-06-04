import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildSettingsSections, parseSettings, SettingsViewer } from "./SettingsViewer";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ── Unit tests: parseSettings ──

describe("parseSettings", () => {
  it("parses valid JSON object", () => {
    const result = parseSettings(JSON.stringify({ allowedTools: ["Bash"] }));
    expect(result).toEqual({ allowedTools: ["Bash"] });
  });

  it("returns null for invalid JSON", () => {
    expect(parseSettings("not json")).toBeNull();
  });

  it("returns null for arrays", () => {
    expect(parseSettings("[]")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseSettings("")).toBeNull();
  });

  it("returns null for JSON primitives (number, string, bool)", () => {
    expect(parseSettings("42")).toBeNull();
    expect(parseSettings('"hello"')).toBeNull();
    expect(parseSettings("true")).toBeNull();
  });

  it("returns null for JSON null literal", () => {
    expect(parseSettings("null")).toBeNull();
  });

  it("parses nested objects intact", () => {
    const result = parseSettings(
      JSON.stringify({ permissions: { allow: ["Bash"], deny: [] } }),
    );
    expect(result).toEqual({ permissions: { allow: ["Bash"], deny: [] } });
  });

  it("parses an empty object", () => {
    expect(parseSettings("{}")).toEqual({});
  });
});

// ── Unit tests: buildSettingsSections ──

describe("buildSettingsSections", () => {
  it("groups settings by key with source attribution", () => {
    const raws = {
      project: JSON.stringify({
        allowedTools: ["Bash", "Edit"],
        mcpServers: { playwright: { command: "npx" } },
      }),
      "project-local": "",
      user: JSON.stringify({
        allowedTools: ["Read"],
        model: "opus",
      }),
    };

    const sections = buildSettingsSections(raws);

    // allowedTools appears first (known section order)
    expect(sections[0].title).toBe("Erlaubte Tools");
    expect(sections[0].entries).toHaveLength(2);
    expect(sections[0].entries[0].source).toBe("project");
    expect(sections[0].entries[1].source).toBe("user");

    // mcpServers
    const mcpSection = sections.find((s) => s.title === "MCP-Server");
    expect(mcpSection).toBeDefined();
    expect(mcpSection!.entries[0].source).toBe("project");

    // model
    const modelSection = sections.find((s) => s.title === "Modell");
    expect(modelSection).toBeDefined();
    expect(modelSection!.entries[0].value).toBe("opus");
    expect(modelSection!.entries[0].source).toBe("user");
  });

  it("excludes hooks key (shown in Hooks tab)", () => {
    const raws = {
      project: JSON.stringify({
        hooks: { PreToolUse: [] },
        allowedTools: ["Bash"],
      }),
      "project-local": "",
      user: "",
    };

    const sections = buildSettingsSections(raws);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Erlaubte Tools");
  });

  it("returns empty array when no settings exist", () => {
    const sections = buildSettingsSections({ project: "", "project-local": "", user: "" });
    expect(sections).toHaveLength(0);
  });

  it("handles invalid JSON gracefully", () => {
    const sections = buildSettingsSections({
      project: "broken{",
      "project-local": "",
      user: JSON.stringify({ model: "sonnet" }),
    });
    expect(sections).toHaveLength(1);
    expect(sections[0].entries[0].source).toBe("user");
  });

  it("handles unknown keys with fallback title", () => {
    const raws = {
      project: JSON.stringify({ customKey: "value" }),
      "project-local": "",
      user: "",
    };

    const sections = buildSettingsSections(raws);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("customKey");
  });

  it("orders known sections by SECTION_CONFIG, unknown alphabetically last", () => {
    const raws = {
      project: JSON.stringify({
        zebra: 1,
        model: "opus",
        alpha: 2,
        allowedTools: ["Bash"],
      }),
      "project-local": "",
      user: "",
    };

    const titles = buildSettingsSections(raws).map((s) => s.title);
    // Bekannte Sektionen zuerst in Config-Reihenfolge: allowedTools vor model.
    expect(titles.indexOf("Erlaubte Tools")).toBeLessThan(titles.indexOf("Modell"));
    // Unbekannte Keys danach, alphabetisch: alpha vor zebra.
    expect(titles.indexOf("alpha")).toBeLessThan(titles.indexOf("zebra"));
    // Bekannte Sektionen stehen vor allen unbekannten.
    expect(titles.indexOf("Modell")).toBeLessThan(titles.indexOf("alpha"));
  });

  it("collects the same key from project-local source too", () => {
    const raws = {
      project: JSON.stringify({ allowedTools: ["Bash"] }),
      "project-local": JSON.stringify({ allowedTools: ["Write"] }),
      user: "",
    };

    const sections = buildSettingsSections(raws);
    expect(sections).toHaveLength(1);
    expect(sections[0].entries).toHaveLength(2);
    expect(sections[0].entries[0].source).toBe("project");
    expect(sections[0].entries[1].source).toBe("project-local");
  });

  it("ignores a source that contains only the excluded hooks key", () => {
    const raws = {
      project: JSON.stringify({ hooks: { PreToolUse: [] } }),
      "project-local": "",
      user: JSON.stringify({ model: "sonnet" }),
    };

    const sections = buildSettingsSections(raws);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Modell");
  });
});

// ── Component tests: SettingsViewer ──

describe("SettingsViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no settings configured", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // All sources return only hooks (excluded) or empty
    vi.mocked(invoke).mockResolvedValue(JSON.stringify({ hooks: {} }));

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Keine Settings konfiguriert")).toBeTruthy();
  });

  it("renders settings sections with source badges", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const projectJson = JSON.stringify({
      allowedTools: ["Bash", "Edit", "Read"],
      mcpServers: { playwright: { command: "npx playwright" } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return projectJson;
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    // Wait for structured view
    expect(await screen.findByText("Erlaubte Tools")).toBeTruthy();
    expect(screen.getByText("MCP-Server")).toBeTruthy();
    expect(screen.getByText("2 Kategorien")).toBeTruthy();

    // Source badge
    expect(screen.getAllByText("Projekt").length).toBeGreaterThanOrEqual(1);

    // Tool list items
    expect(screen.getByText("Bash")).toBeTruthy();
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("toggles between structured and raw view", async () => {
    const rawJson = JSON.stringify({ allowedTools: ["Bash"] });
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return rawJson;
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    // Wait for structured view
    expect(await screen.findByText("Erlaubte Tools")).toBeTruthy();

    // Toggle to raw
    const rawButton = screen.getByTitle("Raw JSON");
    fireEvent.click(rawButton);

    // Raw JSON should show the full JSON
    expect(screen.getByText(rawJson)).toBeTruthy();
  });

  it("shows settings from multiple sources with correct attribution", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const projectJson = JSON.stringify({ allowedTools: ["Bash"] });
    const userJson = JSON.stringify({ allowedTools: ["Read"], model: "opus" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return projectJson;
      }
      if (cmd === "read_user_claude_file") {
        return userJson;
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Erlaubte Tools")).toBeTruthy();
    expect(screen.getByText("Modell")).toBeTruthy();

    // Both sources visible
    expect(screen.getAllByText("Projekt").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("User").length).toBeGreaterThanOrEqual(1);
  });

  it("zeigt den Loading-Zustand bevor die Settings geladen sind", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Promise bleibt pending → loading bleibt true.
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));

    render(<SettingsViewer folder="/test" />);

    expect(screen.getByText("Lade Settings...")).toBeTruthy();
  });

  it("zeigt die Singular-Form 'Kategorie' bei genau einer Sektion", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ model: "opus" });
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("1 Kategorie")).toBeTruthy();
  });

  it("laedt die Settings neu beim Klick auf den Reload-Button", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ model: "opus" });
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Modell")).toBeTruthy();
    const callsBefore = vi.mocked(invoke).mock.calls.length;

    fireEvent.click(screen.getByTitle("Neu laden"));

    // Reload feuert die drei invoke-Calls erneut.
    await waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("rendert einen leeren Array-Wert als 'Leer'", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ allowedTools: [] });
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Erlaubte Tools")).toBeTruthy();
    expect(screen.getByText("Leer")).toBeTruthy();
  });

  it("rendert einen primitiven String-Wert direkt", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ model: "claude-opus-4" });
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Modell")).toBeTruthy();
    expect(screen.getByText("claude-opus-4")).toBeTruthy();
  });

  it("rendert ein Objekt-Wert als formatiertes JSON", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ permissions: { allow: ["Bash"] } });
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Berechtigungen")).toBeTruthy();
    // JSON.stringify(value, null, 2) → enthaelt den Key "allow".
    expect(screen.getByText(/"allow"/)).toBeTruthy();
  });

  it("toggelt von Raw-Ansicht zurueck zur strukturierten Ansicht", async () => {
    const rawJson = JSON.stringify({ allowedTools: ["Bash"] });
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return rawJson;
      }
      return "";
    });

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Erlaubte Tools")).toBeTruthy();

    // Strukturiert → Raw.
    fireEvent.click(screen.getByTitle("Raw JSON"));
    expect(screen.getByText(rawJson)).toBeTruthy();

    // Raw → Strukturiert (Button-Titel hat gewechselt).
    fireEvent.click(screen.getByTitle("Strukturierte Ansicht"));
    expect(screen.getByText("Erlaubte Tools")).toBeTruthy();
  });

  it("zeigt die leere Settings-Hilfe mit Verweis auf settings.json", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue("");

    render(<SettingsViewer folder="/test" />);

    expect(await screen.findByText("Keine Settings konfiguriert")).toBeTruthy();
    expect(screen.getByText(".claude/settings.json")).toBeTruthy();
  });
});
