import { MarkdownPreview } from "../editor/MarkdownPreview";
import { InstancePanel } from "./InstancePanel";
import { SkillArgBadge } from "./SkillArgBadge";
import type {
  SelectedDetail,
  DiscoveredSkill,
  DiscoveredHook,
} from "../../store/configDiscoveryStore";

// ── Frontmatter Table ────────────────────────────────────────────────

function FrontmatterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-b border-neutral-800 last:border-b-0">
      <td className="py-1.5 pr-4 text-[11px] font-medium text-neutral-500 whitespace-nowrap align-top w-[120px]">
        {label}
      </td>
      <td className="py-1.5 text-xs text-neutral-200 align-top break-words max-w-0 w-full">
        {children}
      </td>
    </tr>
  );
}

function SkillFrontmatterTable({ skill }: { skill: DiscoveredSkill }) {
  return (
    <div className="shrink-0 px-4 pt-4 pb-3">
      <table className="w-full table-fixed">
        <tbody>
          <FrontmatterRow label="name">{skill.name}</FrontmatterRow>
          {skill.description && (
            <FrontmatterRow label="description">{skill.description}</FrontmatterRow>
          )}
          <FrontmatterRow label="scope">
            <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-neutral-700 text-neutral-300">
              {skill.scope}
            </span>
          </FrontmatterRow>
          {skill.hasReference && (
            <FrontmatterRow label="reference">
              <span className="text-[10px] px-1 rounded bg-blue-500/15 text-blue-400">ref/</span>
            </FrontmatterRow>
          )}
          {skill.args.length > 0 && (
            <FrontmatterRow label="args">
              <div className="flex flex-wrap gap-1">
                {skill.args.map((a) => (
                  <SkillArgBadge key={a.name} arg={a} />
                ))}
              </div>
            </FrontmatterRow>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Instance Left Column ─────────────────────────────────────────────

function SkillInstanceLeft({ skill }: { skill: DiscoveredSkill }) {
  return (
    <>
      <SkillFrontmatterTable skill={skill} />
      <div className="shrink-0 mx-4 border-t border-neutral-800" />
      <div className="flex-1 min-h-0">
        {skill.body ? (
          <MarkdownPreview content={skill.body} />
        ) : skill.description ? (
          <MarkdownPreview content={skill.description} />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-neutral-600 p-4">
            Kein Inhalt vorhanden
          </div>
        )}
      </div>
    </>
  );
}

function HookInstanceLeft({ hook }: { hook: DiscoveredHook }) {
  return (
    <>
      <div className="shrink-0 px-4 pt-4 pb-3">
        <table className="w-full table-fixed">
          <tbody>
            <FrontmatterRow label="event">{hook.event}</FrontmatterRow>
            {hook.matcher && (
              <FrontmatterRow label="matcher">
                <code className="font-mono">{hook.matcher}</code>
              </FrontmatterRow>
            )}
            <FrontmatterRow label="source">{hook.source}</FrontmatterRow>
            <FrontmatterRow label="scope">
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-neutral-700 text-neutral-300">
                {hook.scope}
              </span>
            </FrontmatterRow>
          </tbody>
        </table>
      </div>
      <div className="shrink-0 mx-4 border-t border-neutral-800" />
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
        <p className="text-[11px] font-medium text-neutral-500 mb-1.5">Command</p>
        <pre className="text-xs font-mono text-neutral-200 whitespace-pre-wrap break-all rounded-md bg-surface-base px-3 py-2 shadow-hairline">
          {hook.command}
        </pre>
      </div>
    </>
  );
}

function PlaceholderLeft({ category }: { category: string }) {
  return (
    <div className="flex items-center justify-center h-full p-4 text-xs text-neutral-600">
      Detail-Ansicht für „{category}" kommt in M2.
    </div>
  );
}

// ── LibraryDetailContent ─────────────────────────────────────────────

interface LibraryDetailContentProps {
  detail: SelectedDetail;
}

export function LibraryDetailContent({ detail }: LibraryDetailContentProps): JSX.Element {
  return (
    <div className="flex flex-col md:flex-row flex-1 min-h-0">
      {/* Left column — 60% */}
      <div className="flex flex-col min-h-0 md:overflow-y-auto md:flex-[3] border-b md:border-b-0 md:border-r border-neutral-800">
        {detail.category === "skills" ? (
          <SkillInstanceLeft skill={detail.item} />
        ) : detail.category === "hooks" ? (
          <HookInstanceLeft hook={detail.item} />
        ) : (
          <PlaceholderLeft category={detail.category} />
        )}
      </div>

      {/* Right column — 40% */}
      <div className="md:flex-[2] flex flex-col min-h-0 md:overflow-y-auto bg-surface-base/30">
        <InstancePanel />
      </div>
    </div>
  );
}
