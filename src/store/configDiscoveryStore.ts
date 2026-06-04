import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../utils/errorLogger";
import { parseSkillFrontmatter, type ParsedSkill } from "../utils/parseSkillFrontmatter";

// ── Types ──────────────────────────────────────────────────────────────

export type ConfigScope = "global" | "project";

export type KnowledgeCategory = "security" | "templates" | "general";

export interface DiscoveredSkill {
  name: string;
  dirName: string;
  description: string;
  args: { name: string; description: string; required: boolean }[];
  hasReference: boolean;
  scope: ConfigScope;
  body: string;
}

export interface DiscoveredAgent {
  name: string;
  model: string;
  description: string;
  scope: ConfigScope;
}

export interface DiscoveredHook {
  event: string;
  matcher?: string;
  command: string;
  scope: ConfigScope;
  source: string; // e.g. "settings.json", "settings.local.json"
}

export interface DiscoveredMemoryFile {
  name: string;
  relativePath: string;
}

/** A user-global rule file from ~/.claude/rules/ (code-quality, git-safety, ...). */
export interface DiscoveredRule {
  /** Filename minus .md extension — e.g. "code-quality" */
  name: string;
  /** Original filename including extension — e.g. "code-quality.md" */
  filename: string;
  /** Glob pattern from the "# Glob: ..." header line, if present. Null = applies globally. */
  glob: string | null;
  /** File content excluding the glob header (so the body renders cleanly). */
  body: string;
}

/** A user-global knowledge entry from ~/.claude/knowledge/ (templates, security checklists, configs). */
export interface DiscoveredKnowledge {
  /** Filename minus extension — e.g. "frontend-xss" */
  name: string;
  /** Original filename — e.g. "frontend-xss.md", "github-labels.yml" */
  filename: string;
  /** Subdirectory category. "general" = top-level, "security"/"templates" = subdir-derived. */
  category: KnowledgeCategory;
  /** Relative path from ~/.claude/ root — useful for refresh / reload. */
  relativePath: string;
  /** Raw file content (rendered as markdown for .md, monospace for .yml). */
  body: string;
  /** "md" or "yml" — drives copy-paste rendering (no markdown processing for YAML). */
  fileType: "md" | "yml";
}

export type SelectedDetail =
  | { category: "skills"; item: DiscoveredSkill }
  | { category: "agents"; item: DiscoveredAgent }
  | { category: "hooks"; item: DiscoveredHook }
  | { category: "memory"; item: DiscoveredMemoryFile }
  | { category: "rules"; item: DiscoveredRule }
  | { category: "knowledge"; item: DiscoveredKnowledge };

export interface ScopeConfig {
  skills: DiscoveredSkill[];
  agents: DiscoveredAgent[];
  hooks: DiscoveredHook[];
  settingsRaw: string;
  claudeMd: string;
  memoryFiles: DiscoveredMemoryFile[];
  /** Global-only: ~/.claude/rules/*.md. Empty for project-scope. */
  rules: DiscoveredRule[];
  /** Global-only: ~/.claude/knowledge/**\/*.{md,yml}. Empty for project-scope. */
  knowledge: DiscoveredKnowledge[];
}

// ── Store ──────────────────────────────────────────────────────────────

interface ConfigDiscoveryState {
  globalConfig: ScopeConfig | null;
  projectConfig: ScopeConfig | null;
  projectPath: string | null;
  /** Configs for favorite projects, keyed by folder path */
  favoriteConfigs: Record<string, ScopeConfig>;
  /** Paths currently being scanned */
  favoritesLoading: Record<string, boolean>;
  loading: boolean;
  error: string | null;

  /** Content cache for lazy-loaded files, keyed by "scope:type:identifier" */
  contentCache: Record<string, string>;
  contentLoading: Record<string, boolean>;

  /** Detail modal state */
  selectedDetail: SelectedDetail | null;

  discoverGlobal: () => Promise<void>;
  discoverProject: (folder: string) => Promise<void>;
  discoverFavorites: (folders: string[]) => Promise<void>;
  loadContent: (key: string, loader: () => Promise<string>) => Promise<string>;
  clearProject: () => void;
  openDetail: (detail: SelectedDetail) => void;
  closeDetail: () => void;
}

/** Fresh empty config — a factory so callers never share array references. */
function emptyScope(): ScopeConfig {
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

// ── Helpers ────────────────────────────────────────────────────────────

interface SkillDirEntry {
  dir_name: string;
  content: string;
  has_reference_dir: boolean;
}

interface HookEntry {
  matcher?: string;
  command: string;
}

function parseSkillEntries(
  dirs: SkillDirEntry[],
  scope: ConfigScope,
): DiscoveredSkill[] {
  return dirs.map((dir) => {
    const fallbackName = dir.dir_name.replace(/\.md$/, "");
    const parsed: ParsedSkill = dir.content
      ? parseSkillFrontmatter(dir.content)
      : { metadata: { name: fallbackName, description: "", userInvokable: false, args: [] }, body: "" };
    return {
      name: parsed.metadata.name && parsed.metadata.name !== "Unknown" ? parsed.metadata.name : fallbackName,
      dirName: dir.dir_name,
      description: parsed.metadata.description,
      args: parsed.metadata.args,
      hasReference: dir.has_reference_dir,
      scope,
      body: parsed.body,
    };
  });
}

function parseAgentsFromSettings(raw: string, scope: ConfigScope): DiscoveredAgent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const agents = parsed?.agents;
    if (!agents || typeof agents !== "object") return [];
    return Object.entries(agents).map(([name, config]) => ({
      name,
      model: (config as { model?: string })?.model ?? "unknown",
      description: (config as { description?: string })?.description ?? "",
      scope,
    }));
  } catch {
    return [];
  }
}

/** Parse agent frontmatter from .md files in ~/.claude/agents/ */
function parseAgentMdFrontmatter(
  fileName: string,
  content: string,
  scope: ConfigScope,
): DiscoveredAgent {
  const defaults: DiscoveredAgent = {
    name: fileName.replace(/\.md$/, ""),
    model: "unknown",
    description: "",
    scope,
  };
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return defaults;

  const fm = match[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const modelMatch = fm.match(/^model:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch?.[1]?.trim() ?? defaults.name,
    model: modelMatch?.[1]?.trim() ?? defaults.model,
    description: descMatch?.[1]?.trim() ?? defaults.description,
    scope,
  };
}

function parseHooksFromSettings(
  raw: string,
  scope: ConfigScope,
  source: string,
): DiscoveredHook[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const hooksObj = parsed?.hooks;
    if (!hooksObj || typeof hooksObj !== "object") return [];

    const result: DiscoveredHook[] = [];
    for (const [eventName, hookList] of Object.entries(hooksObj)) {
      const entries = hookList as HookEntry[];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        result.push({
          event: eventName,
          matcher: entry.matcher,
          command: entry.command,
          scope,
          source,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

/** Resolve a skill/command entry to its readable path: plain .md file, or SKILL.md inside a dir. */
function skillRelPath(base: string, dirName: string): string {
  return dirName.endsWith(".md")
    ? `${base}/${dirName}`
    : `${base}/${dirName}/SKILL.md`;
}

// ── Global-scope per-concern discovery helpers ─────────────────────────
// Each helper owns one concern of discoverGlobal(), catches its own IPC
// failure and returns an empty/default result so a single failing concern
// never aborts the rest (partial-failure tolerance). Because no helper ever
// rejects, they are concurrency-safe: discoverGlobal() runs the independent
// ones via Promise.all (preserving the original concurrent IPC fan-out).
// Only discoverGlobalAgents is sequenced after the batch — it depends on the
// settings.json agents (settings.agents) to seed its agents/*.md merge.

/** Parsed slice of the global settings.json (settingsRaw + derived agents/hooks). */
interface GlobalSettingsResult {
  settingsRaw: string;
  agents: DiscoveredAgent[];
  hooks: DiscoveredHook[];
}

/** Read + parse ~/.claude/CLAUDE.md. Empty string if missing/unreadable. */
async function discoverGlobalClaudeMd(): Promise<string> {
  try {
    const value = await invoke<string>("read_user_claude_file", { relativePath: "CLAUDE.md" });
    return value ?? "";
  } catch {
    return "";
  }
}

/** Read + parse ~/.claude/settings.json into raw + agents + hooks. */
async function discoverGlobalSettings(): Promise<GlobalSettingsResult> {
  try {
    const value = await invoke<string>("read_user_claude_file", { relativePath: "settings.json" });
    if (!value) return { settingsRaw: "", agents: [], hooks: [] };
    return {
      settingsRaw: value,
      agents: parseAgentsFromSettings(value, "global"),
      hooks: parseHooksFromSettings(value, "global", "settings.json"),
    };
  } catch {
    return { settingsRaw: "", agents: [], hooks: [] };
  }
}

/** Discover global skills from ~/.claude/commands/ and ~/.claude/skills/ (deduped by dir name). */
async function discoverGlobalSkills(): Promise<DiscoveredSkill[]> {
  const allSkillEntries: SkillDirEntry[] = [];

  // Scan ~/.claude/commands/ — entries are dirs (with SKILL.md) or plain .md files.
  let commandDirs: string[] = [];
  try {
    commandDirs = await invoke<string[]>("list_user_claude_dir", { relativePath: "commands" });
  } catch {
    commandDirs = [];
  }
  for (const dirName of commandDirs) {
    let content = "";
    try {
      content = await invoke<string>("read_user_claude_file", {
        relativePath: skillRelPath("commands", dirName),
      });
    } catch {
      // Skill may not have content
    }
    allSkillEntries.push({ dir_name: dirName, content, has_reference_dir: false });
  }

  // Scan ~/.claude/skills/ — skip names already seen under commands/.
  let skillDirs: string[] = [];
  try {
    skillDirs = await invoke<string[]>("list_user_claude_dir", { relativePath: "skills" });
  } catch {
    skillDirs = [];
  }
  const existingNames = new Set(allSkillEntries.map((e) => e.dir_name));
  for (const dirName of skillDirs) {
    if (existingNames.has(dirName)) continue; // avoid duplicates
    let content = "";
    try {
      content = await invoke<string>("read_user_claude_file", {
        relativePath: skillRelPath("skills", dirName),
      });
    } catch {
      // Skill may not have SKILL.md
    }
    allSkillEntries.push({ dir_name: dirName, content, has_reference_dir: false });
  }

  return allSkillEntries.length > 0 ? parseSkillEntries(allSkillEntries, "global") : [];
}

/**
 * Discover agents from ~/.claude/agents/*.md and merge them onto the
 * settings.json-derived agents (no duplicate names). Returns the merged list.
 */
async function discoverGlobalAgents(settingsAgents: DiscoveredAgent[]): Promise<DiscoveredAgent[]> {
  let agentFiles: string[] = [];
  try {
    agentFiles = await invoke<string[]>("list_user_claude_dir", { relativePath: "agents" });
  } catch {
    return settingsAgents;
  }
  if (agentFiles.length === 0) return settingsAgents;

  const mdAgents: DiscoveredAgent[] = [];
  for (const fileName of agentFiles) {
    if (!fileName.endsWith(".md")) continue;
    try {
      const content = await invoke<string>("read_user_claude_file", {
        relativePath: `agents/${fileName}`,
      });
      mdAgents.push(parseAgentMdFrontmatter(fileName, content, "global"));
    } catch {
      // Skip unreadable agent files
    }
  }
  const existingAgentNames = new Set(settingsAgents.map((a) => a.name));
  return [...settingsAgents, ...mdAgents.filter((a) => !existingAgentNames.has(a.name))];
}

/**
 * Discover ~/.claude/rules/*.md. Each file may carry a "# Glob: ..." header
 * that restricts when it applies; the header is split out from the body.
 */
async function discoverGlobalRules(): Promise<DiscoveredRule[]> {
  try {
    const ruleEntries = await invoke<string[]>("list_user_claude_dir", { relativePath: "rules" });
    const rules: DiscoveredRule[] = [];
    for (const fileName of ruleEntries) {
      if (!fileName.endsWith(".md")) continue;
      try {
        const content = await invoke<string>("read_user_claude_file", {
          relativePath: `rules/${fileName}`,
        });
        const globMatch = content.match(/^#\s*Glob:\s*(.+)$/m);
        const body = globMatch ? content.replace(globMatch[0], "").trim() : content;
        rules.push({
          name: fileName.replace(/\.md$/, ""),
          filename: fileName,
          glob: globMatch?.[1]?.trim() ?? null,
          body,
        });
      } catch {
        // Skip unreadable rule file
      }
    }
    return rules;
  } catch {
    return []; // No rules dir
  }
}

/**
 * Discover ~/.claude/knowledge/ recursively into security/ + templates/
 * subdirs. Top-level files default to the "general" category.
 */
async function discoverGlobalKnowledge(): Promise<DiscoveredKnowledge[]> {
  try {
    const topLevelEntries = await invoke<string[]>("list_user_claude_dir", {
      relativePath: "knowledge",
    });
    const knowledge: DiscoveredKnowledge[] = [];

    const pushEntry = async (
      subPath: string,
      fileName: string,
      category: KnowledgeCategory,
    ): Promise<void> => {
      if (!fileName.endsWith(".md") && !fileName.endsWith(".yml")) return;
      try {
        const relativePath = subPath
          ? `knowledge/${subPath}/${fileName}`
          : `knowledge/${fileName}`;
        const content = await invoke<string>("read_user_claude_file", { relativePath });
        knowledge.push({
          name: fileName.replace(/\.(md|yml)$/, ""),
          filename: fileName,
          category,
          relativePath,
          body: content,
          fileType: fileName.endsWith(".yml") ? "yml" : "md",
        });
      } catch {
        // Skip unreadable
      }
    };

    for (const entry of topLevelEntries) {
      await pushEntry("", entry, "general");
    }
    for (const subDir of ["security", "templates"] as const) {
      try {
        const subEntries = await invoke<string[]>("list_user_claude_dir", {
          relativePath: `knowledge/${subDir}`,
        });
        for (const entry of subEntries) {
          await pushEntry(subDir, entry, subDir);
        }
      } catch {
        // Subdir missing — fine
      }
    }
    return knowledge;
  } catch {
    return []; // No knowledge dir
  }
}

/** Discover per-project memory files under ~/.claude/projects/<dir>/memory/. */
async function discoverGlobalMemory(): Promise<DiscoveredMemoryFile[]> {
  try {
    const projectDirs = await invoke<string[]>("list_user_claude_dir", { relativePath: "projects" });
    const memFiles: DiscoveredMemoryFile[] = [];
    for (const dir of projectDirs) {
      try {
        const memoryDir = await invoke<string[]>("list_user_claude_dir", {
          relativePath: `projects/${dir}/memory`,
        });
        for (const file of memoryDir) {
          memFiles.push({
            name: `${dir}/${file}`,
            relativePath: `projects/${dir}/memory/${file}`,
          });
        }
      } catch {
        // No memory dir
      }
    }
    return memFiles;
  } catch {
    return []; // No projects dir
  }
}

/** Scan one project folder for CLAUDE.md, skills, and settings/local-settings hooks + agents. */
async function scanProjectScope(folder: string): Promise<ScopeConfig> {
  const config = emptyScope();

  const [claudeMdResult, skillsResult, settingsResult, localSettingsResult] =
    await Promise.allSettled([
      invoke<string>("read_project_file", { folder, relativePath: "CLAUDE.md" }),
      invoke<SkillDirEntry[]>("list_skill_dirs", { folder }),
      invoke<string>("read_project_file", { folder, relativePath: ".claude/settings.json" }),
      invoke<string>("read_project_file", { folder, relativePath: ".claude/settings.local.json" }),
    ]);

  if (claudeMdResult.status === "fulfilled") {
    config.claudeMd = claudeMdResult.value;
  }
  if (skillsResult.status === "fulfilled") {
    config.skills = parseSkillEntries(skillsResult.value, "project");
  }
  if (settingsResult.status === "fulfilled" && settingsResult.value) {
    config.settingsRaw = settingsResult.value;
    config.agents = parseAgentsFromSettings(settingsResult.value, "project");
    config.hooks = parseHooksFromSettings(settingsResult.value, "project", "settings.json");
  }
  if (localSettingsResult.status === "fulfilled" && localSettingsResult.value) {
    const localHooks = parseHooksFromSettings(
      localSettingsResult.value,
      "project",
      "settings.local.json",
    );
    config.hooks = [...config.hooks, ...localHooks];
    const localAgents = parseAgentsFromSettings(localSettingsResult.value, "project");
    config.agents = [...config.agents, ...localAgents];
  }

  return config;
}

// ── Store Implementation ──────────────────────────────────────────────

export const useConfigDiscoveryStore = create<ConfigDiscoveryState>((set, get) => ({
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

  discoverGlobal: async () => {
    set({ loading: true, error: null });
    try {
      const config: ScopeConfig = emptyScope();

      // Independent concerns run concurrently (matches the original
      // Promise.allSettled fan-out — no added latency). Promise.all is safe
      // because every helper catches its own IPC failure and returns an
      // empty/default slice, so it never rejects: one missing dir yields an
      // empty slice without aborting the batch (partial-failure tolerance).
      const [claudeMd, settings, skills, rules, knowledge, memoryFiles] = await Promise.all([
        discoverGlobalClaudeMd(),
        discoverGlobalSettings(),
        discoverGlobalSkills(),
        discoverGlobalRules(),
        discoverGlobalKnowledge(),
        discoverGlobalMemory(),
      ]);

      config.claudeMd = claudeMd;
      config.settingsRaw = settings.settingsRaw;
      config.hooks = settings.hooks;
      config.skills = skills;
      config.rules = rules;
      config.knowledge = knowledge;
      config.memoryFiles = memoryFiles;

      // Genuine dependency: agents/*.md merges onto the settings.json agents.
      config.agents = await discoverGlobalAgents(settings.agents);

      set({ globalConfig: config, loading: false });
    } catch (err) {
      logError("configDiscoveryStore.discoverGlobal", err);
      set({ error: String(err), loading: false });
    }
  },

  discoverProject: async (folder: string) => {
    if (!folder) return;
    set({ loading: true, error: null, projectPath: folder });
    try {
      const config = await scanProjectScope(folder);
      set({ projectConfig: config, loading: false });
    } catch (err) {
      logError("configDiscoveryStore.discoverProject", err);
      set({ error: String(err), loading: false });
    }
  },

  discoverFavorites: async (folders: string[]) => {
    if (folders.length === 0) return;

    // Mark all as loading
    const loadingMap: Record<string, boolean> = {};
    for (const f of folders) loadingMap[f] = true;
    set({ favoritesLoading: loadingMap });

    const results: Record<string, ScopeConfig> = {};

    await Promise.allSettled(
      folders.map(async (folder) => {
        try {
          results[folder] = await scanProjectScope(folder);
        } catch (err) {
          logError(`configDiscoveryStore.discoverFavorite(${folder})`, err);
        }
      }),
    );

    set({ favoriteConfigs: results, favoritesLoading: {} });
  },

  loadContent: async (key: string, loader: () => Promise<string>) => {
    const cached = get().contentCache[key];
    if (cached !== undefined) return cached;

    const isLoading = get().contentLoading[key];
    if (isLoading) return "";

    set((s) => ({ contentLoading: { ...s.contentLoading, [key]: true } }));

    try {
      const content = await loader();
      set((s) => ({
        contentCache: { ...s.contentCache, [key]: content },
        contentLoading: { ...s.contentLoading, [key]: false },
      }));
      return content;
    } catch (err) {
      logError("configDiscoveryStore.loadContent", err);
      set((s) => ({
        contentCache: { ...s.contentCache, [key]: `Fehler beim Laden: ${err}` },
        contentLoading: { ...s.contentLoading, [key]: false },
      }));
      return "";
    }
  },

  clearProject: () => {
    set({ projectConfig: null, projectPath: null, contentCache: {}, contentLoading: {} });
  },

  openDetail: (detail: SelectedDetail) => set({ selectedDetail: detail }),
  closeDetail: () => set({ selectedDetail: null }),
}));

// ── Selectors ──────────────────────────────────────────────────────────

export const selectSelectedDetail = (s: ConfigDiscoveryState) => s.selectedDetail;
export const selectOpenDetail = (s: ConfigDiscoveryState) => s.openDetail;
export const selectCloseDetail = (s: ConfigDiscoveryState) => s.closeDetail;
