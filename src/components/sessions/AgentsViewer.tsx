import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ICONS } from "../../utils/icons";
import {
  parseAgentFrontmatter,
  type ParsedAgent,
} from "../../utils/parseAgentFrontmatter";
import {
  MasterDetailViewer,
  DetailSectionHeading,
  DetailBody,
} from "./masterDetailViewer";

const Bot = ICONS.library.agent;

interface AgentsViewerProps {
  folder: string;
}

interface AgentEntry {
  id: string;
  fileName: string;
  parsed: ParsedAgent;
}

export function AgentsViewer({ folder }: AgentsViewerProps) {
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const loadAgents = async () => {
    setLoading(true);
    try {
      const files = await invoke<string[]>("list_project_dir", {
        folder,
        relativePath: ".claude/agents",
      });
      const mdFiles = files.filter((f) => f.endsWith(".md"));

      const entries: AgentEntry[] = [];
      for (const name of mdFiles) {
        try {
          const content = await invoke<string>("read_project_file", {
            folder,
            relativePath: `.claude/agents/${name}`,
          });
          const parsed = parseAgentFrontmatter(content, name);
          entries.push({ id: name, fileName: name, parsed });
        } catch {
          // Skip unreadable files
        }
      }

      setAgents(entries);
      // Functional updater so it reads the *fresh* selectedId: the folder-change
      // effect calls setSelectedId(null) in the same tick, so the closure value
      // captured here is stale. Keep a still-valid selection, else select first.
      setSelectedId((prev) =>
        prev && entries.some((e) => e.id === prev)
          ? prev
          : entries[0]?.id ?? null,
      );
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedId(null);
    setSearch("");
    loadAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only on folder change
  }, [folder]);

  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      (a) =>
        a.parsed.metadata.name.toLowerCase().includes(q) ||
        a.parsed.metadata.description.toLowerCase().includes(q) ||
        a.parsed.metadata.model.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedId) ?? null,
    [agents, selectedId],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade Agents...
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
        <Bot className="w-10 h-10 text-neutral-600" />
        <span className="text-sm">Keine Agents in diesem Projekt konfiguriert</span>
        <span className="text-xs text-neutral-600">.claude/agents/</span>
      </div>
    );
  }

  return (
    <MasterDetailViewer
      title="Agents"
      count={agents.length}
      onReload={loadAgents}
      search={search}
      onSearchChange={setSearch}
      filteredEmpty={filteredAgents.length === 0}
      filteredEmptyText="Keine Agents gefunden"
      detailPlaceholder="Agent auswählen"
      detail={selectedAgent ? <AgentDetail entry={selectedAgent} /> : null}
      cards={filteredAgents.map((entry) => {
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
            </div>
            {metadata.description && (
              <div className="text-xs text-neutral-400 truncate mt-0.5">
                {metadata.description}
              </div>
            )}
            {metadata.model && (
              <div className="mt-1">
                <span className="inline-block px-1.5 py-0 text-[10px] rounded-sm bg-neutral-800 text-neutral-500">
                  {metadata.model}
                </span>
              </div>
            )}
          </button>
        );
      })}
    />
  );
}

function AgentDetail({ entry }: { entry: AgentEntry }) {
  const { metadata, body } = entry.parsed;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-base font-semibold text-neutral-200">
            {metadata.name}
          </h2>
          {metadata.model && (
            <span className="inline-block px-1.5 py-0 text-[10px] rounded-sm bg-neutral-800 text-neutral-400">
              {metadata.model}
            </span>
          )}
        </div>
        {metadata.description && (
          <p className="text-sm text-neutral-400">{metadata.description}</p>
        )}
      </div>

      {/* Metadata fields */}
      <div className="grid grid-cols-2 gap-2">
        {metadata.maxTurns !== null && (
          <div className="bg-surface-raised rounded px-3 py-2">
            <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
              Max Turns
            </span>
            <div className="text-xs text-neutral-200 font-mono mt-0.5">
              {metadata.maxTurns}
            </div>
          </div>
        )}
        <div className="bg-surface-raised rounded px-3 py-2">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
            Datei
          </span>
          <div className="text-xs text-neutral-200 font-mono mt-0.5 truncate">
            .claude/agents/{entry.fileName}
          </div>
        </div>
      </div>

      {/* Allowed Tools */}
      {metadata.allowedTools.length > 0 && (
        <div>
          <DetailSectionHeading>Erlaubte Tools</DetailSectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {metadata.allowedTools.map((tool) => (
              <span
                key={tool}
                className="inline-block px-2 py-0.5 text-xs rounded-sm bg-surface-raised text-neutral-300 font-mono"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {body && <DetailBody body={body} />}
    </div>
  );
}
