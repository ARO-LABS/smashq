import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useConfigDiscoveryStore,
  selectSelectedDetail,
  selectOpenDetail,
  selectCloseDetail,
  hasScopeContent,
  type DiscoveredSkill,
} from "./configDiscoveryStore";

// ── Mock Tauri invoke ─────────────────────────────────────────────────

type InvokeHandler = (args?: Record<string, unknown>) => Promise<unknown>;
const invokeHandlers: Record<string, InvokeHandler> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    const handler = invokeHandlers[cmd];
    if (handler) return handler(args);
    return Promise.reject(new Error(`No handler for ${cmd}`));
  }),
}));

vi.mock("../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

function resetStore() {
  useConfigDiscoveryStore.setState({
    globalConfig: null,
    projectConfig: null,
    projectPath: null,
    favoriteConfigs: {},
    favoritesLoading: {},
    loading: false,
    error: null,
    contentCache: {},
    contentLoading: {},
    selectedDetail: null,
  });
}

beforeEach(() => {
  resetStore();
  Object.keys(invokeHandlers).forEach((k) => delete invokeHandlers[k]);
});

// ── discoverGlobal ────────────────────────────────────────────────────

describe("discoverGlobal", () => {
  it("parses global settings with hooks and agents", async () => {
    const settings = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: "Bash", command: "node safe-guard.mjs" }],
        PostToolUse: [{ command: "tsc --noEmit" }],
      },
      agents: {
        architect: { model: "opus" },
        "test-engineer": { model: "sonnet" },
      },
    });

    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") return settings;
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const config = useConfigDiscoveryStore.getState().globalConfig;
    expect(config).not.toBeNull();
    expect(config!.hooks).toHaveLength(2);
    expect(config!.hooks[0].event).toBe("PreToolUse");
    expect(config!.hooks[0].matcher).toBe("Bash");
    expect(config!.hooks[0].command).toBe("node safe-guard.mjs");
    expect(config!.hooks[1].event).toBe("PostToolUse");

    expect(config!.agents).toHaveLength(2);
    expect(config!.agents[0].name).toBe("architect");
    expect(config!.agents[0].model).toBe("opus");
    expect(config!.agents[1].name).toBe("test-engineer");
  });

  it("handles empty/missing settings gracefully", async () => {
    invokeHandlers["read_user_claude_file"] = async () => "";
    invokeHandlers["list_user_claude_dir"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const config = useConfigDiscoveryStore.getState().globalConfig;
    expect(config).not.toBeNull();
    expect(config!.hooks).toHaveLength(0);
    expect(config!.agents).toHaveLength(0);
    expect(config!.skills).toHaveLength(0);
  });

  it("discovers global skills from commands dir", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") return "";
      if (rp === "commands/implement/SKILL.md") {
        return "---\nname: implement\ndescription: Issue to PR\n---\nBody";
      }
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "commands") return ["implement"];
      if (rp === "projects") return [];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const config = useConfigDiscoveryStore.getState().globalConfig;
    expect(config!.skills).toHaveLength(1);
    expect(config!.skills[0].name).toBe("implement");
    expect(config!.skills[0].description).toBe("Issue to PR");
  });
});

// ── discoverGlobal — characterization (multi-concern + partial failure) ─
// These pin the orchestrator's cross-concern behavior so the per-concern
// helper extraction (Welle 4) stays behavior-identical: sequential order
// preserved + one failing concern does not abort the rest.

describe("discoverGlobal — characterization", () => {
  it("populates all seven concerns in one happy-path call", async () => {
    const settings = JSON.stringify({
      hooks: { PreToolUse: [{ matcher: "Bash", command: "guard" }] },
      agents: { architect: { model: "opus" } },
    });
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "CLAUDE.md") return "# Global instructions";
      if (rp === "settings.json") return settings;
      if (rp === "commands/build/SKILL.md") return "---\nname: build\ndescription: Build it\n---\nB";
      if (rp === "agents/reviewer.md") return "---\nname: reviewer\nmodel: sonnet\n---\nB";
      if (rp === "rules/code-quality.md") return "# Glob: **/*.ts\n\nStrict.";
      if (rp === "knowledge/overview.md") return "general";
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "commands") return ["build"];
      if (rp === "agents") return ["reviewer.md"];
      if (rp === "rules") return ["code-quality.md"];
      if (rp === "knowledge") return ["overview.md"];
      if (rp === "projects") return ["proj-a"];
      if (rp === "projects/proj-a/memory") return ["MEMORY.md"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const c = useConfigDiscoveryStore.getState().globalConfig!;
    expect(c.claudeMd).toBe("# Global instructions");
    expect(c.settingsRaw).toBe(settings);
    expect(c.hooks).toHaveLength(1);
    expect(c.skills).toHaveLength(1);
    expect(c.skills[0].name).toBe("build");
    // architect (settings.json) + reviewer (.md)
    expect(c.agents.map((a) => a.name).sort()).toEqual(["architect", "reviewer"]);
    expect(c.rules).toHaveLength(1);
    expect(c.knowledge).toHaveLength(1);
    expect(c.memoryFiles).toHaveLength(1);
  });

  it("keeps other concerns populated when one concern's IPC rejects", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") {
        return JSON.stringify({ agents: { architect: { model: "opus" } } });
      }
      if (rp === "knowledge/overview.md") return "general";
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      // rules listing rejects — discoverGlobalRules catches it internally and
      // returns [], so the rejection never reaches the orchestrator's
      // Promise.all and the other concerns still populate.
      if (rp === "rules") throw new Error("rules dir unreadable");
      if (rp === "knowledge") return ["overview.md"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const c = useConfigDiscoveryStore.getState().globalConfig!;
    expect(useConfigDiscoveryStore.getState().error).toBeNull();
    expect(c.rules).toEqual([]); // failing concern → helper-level catch → empty slice
    expect(c.agents).toHaveLength(1); // independent concern still populates
    expect(c.knowledge).toHaveLength(1); // independent concern still populates
  });
});

// ── discoverProject ───────────────────────────────────────────────────

describe("discoverProject", () => {
  it("discovers project skills, hooks, agents, and CLAUDE.md", async () => {
    invokeHandlers["read_project_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "CLAUDE.md") return "# Project Instructions";
      if (rp === ".claude/settings.json") {
        return JSON.stringify({
          hooks: { PreToolUse: [{ command: "lint" }] },
          agents: { reviewer: { model: "opus" } },
        });
      }
      if (rp === ".claude/settings.local.json") return "";
      return "";
    };
    invokeHandlers["list_skill_dirs"] = async () => [
      {
        dir_name: "deploy",
        content: "---\nname: deploy\ndescription: Deploy workflow\n---\nBody",
        has_reference_dir: true,
      },
    ];

    await useConfigDiscoveryStore.getState().discoverProject("/test/project");

    const config = useConfigDiscoveryStore.getState().projectConfig;
    expect(config).not.toBeNull();
    expect(config!.claudeMd).toBe("# Project Instructions");
    expect(config!.skills).toHaveLength(1);
    expect(config!.skills[0].name).toBe("deploy");
    expect(config!.skills[0].hasReference).toBe(true);
    expect(config!.hooks).toHaveLength(1);
    expect(config!.agents).toHaveLength(1);
    expect(config!.agents[0].name).toBe("reviewer");
  });

  it("does nothing when folder is empty", async () => {
    await useConfigDiscoveryStore.getState().discoverProject("");

    expect(useConfigDiscoveryStore.getState().projectConfig).toBeNull();
  });

  it("merges local settings hooks", async () => {
    invokeHandlers["read_project_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "CLAUDE.md") return "";
      if (rp === ".claude/settings.json") {
        return JSON.stringify({
          hooks: { PreToolUse: [{ command: "lint" }] },
        });
      }
      if (rp === ".claude/settings.local.json") {
        return JSON.stringify({
          hooks: { PostToolUse: [{ command: "test" }] },
        });
      }
      return "";
    };
    invokeHandlers["list_skill_dirs"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverProject("/test/project");

    const config = useConfigDiscoveryStore.getState().projectConfig;
    expect(config!.hooks).toHaveLength(2);
    expect(config!.hooks[0].source).toBe("settings.json");
    expect(config!.hooks[1].source).toBe("settings.local.json");
  });
});

// ── loadContent ───────────────────────────────────────────────────────

describe("loadContent", () => {
  it("caches loaded content", async () => {
    let callCount = 0;
    const loader = async () => {
      callCount++;
      return "file content";
    };

    const result1 = await useConfigDiscoveryStore.getState().loadContent("test:key", loader);
    expect(result1).toBe("file content");
    expect(callCount).toBe(1);

    const result2 = await useConfigDiscoveryStore.getState().loadContent("test:key", loader);
    expect(result2).toBe("file content");
    expect(callCount).toBe(1); // still 1 — cached
  });

  it("handles loader errors gracefully", async () => {
    const loader = async () => {
      throw new Error("read failed");
    };

    const result = await useConfigDiscoveryStore.getState().loadContent("error:key", loader);
    expect(result).toBe("");

    const cached = useConfigDiscoveryStore.getState().contentCache["error:key"];
    expect(cached).toContain("Fehler");
  });

  it("returns empty string while a load for the same key is already in flight", async () => {
    let resolveLoader: (v: string) => void = () => {};
    const loader = () =>
      new Promise<string>((resolve) => {
        resolveLoader = resolve;
      });

    const first = useConfigDiscoveryStore.getState().loadContent("inflight:key", loader);
    // contentLoading flag is set synchronously
    expect(useConfigDiscoveryStore.getState().contentLoading["inflight:key"]).toBe(true);

    // Second call while the first is unresolved → guarded, returns ""
    const second = await useConfigDiscoveryStore.getState().loadContent("inflight:key", loader);
    expect(second).toBe("");

    resolveLoader("done");
    expect(await first).toBe("done");
    expect(useConfigDiscoveryStore.getState().contentLoading["inflight:key"]).toBe(false);
  });

  it("returns cached empty string without re-invoking the loader", async () => {
    let callCount = 0;
    const emptyLoader = async () => {
      callCount++;
      return "";
    };

    const first = await useConfigDiscoveryStore.getState().loadContent("empty:key", emptyLoader);
    expect(first).toBe("");
    // "" is a real cached value (cache stores `undefined`-check, not falsy-check)
    const second = await useConfigDiscoveryStore.getState().loadContent("empty:key", emptyLoader);
    expect(second).toBe("");
    expect(callCount).toBe(1);
  });
});

// ── discoverFavorites ─────────────────────────────────────────────────

describe("discoverFavorites", () => {
  it("does nothing for an empty folder list", async () => {
    await useConfigDiscoveryStore.getState().discoverFavorites([]);
    expect(useConfigDiscoveryStore.getState().favoriteConfigs).toEqual({});
  });

  it("scans multiple favorite folders and keys configs by path", async () => {
    invokeHandlers["read_project_file"] = async (args) => {
      const { folder, relativePath } = args as { folder: string; relativePath: string };
      if (relativePath === "CLAUDE.md") return `# ${folder}`;
      return "";
    };
    invokeHandlers["list_skill_dirs"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverFavorites(["/proj/a", "/proj/b"]);

    const configs = useConfigDiscoveryStore.getState().favoriteConfigs;
    expect(Object.keys(configs)).toHaveLength(2);
    expect(configs["/proj/a"].claudeMd).toBe("# /proj/a");
    expect(configs["/proj/b"].claudeMd).toBe("# /proj/b");
    // favoritesLoading is cleared once done
    expect(useConfigDiscoveryStore.getState().favoritesLoading).toEqual({});
  });

  it("still populates other favorites when one scan partially fails", async () => {
    invokeHandlers["read_project_file"] = async (args) => {
      const { folder, relativePath } = args as { folder: string; relativePath: string };
      if (relativePath === "CLAUDE.md" && folder === "/ok") return "# ok";
      return "";
    };
    invokeHandlers["list_skill_dirs"] = async (args) => {
      const { folder } = args as { folder: string };
      if (folder === "/bad") throw new Error("scan exploded");
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverFavorites(["/ok", "/bad"]);

    const configs = useConfigDiscoveryStore.getState().favoriteConfigs;
    // /ok succeeds; /bad's scanProjectScope swallows the rejection via allSettled
    expect(configs["/ok"].claudeMd).toBe("# ok");
    expect(useConfigDiscoveryStore.getState().favoritesLoading).toEqual({});
  });
});

// ── discoverProject error path ────────────────────────────────────────

describe("discoverProject error handling", () => {
  it("leaves projectConfig populated and clears loading on success", async () => {
    invokeHandlers["read_project_file"] = async () => "";
    invokeHandlers["list_skill_dirs"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverProject("/some/path");

    const state = useConfigDiscoveryStore.getState();
    expect(state.loading).toBe(false);
    expect(state.projectPath).toBe("/some/path");
    expect(state.projectConfig).not.toBeNull();
  });

  it("ignores malformed project settings JSON without throwing", async () => {
    invokeHandlers["read_project_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === ".claude/settings.json") return "{ not json";
      return "";
    };
    invokeHandlers["list_skill_dirs"] = async () => [];

    await useConfigDiscoveryStore.getState().discoverProject("/proj");

    const config = useConfigDiscoveryStore.getState().projectConfig;
    expect(config!.hooks).toEqual([]);
    expect(config!.agents).toEqual([]);
    expect(useConfigDiscoveryStore.getState().error).toBeNull();
  });
});

// ── clearProject ──────────────────────────────────────────────────────

describe("clearProject", () => {
  it("resets project state and content caches", () => {
    useConfigDiscoveryStore.setState({
      projectConfig: { ...emptyScopeForTest() },
      projectPath: "/proj",
      contentCache: { "k": "v" },
      contentLoading: { "k": true },
    });

    useConfigDiscoveryStore.getState().clearProject();

    const state = useConfigDiscoveryStore.getState();
    expect(state.projectConfig).toBeNull();
    expect(state.projectPath).toBeNull();
    expect(state.contentCache).toEqual({});
    expect(state.contentLoading).toEqual({});
  });
});

// ── Detail modal: actions + selectors ─────────────────────────────────

describe("detail modal", () => {
  const sampleSkill: DiscoveredSkill = {
    name: "implement",
    dirName: "implement",
    description: "Issue to PR",
    args: [],
    hasReference: false,
    scope: "global",
    body: "Body",
  };

  it("openDetail stores the selected detail; closeDetail clears it", () => {
    useConfigDiscoveryStore.getState().openDetail({ category: "skills", item: sampleSkill });

    const selected = useConfigDiscoveryStore.getState().selectedDetail;
    expect(selected?.category).toBe("skills");
    expect(selected?.item).toBe(sampleSkill);

    useConfigDiscoveryStore.getState().closeDetail();
    expect(useConfigDiscoveryStore.getState().selectedDetail).toBeNull();
  });

  it("selectors expose detail state and bound actions", () => {
    const state = useConfigDiscoveryStore.getState();
    expect(selectSelectedDetail(state)).toBeNull();
    expect(typeof selectOpenDetail(state)).toBe("function");
    expect(typeof selectCloseDetail(state)).toBe("function");

    selectOpenDetail(state)({ category: "skills", item: sampleSkill });
    expect(selectSelectedDetail(useConfigDiscoveryStore.getState())).not.toBeNull();
  });
});

// ── Global rules + knowledge + agent .md discovery ────────────────────

describe("discoverGlobal — rules", () => {
  it("parses rule files and extracts the Glob header into a separate field", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") return "";
      if (rp === "rules/code-quality.md") {
        return "# Glob: **/*.ts\n\nStrict mode always.";
      }
      if (rp === "rules/git-safety.md") {
        return "No glob header here.";
      }
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "rules") return ["code-quality.md", "git-safety.md", "not-md.txt"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const rules = useConfigDiscoveryStore.getState().globalConfig!.rules;
    expect(rules).toHaveLength(2); // .txt skipped
    const cq = rules.find((r) => r.name === "code-quality")!;
    expect(cq.glob).toBe("**/*.ts");
    expect(cq.body).toBe("Strict mode always.");
    const gs = rules.find((r) => r.name === "git-safety")!;
    expect(gs.glob).toBeNull();
    expect(gs.body).toBe("No glob header here.");
  });
});

describe("discoverGlobal — knowledge", () => {
  it("categorizes top-level files as general and subdir files by folder", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") return "";
      if (rp === "knowledge/overview.md") return "general content";
      if (rp === "knowledge/security/xss.md") return "xss content";
      if (rp === "knowledge/templates/labels.yml") return "labels: []";
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "knowledge") return ["overview.md"];
      if (rp === "knowledge/security") return ["xss.md"];
      if (rp === "knowledge/templates") return ["labels.yml"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const knowledge = useConfigDiscoveryStore.getState().globalConfig!.knowledge;
    expect(knowledge).toHaveLength(3);
    expect(knowledge.find((k) => k.name === "overview")!.category).toBe("general");
    expect(knowledge.find((k) => k.name === "xss")!.category).toBe("security");
    const yml = knowledge.find((k) => k.name === "labels")!;
    expect(yml.category).toBe("templates");
    expect(yml.fileType).toBe("yml");
  });
});

describe("discoverGlobal — agents from .md files", () => {
  it("parses agent frontmatter and merges with settings.json agents", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") {
        return JSON.stringify({ agents: { architect: { model: "opus" } } });
      }
      if (rp === "agents/reviewer.md") {
        return "---\nname: reviewer\nmodel: sonnet\ndescription: Reviews code\n---\nBody";
      }
      if (rp === "agents/no-frontmatter.md") {
        return "Just a plain file.";
      }
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "agents") return ["reviewer.md", "no-frontmatter.md"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const agents = useConfigDiscoveryStore.getState().globalConfig!.agents;
    expect(agents).toHaveLength(3); // architect + 2 md
    const reviewer = agents.find((a) => a.name === "reviewer")!;
    expect(reviewer.model).toBe("sonnet");
    expect(reviewer.description).toBe("Reviews code");
    // .md without frontmatter falls back to filename + unknown model
    const plain = agents.find((a) => a.name === "no-frontmatter")!;
    expect(plain.model).toBe("unknown");
  });

  it("discovers memory files from per-project memory subdirs", async () => {
    invokeHandlers["read_user_claude_file"] = async () => "";
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "projects") return ["proj-a"];
      if (rp === "projects/proj-a/memory") return ["MEMORY.md", "notes.md"];
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const mem = useConfigDiscoveryStore.getState().globalConfig!.memoryFiles;
    expect(mem).toHaveLength(2);
    expect(mem[0].name).toBe("proj-a/MEMORY.md");
    expect(mem[0].relativePath).toBe("projects/proj-a/memory/MEMORY.md");
  });
});

describe("discoverGlobal — error handling", () => {
  it("records the error and stops loading when the core read rejects", async () => {
    invokeHandlers["read_user_claude_file"] = async () => {
      throw new Error("home dir unreadable");
    };
    invokeHandlers["list_user_claude_dir"] = async () => {
      throw new Error("home dir unreadable");
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const state = useConfigDiscoveryStore.getState();
    // Promise.allSettled swallows the rejections → discoverGlobal still
    // produces an (empty) config rather than throwing.
    expect(state.loading).toBe(false);
    expect(state.globalConfig).not.toBeNull();
    expect(state.globalConfig!.skills).toEqual([]);
  });

  it("deduplicates skills present in both commands/ and skills/", async () => {
    invokeHandlers["read_user_claude_file"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "settings.json") return "";
      if (rp === "commands/shared/SKILL.md") {
        return "---\nname: shared\ndescription: from commands\n---\nB";
      }
      return "";
    };
    invokeHandlers["list_user_claude_dir"] = async (args) => {
      const rp = (args as { relativePath: string }).relativePath;
      if (rp === "commands") return ["shared"];
      if (rp === "skills") return ["shared"]; // same dir name → must dedupe
      return [];
    };

    await useConfigDiscoveryStore.getState().discoverGlobal();

    const skills = useConfigDiscoveryStore.getState().globalConfig!.skills;
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("from commands");
  });
});

// ── hasScopeContent ───────────────────────────────────────────────────

describe("hasScopeContent", () => {
  it("returns false for an empty scope config", () => {
    expect(hasScopeContent(emptyScopeForTest())).toBe(false);
  });

  it("returns true when a collection field is filled", () => {
    const skill: DiscoveredSkill = {
      name: "s",
      dirName: "s",
      description: "",
      args: [],
      hasReference: false,
      scope: "global",
      body: "",
    };
    expect(hasScopeContent({ ...emptyScopeForTest(), skills: [skill] })).toBe(true);
  });

  it("returns true when a raw string field is filled", () => {
    expect(hasScopeContent({ ...emptyScopeForTest(), claudeMd: "# x" })).toBe(true);
    expect(hasScopeContent({ ...emptyScopeForTest(), settingsRaw: "{}" })).toBe(true);
  });
});

// Local helper mirroring the store's private emptyScope() factory.
function emptyScopeForTest() {
  return {
    skills: [],
    agents: [],
    hooks: [],
    settingsRaw: "",
    claudeMd: "",
    memoryFiles: [],
    rules: [],
    knowledge: [],
  };
}
