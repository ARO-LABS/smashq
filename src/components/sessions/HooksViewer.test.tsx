import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildEventGroups, extractHookName, HooksViewer } from "./HooksViewer";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// ── Unit tests: buildEventGroups ──

describe("buildEventGroups", () => {
  it("merges hooks from multiple sources into event-first groups", () => {
    const raws = {
      project: JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", command: "echo pre" }],
          PostToolUse: [{ command: "echo post" }],
        },
      }),
      "project-local": JSON.stringify({
        hooks: {
          PreToolUse: [{ command: "echo local-pre" }],
        },
      }),
      user: "",
    };

    const groups = buildEventGroups(raws);

    expect(groups).toHaveLength(2);
    // Sorted alphabetically: PostToolUse before PreToolUse
    expect(groups[0].eventName).toBe("PostToolUse");
    expect(groups[0].hooks).toHaveLength(1);
    expect(groups[0].hooks[0].source).toBe("project");

    expect(groups[1].eventName).toBe("PreToolUse");
    expect(groups[1].hooks).toHaveLength(2);
    expect(groups[1].hooks[0].source).toBe("project");
    expect(groups[1].hooks[0].matcher).toBe("Bash");
    expect(groups[1].hooks[1].source).toBe("project-local");
  });

  it("returns empty array when no sources have hooks", () => {
    const groups = buildEventGroups({ project: "", "project-local": "", user: "" });
    expect(groups).toHaveLength(0);
  });

  it("returns empty array for JSON without hooks key", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({ permissions: {} }),
      "project-local": "",
      user: "",
    });
    expect(groups).toHaveLength(0);
  });

  it("handles invalid JSON gracefully", () => {
    const groups = buildEventGroups({
      project: "not valid json",
      "project-local": "",
      user: JSON.stringify({
        hooks: { PreToolUse: [{ command: "echo ok" }] },
      }),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks[0].source).toBe("user");
  });

  it("preserves source badge per hook within same event", () => {
    const raws = {
      project: JSON.stringify({
        hooks: { PreToolUse: [{ command: "cmd1" }] },
      }),
      "project-local": JSON.stringify({
        hooks: { PreToolUse: [{ command: "cmd2" }] },
      }),
      user: JSON.stringify({
        hooks: { PreToolUse: [{ command: "cmd3" }] },
      }),
    };

    const groups = buildEventGroups(raws);
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks).toHaveLength(3);
    expect(groups[0].hooks[0].source).toBe("project");
    expect(groups[0].hooks[1].source).toBe("project-local");
    expect(groups[0].hooks[2].source).toBe("user");
  });

  it("returns empty array when hooks key is not an object", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({ hooks: "invalid" }),
      "project-local": JSON.stringify({ hooks: 42 }),
      user: JSON.stringify({ hooks: null }),
    });
    expect(groups).toHaveLength(0);
  });

  it("skips event entries that are not arrays", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({ hooks: { PreToolUse: { command: "x" } } }),
      "project-local": "",
      user: "",
    });
    // event key still surfaces but with zero hooks (non-array → ignored)
    expect(groups).toHaveLength(1);
    expect(groups[0].eventName).toBe("PreToolUse");
    expect(groups[0].hooks).toHaveLength(0);
  });

  it("skips flat entries that have neither command nor nested hooks", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash" }, { command: "real" }] },
      }),
      "project-local": "",
      user: "",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks).toHaveLength(1);
    expect(groups[0].hooks[0].command).toBe("real");
  });

  it("expands multiple nested hooks under one matcher entry", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "first" },
                { type: "command", command: "second", timeout: 2000 },
              ],
            },
          ],
        },
      }),
      "project-local": "",
      user: "",
    });
    expect(groups[0].hooks).toHaveLength(2);
    expect(groups[0].hooks[0].command).toBe("first");
    expect(groups[0].hooks[1].command).toBe("second");
    expect(groups[0].hooks[1].timeout).toBe(2000);
    expect(groups[0].hooks[1].matcher).toBe("Bash");
  });

  it("sorts event groups alphabetically across sources", () => {
    const groups = buildEventGroups({
      project: JSON.stringify({
        hooks: { Stop: [{ command: "s" }], Notification: [{ command: "n" }] },
      }),
      "project-local": JSON.stringify({
        hooks: { PreToolUse: [{ command: "p" }] },
      }),
      user: "",
    });
    expect(groups.map((g) => g.eventName)).toEqual([
      "Notification",
      "PreToolUse",
      "Stop",
    ]);
  });
});

// ── Unit tests: extractHookName ──

describe("extractHookName", () => {
  it("extracts filename from a path-based command", () => {
    expect(extractHookName("node .claude/hooks/safe-guard.mjs")).toBe("safe-guard.mjs");
  });

  it("returns short commands as-is", () => {
    expect(extractHookName("npx tsc --noEmit")).toBe("npx tsc --noEmit");
  });

  it("handles backslash paths", () => {
    expect(extractHookName("node C:\\hooks\\check.js")).toBe("check.js");
  });

  it("trims surrounding whitespace before extracting", () => {
    expect(extractHookName("   node hooks/run.mjs   ")).toBe("run.mjs");
  });

  it("returns first two tokens for long commands without a path", () => {
    const long = "echo this-is-a-very-long-command-without-any-path-segment-here";
    expect(extractHookName(long)).toBe("echo this-is-a-very-long-command-without-any-path-segment-here");
  });

  it("returns first two tokens when long and multi-token without path", () => {
    const long = "deno run --allow-read --allow-write some-long-task-name-exceeding";
    expect(extractHookName(long)).toBe("deno run");
  });

  it("picks the first path-bearing token among several", () => {
    expect(extractHookName("sh ./scripts/a.sh other/b.sh")).toBe("a.sh");
  });
});

// ── Unit tests: buildEventGroups with nested format ──

describe("buildEventGroups (nested hooks format)", () => {
  it("parses the real Claude settings.json nested format", () => {
    const raws = {
      project: JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "command", command: "node .claude/hooks/safe-guard.mjs", timeout: 5000 },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [
                { type: "command", command: "npx tsc --noEmit --skipLibCheck 2>&1 | head -20" },
              ],
            },
          ],
        },
      }),
      "project-local": "",
      user: "",
    };

    const groups = buildEventGroups(raws);
    expect(groups).toHaveLength(2);

    const postGroup = groups.find((g) => g.eventName === "PostToolUse")!;
    expect(postGroup.hooks).toHaveLength(1);
    expect(postGroup.hooks[0].command).toBe("npx tsc --noEmit --skipLibCheck 2>&1 | head -20");
    expect(postGroup.hooks[0].matcher).toBe("Edit|Write");

    const preGroup = groups.find((g) => g.eventName === "PreToolUse")!;
    expect(preGroup.hooks).toHaveLength(1);
    expect(preGroup.hooks[0].command).toBe("node .claude/hooks/safe-guard.mjs");
    expect(preGroup.hooks[0].timeout).toBe(5000);
    expect(preGroup.hooks[0].matcher).toBe("Bash");
  });

  it("handles mixed nested and flat formats", () => {
    const raws = {
      project: JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "nested-cmd" }] },
            { matcher: "Edit", command: "flat-cmd" },
          ],
        },
      }),
      "project-local": "",
      user: "",
    };

    const groups = buildEventGroups(raws);
    expect(groups).toHaveLength(1);
    expect(groups[0].hooks).toHaveLength(2);
    expect(groups[0].hooks[0].command).toBe("nested-cmd");
    expect(groups[0].hooks[1].command).toBe("flat-cmd");
  });
});

// ── Component tests: HooksViewer ──

describe("HooksViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when no hooks configured", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockResolvedValue("");

    render(<HooksViewer folder="/test" />);

    expect(await screen.findByText("Keine Hooks konfiguriert")).toBeTruthy();
    expect(screen.getByText(/PreToolUse/)).toBeTruthy();
    expect(screen.getByText(/\.claude\/settings\.json/)).toBeTruthy();
  });

  it("renders event groups with source badges and hook names", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const projectJson = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "node .claude/hooks/safe-guard.mjs", timeout: 5000 }],
          },
        ],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return projectJson;
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);

    expect(await screen.findByText("PreToolUse")).toBeTruthy();
    // "Projekt" appears in legend and badge — use getAllByText
    expect(screen.getAllByText("Projekt").length).toBeGreaterThanOrEqual(1);
    // Hook name extracted from command path
    expect(screen.getByText("safe-guard.mjs")).toBeTruthy();
    // Full command shown in code block
    expect(screen.getByText("node .claude/hooks/safe-guard.mjs")).toBeTruthy();
    // Timeout displayed
    expect(screen.getByText("5s")).toBeTruthy();
    expect(screen.getByText("1 Event")).toBeTruthy();
  });

  it("toggles between structured and raw view", async () => {
    const rawJson = JSON.stringify({
      hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "tsc --noEmit" }] }] },
    });
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return rawJson;
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);

    // Wait for structured view
    expect(await screen.findByText("PostToolUse")).toBeTruthy();

    // Toggle to raw
    const rawButton = screen.getByTitle("Raw JSON");
    fireEvent.click(rawButton);

    // Raw JSON should show the full JSON
    expect(screen.getByText(rawJson)).toBeTruthy();
  });

  it("shows loading state while settings are being fetched", async () => {
    // invoke never resolves → component stays in loading branch
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockReturnValue(new Promise(() => {}));

    render(<HooksViewer folder="/test" />);

    expect(screen.getByText("Lade Hooks...")).toBeTruthy();
  });

  it("pluralizes the event counter for multiple events", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const json = JSON.stringify({
      hooks: {
        PreToolUse: [{ command: "echo pre" }],
        PostToolUse: [{ command: "echo post" }],
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return json;
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);

    expect(await screen.findByText("2 Events")).toBeTruthy();
  });

  it("displays the matcher label when a hook has a matcher", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const json = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Edit|Write", command: "echo x" }] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return json;
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);

    expect(await screen.findByText("PreToolUse")).toBeTruthy();
    expect(screen.getByText(/Matcher:/)).toBeTruthy();
    expect(screen.getByText("Edit|Write")).toBeTruthy();
  });

  it("reload button re-invokes the settings read", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return JSON.stringify({ hooks: { Stop: [{ command: "echo stop" }] } });
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);
    expect(await screen.findByText("Stop")).toBeTruthy();

    const callsAfterInitialLoad = vi.mocked(invoke).mock.calls.length;
    fireEvent.click(screen.getByTitle("Neu laden"));

    await waitFor(() => {
      expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(callsAfterInitialLoad);
    });
  });

  it("renders raw JSON blocks for every non-empty source", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const projectJson = JSON.stringify({ hooks: { Stop: [{ command: "p" }] } });
    const localJson = JSON.stringify({ hooks: { Stop: [{ command: "l" }] } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.json") {
        return projectJson;
      }
      if (cmd === "read_project_file" && args?.relativePath === ".claude/settings.local.json") {
        return localJson;
      }
      return "";
    });

    render(<HooksViewer folder="/test" />);
    expect(await screen.findByText("Stop")).toBeTruthy();

    fireEvent.click(screen.getByTitle("Raw JSON"));

    expect(screen.getByText(projectJson)).toBeTruthy();
    expect(screen.getByText(localJson)).toBeTruthy();
    // Source label visible (legend + raw-view block both render "Lokal")
    expect(screen.getAllByText("Lokal").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to empty state when all invokes reject", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockRejectedValue(new Error("read failed"));

    render(<HooksViewer folder="/test" />);

    // Promise.allSettled swallows rejections → empty raws → empty state
    expect(await screen.findByText("Keine Hooks konfiguriert")).toBeTruthy();
  });
});
