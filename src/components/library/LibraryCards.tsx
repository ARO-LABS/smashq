import { useState, useCallback } from "react";
import { Zap, Bot, Webhook, Brain } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useConfigDiscoveryStore,
  selectOpenDetail,
  type DiscoveredSkill,
  type DiscoveredAgent,
  type DiscoveredHook,
  type DiscoveredMemoryFile,
} from "../../store/configDiscoveryStore";
import { SkillArgBadge } from "./SkillArgBadge";
import { ContentPreview } from "./ContentPreview";
import { useUIStore } from "../../store/uiStore";
import { ICONS, ICON_SIZE } from "../../utils/icons";

// ── Card renderers ───────────────────────────────────────────────────
// Tightly-coupled family of list-item cards rendered inside ScopePanel
// sections. Grouped in one file because each is presentational and shares
// the same store/types — splitting into four files would only add import
// noise without separating real responsibilities.

// ── Skill Card ───────────────────────────────────────────────────────

function skillBodyPreview(body: string): string {
  return body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim()
    .slice(0, 80);
}

export function SkillCard({ skill }: { skill: DiscoveredSkill }): JSX.Element {
  const openDetail = useConfigDiscoveryStore(selectOpenDetail);

  const preview = skill.description || skillBodyPreview(skill.body);

  return (
    <div className="rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <button
        onClick={() => openDetail({ category: "skills", item: skill })}
        className="w-full text-left px-3 py-2 hover:bg-hover-overlay transition-colors rounded-md"
      >
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-accent shrink-0" />
          <span className="text-xs font-semibold text-neutral-200">
            {skill.name}
          </span>
          {skill.hasReference && (
            <span className="text-[10px] px-1 rounded bg-blue-500/15 text-blue-400">
              ref/
            </span>
          )}
        </div>
        <p className={`text-[11px] mt-0.5 ml-5 line-clamp-2 ${preview ? "text-neutral-400" : "text-neutral-600"}`}>
          {preview || "Keine Beschreibung"}
        </p>
        {skill.args.length > 0 && (
          <div className="flex gap-1 mt-1 ml-5 flex-wrap">
            {skill.args.map((a) => (
              <SkillArgBadge key={a.name} arg={a} />
            ))}
          </div>
        )}
      </button>
    </div>
  );
}

// ── Agent Card ───────────────────────────────────────────────────────

export function AgentCard({ agent }: { agent: DiscoveredAgent }): JSX.Element {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5 rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <Bot className="w-3 h-3 text-purple-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-neutral-200">
            {agent.name}
          </span>
          <span className="text-[10px] px-1.5 rounded-full bg-purple-500/15 text-purple-400 ml-auto shrink-0">
            {agent.model}
          </span>
        </div>
        {agent.description && (
          <p className="text-[11px] text-neutral-400 mt-0.5 line-clamp-1">
            {agent.description}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Hook Card ────────────────────────────────────────────────────────

export function HookCard({ hook }: { hook: DiscoveredHook }): JSX.Element {
  const openDetail = useConfigDiscoveryStore(selectOpenDetail);

  return (
    <div className="rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <button
        onClick={() => openDetail({ category: "hooks", item: hook })}
        className="w-full text-left flex items-start gap-2 px-3 py-1.5 hover:bg-hover-overlay transition-colors rounded-md"
      >
        <Webhook className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-neutral-200">
              {hook.event}
            </span>
            {hook.matcher && (
              <span className="text-[10px] px-1 rounded bg-neutral-800 text-neutral-500 truncate max-w-[200px]">
                {hook.matcher}
              </span>
            )}
          </div>
          <code className="text-[11px] text-neutral-400 block mt-0.5 truncate font-mono">
            {hook.command}
          </code>
        </div>
        <span className="text-[10px] text-neutral-600 shrink-0">{hook.source}</span>
      </button>
    </div>
  );
}

// ── Memory File List ─────────────────────────────────────────────────

/** Extract a readable message from an invoke rejection (Error or structured ADPError object). */
function invokeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

export function MemoryFileCard({
  file,
}: {
  file: DiscoveredMemoryFile;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleteMemoryFile = useConfigDiscoveryStore((s) => s.deleteMemoryFile);
  const addToast = useUIStore((s) => s.addToast);
  const contentKey = `global:memory:${file.relativePath}`;
  const loader = useCallback(
    () =>
      invoke<string>("read_user_claude_file", {
        relativePath: file.relativePath,
      }),
    [file.relativePath],
  );

  const handleDelete = useCallback(async () => {
    try {
      await deleteMemoryFile(file.relativePath);
    } catch (err) {
      setConfirming(false);
      addToast({
        type: "error",
        title: "Memory-Datei konnte nicht gelöscht werden",
        message: invokeErrorMessage(err),
      });
    }
  }, [deleteMemoryFile, file.relativePath, addToast]);

  return (
    <div className="rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <div className="flex items-center">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 min-w-0 text-left px-3 py-1.5 hover:bg-hover-overlay transition-colors rounded-md"
        >
          <div className="flex items-center gap-2">
            <Brain className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-xs text-neutral-200 truncate">{file.name}</span>
          </div>
        </button>
        {confirming ? (
          <div className="flex items-center gap-1 px-2 shrink-0">
            <button
              onClick={handleDelete}
              title="Löschen bestätigen"
              className="text-[10px] px-1.5 py-0.5 rounded-sm bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              Löschen
            </button>
            <button
              onClick={() => setConfirming(false)}
              title="Abbrechen"
              className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <ICONS.action.close className={ICON_SIZE.inline} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="In Papierkorb verschieben"
            className="p-1.5 mr-1 text-neutral-600 hover:text-red-400 transition-colors shrink-0"
          >
            <ICONS.action.trash className={ICON_SIZE.inline} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="px-3 pb-2">
          <ContentPreview
            title={file.name}
            contentKey={contentKey}
            loader={loader}
          />
        </div>
      )}
    </div>
  );
}
