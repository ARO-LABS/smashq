import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Puzzle, FolderOpen } from "lucide-react";
import {
  parseSkillFrontmatter,
  type ParsedSkill,
} from "../../utils/parseSkillFrontmatter";
import {
  MasterDetailViewer,
  DetailSectionHeading,
  DetailBody,
} from "./masterDetailViewer";

interface SkillsViewerProps {
  folder: string;
}

interface SkillDirEntry {
  dir_name: string;
  content: string;
  has_reference_dir: boolean;
}

interface SkillEntry {
  id: string;
  parsed: ParsedSkill;
  hasReferenceDir: boolean;
}

type Filter = "alle" | "aufrufbar" | "auto";

export function SkillsViewer({ folder }: SkillsViewerProps) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("alle");
  const [search, setSearch] = useState("");

  const loadSkills = async () => {
    setLoading(true);
    try {
      const entries = await loadViaSkillDirs(folder);
      setSkills(entries);
      // Functional updater so it reads the *fresh* selectedId: the folder-change
      // effect calls setSelectedId(null) in the same tick, so the closure value
      // captured here is stale. Keep a still-valid selection, else select first.
      setSelectedId((prev) =>
        prev && entries.some((e) => e.id === prev)
          ? prev
          : entries[0]?.id ?? null,
      );
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    setSearch("");
    setFilter("alle");
    loadSkills();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on folder change
  }, [folder]);

  const filteredSkills = useMemo(() => {
    let result = skills;

    if (filter === "aufrufbar") {
      result = result.filter((s) => s.parsed.metadata.userInvokable);
    } else if (filter === "auto") {
      result = result.filter((s) => !s.parsed.metadata.userInvokable);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.parsed.metadata.name.toLowerCase().includes(q) ||
          s.parsed.metadata.description.toLowerCase().includes(q)
      );
    }

    return result;
  }, [skills, filter, search]);

  const selectedSkill = useMemo(
    () => skills.find((s) => s.id === selectedId) ?? null,
    [skills, selectedId]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade Skills...
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <Puzzle className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">
          Keine Skills in diesem Projekt konfiguriert
        </span>
        <span className="text-xs text-neutral-600">.claude/skills/</span>
      </div>
    );
  }

  return (
    <MasterDetailViewer
      title="Skills"
      count={skills.length}
      onReload={loadSkills}
      search={search}
      onSearchChange={setSearch}
      filteredEmpty={filteredSkills.length === 0}
      filteredEmptyText="Keine Skills gefunden"
      detailPlaceholder="Skill auswählen"
      detail={selectedSkill ? <SkillDetail entry={selectedSkill} /> : null}
      filterBar={
        <div className="flex gap-1">
          {(["alle", "aufrufbar", "auto"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded-sm transition-colors ${
                filter === f
                  ? "bg-accent-a10 text-accent"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
              }`}
            >
              {f === "alle" ? "Alle" : f === "aufrufbar" ? "Aufrufbar" : "Automatisch"}
            </button>
          ))}
        </div>
      }
      cards={filteredSkills.map((entry) => {
        const { metadata } = entry.parsed;
        const isActive = selectedId === entry.id;
        return (
          <button
            key={entry.id}
            onClick={() => setSelectedId(entry.id)}
            className={`w-full text-left px-3 py-2 transition-colors border-l-2 ${
              isActive
                ? "border-accent bg-accent-a10"
                : "border-transparent hover:bg-hover-overlay"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`text-xs font-semibold truncate ${
                  isActive ? "text-accent" : "text-neutral-200"
                }`}
              >
                {metadata.name}
              </span>
              {entry.hasReferenceDir && (
                <FolderOpen className="w-3 h-3 text-neutral-500 shrink-0" />
              )}
            </div>
            {metadata.description && (
              <div className="text-xs text-neutral-400 truncate mt-0.5">
                {metadata.description}
              </div>
            )}
            <div className="mt-1">
              <span
                className={`inline-block px-1.5 py-0 text-[10px] rounded-sm ${
                  metadata.userInvokable
                    ? "bg-accent-a10 text-accent"
                    : "bg-neutral-800 text-neutral-500"
                }`}
              >
                {metadata.userInvokable ? "Aufrufbar" : "Auto"}
              </span>
            </div>
          </button>
        );
      })}
    />
  );
}

function SkillDetail({ entry }: { entry: SkillEntry }) {
  const { metadata, body } = entry.parsed;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-semibold text-neutral-200">
            {metadata.name}
          </h2>
          <span
            className={`inline-block px-1.5 py-0 text-[10px] rounded-sm ${
              metadata.userInvokable
                ? "bg-accent-a10 text-accent"
                : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {metadata.userInvokable ? "Aufrufbar" : "Auto"}
          </span>
          {entry.hasReferenceDir && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0 text-[10px] rounded-sm bg-neutral-800 text-neutral-500">
              <FolderOpen className="w-2.5 h-2.5" />
              Referenzen
            </span>
          )}
        </div>
        {metadata.description && (
          <p className="text-sm text-neutral-400">{metadata.description}</p>
        )}
      </div>

      {/* Args */}
      {metadata.args.length > 0 && (
        <div>
          <DetailSectionHeading>Parameter</DetailSectionHeading>
          <div className="space-y-1.5">
            {metadata.args.map((arg) => (
              <div
                key={arg.name}
                className="flex items-start gap-2 bg-surface-raised rounded px-3 py-2"
              >
                <code className="text-xs text-accent font-mono shrink-0">
                  {arg.name}
                </code>
                {arg.required && (
                  <span className="text-[10px] text-error shrink-0">
                    *erforderlich
                  </span>
                )}
                <span className="ae-body-sm">
                  {arg.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {body && <DetailBody body={body} />}
    </div>
  );
}

// --- Data loading ---

async function loadViaSkillDirs(folder: string): Promise<SkillEntry[]> {
  try {
    const dirs = await invoke<SkillDirEntry[]>("list_skill_dirs", { folder });
    if (dirs.length > 0) {
      return dirs.map((d) => ({
        id: d.dir_name,
        parsed: parseSkillFrontmatter(d.content),
        hasReferenceDir: d.has_reference_dir,
      }));
    }
  } catch {
    // list_skill_dirs not available, fall through
  }

  return loadViaLegacy(folder);
}

async function loadViaLegacy(folder: string): Promise<SkillEntry[]> {
  const files = await invoke<string[]>("list_project_dir", {
    folder,
    relativePath: ".claude/skills",
  });
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const entries: SkillEntry[] = [];
  for (const name of mdFiles) {
    try {
      const content = await invoke<string>("read_project_file", {
        folder,
        relativePath: `.claude/skills/${name}`,
      });
      const parsed = parseSkillFrontmatter(content);
      // Use filename as fallback name if frontmatter has no name
      if (parsed.metadata.name === "Unknown") {
        parsed.metadata.name = name.replace(/\.md$/, "");
      }
      entries.push({ id: name, parsed, hasReferenceDir: false });
    } catch {
      // Skip unreadable files
    }
  }

  return entries;
}
