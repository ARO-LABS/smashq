import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import {
  SETTINGS_SOURCES,
  SOURCE_META,
  SourceBadge,
  SourceLegend,
  RawJsonView,
  useClaudeSettingsRaws,
  type SettingsSource,
  type SettingsRaws,
} from "./claudeSettingsSources";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SETTINGS_SOURCES / SOURCE_META", () => {
  it("lists the three layered sources in precedence order", () => {
    expect(SETTINGS_SOURCES).toEqual(["project", "project-local", "user"]);
  });

  it("provides label, color, dot and path metadata for every source", () => {
    for (const source of SETTINGS_SOURCES) {
      const meta = SOURCE_META[source];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
      expect(meta.path.length).toBeGreaterThan(0);
    }
  });

  it("maps the user source to the global settings path", () => {
    expect(SOURCE_META.user.path).toBe("~/.claude/settings.json");
  });
});

describe("SourceBadge", () => {
  it("renders the source label", () => {
    render(<SourceBadge source="project" />);
    expect(screen.getByText("Projekt")).toBeTruthy();
  });

  it("exposes the source file path as a tooltip", () => {
    render(<SourceBadge source="project-local" />);
    expect(screen.getByText("Lokal").getAttribute("title")).toBe(
      ".claude/settings.local.json",
    );
  });
});

describe("SourceLegend", () => {
  it("renders only the visible sources", () => {
    render(
      <SourceLegend
        visibleSources={new Set<SettingsSource>(["project", "user"])}
      />,
    );
    expect(screen.getByText("Projekt")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.queryByText("Lokal")).toBeNull();
  });

  it("renders nothing visible when the set is empty", () => {
    render(<SourceLegend visibleSources={new Set<SettingsSource>()} />);
    expect(screen.queryByText("Projekt")).toBeNull();
    expect(screen.queryByText("User")).toBeNull();
  });
});

describe("RawJsonView", () => {
  it("renders a block for each non-empty source", () => {
    const raws: SettingsRaws = {
      project: '{"a":1}',
      "project-local": "",
      user: '{"b":2}',
    };
    const { container } = render(<RawJsonView raws={raws} />);
    expect(container.querySelectorAll("pre")).toHaveLength(2);
  });

  it("omits sources whose raw content is empty", () => {
    const raws: SettingsRaws = {
      project: "",
      "project-local": "",
      user: "",
    };
    const { container } = render(<RawJsonView raws={raws} />);
    expect(container.querySelectorAll("pre")).toHaveLength(0);
  });

  it("renders the raw JSON content verbatim", () => {
    const raws: SettingsRaws = {
      project: '{"key":"value"}',
      "project-local": "",
      user: "",
    };
    render(<RawJsonView raws={raws} />);
    expect(screen.getByText('{"key":"value"}')).toBeTruthy();
  });
});

describe("useClaudeSettingsRaws", () => {
  it("loads all three settings sources on mount", async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === "read_project_file") {
        const rp = (args as { relativePath: string }).relativePath;
        return Promise.resolve(rp === ".claude/settings.json" ? "P" : "L");
      }
      return Promise.resolve("U");
    });

    const { result } = renderHook(() =>
      useClaudeSettingsRaws("/repo", "Test.load"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.raws).toEqual({
      project: "P",
      "project-local": "L",
      user: "U",
    });
  });

  it("falls back to empty strings for sources that fail to load", async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === "read_user_claude_file") return Promise.resolve("U");
      return Promise.reject(new Error("missing"));
    });

    const { result } = renderHook(() =>
      useClaudeSettingsRaws("/repo", "Test.load"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.raws.project).toBe("");
    expect(result.current.raws["project-local"]).toBe("");
    expect(result.current.raws.user).toBe("U");
  });

  it("exposes a reload callback that re-invokes the backend", async () => {
    mockInvoke.mockResolvedValue("X");
    const { result } = renderHook(() =>
      useClaudeSettingsRaws("/repo", "Test.load"),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const callsBefore = mockInvoke.mock.calls.length;
    await act(async () => {
      await result.current.reload();
    });
    expect(mockInvoke.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
