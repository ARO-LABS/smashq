import { useCallback } from "react";
import {
  Globe,
  Zap,
  Bot,
  Webhook,
  Settings,
  FileText,
  Brain,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import {
  hasScopeContent,
  type ScopeConfig,
  type ConfigScope,
} from "../../store/configDiscoveryStore";
import { Section } from "./Section";
import { ContentPreview } from "./ContentPreview";
import { SkillCard, AgentCard, HookCard, MemoryFileCard } from "./LibraryCards";
import { RulesSection } from "./RulesSection";
import { KnowledgeSection } from "./KnowledgeSection";

// ── Scope Panel ──────────────────────────────────────────────────────

interface ScopePanelProps {
  scope: ConfigScope;
  config: ScopeConfig;
  label: string;
  icon: typeof Globe;
  scopeId: string;
  /** Unique key used to namespace the content cache — must be unique per panel */
  folder: string;
}

export function ScopePanel({
  scope,
  config,
  label,
  icon: Icon,
  scopeId,
  folder,
}: ScopePanelProps): JSX.Element {
  const open = useUIStore((s) => s.libraryScopeOpen[scopeId] ?? false);
  const setLibraryScopeOpen = useUIStore((s) => s.setLibraryScopeOpen);

  const hasContent = hasScopeContent(config);

  // Include folder in key to avoid cache collisions across multiple project panels
  const settingsContentKey = `${scope}:${folder}:settings`;
  const settingsLoader = useCallback(async () => config.settingsRaw, [config.settingsRaw]);

  const claudeMdContentKey = `${scope}:${folder}:claude-md`;
  const claudeMdLoader = useCallback(async () => config.claudeMd, [config.claudeMd]);

  return (
    <div className="rounded-md shadow-hairline overflow-hidden bg-surface-raised">
      <button
        onClick={() => setLibraryScopeOpen(scopeId, !open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-hover-overlay transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
        )}
        <Icon className="w-4 h-4 text-accent shrink-0" />
        <span className="text-sm font-semibold text-neutral-200">{label}</span>
        {!hasContent && (
          <span className="text-[10px] text-neutral-600 ml-auto">
            Keine Konfiguration gefunden
          </span>
        )}
      </button>

      {open && hasContent && (
        <div className="border-t border-neutral-800">
          <Section
            icon={Zap}
            title="Skills"
            count={config.skills.length}
            sectionKey={`${scopeId}:skills`}
          >
            {config.skills.map((s) => (
              <SkillCard key={`${s.scope}-${s.dirName}`} skill={s} />
            ))}
          </Section>

          <Section
            icon={Bot}
            title="Agents"
            count={config.agents.length}
            sectionKey={`${scopeId}:agents`}
          >
            {config.agents.map((a) => (
              <AgentCard key={`${a.scope}-${a.name}`} agent={a} />
            ))}
          </Section>

          <Section
            icon={Webhook}
            title="Hooks"
            count={config.hooks.length}
            sectionKey={`${scopeId}:hooks`}
          >
            {config.hooks.map((h, i) => (
              <HookCard key={`${h.scope}-${h.event}-${i}`} hook={h} />
            ))}
          </Section>

          <RulesSection
            rules={config.rules}
            sectionKey={`${scopeId}:rules`}
          />

          <KnowledgeSection
            knowledge={config.knowledge}
            sectionKey={`${scopeId}:knowledge`}
          />

          {config.settingsRaw && (
            <Section icon={Settings} title="Settings" count={1} sectionKey={`${scopeId}:settings`}>
              <ContentPreview
                title="settings.json"
                contentKey={settingsContentKey}
                loader={settingsLoader}
              />
            </Section>
          )}

          {config.claudeMd && (
            <Section icon={FileText} title="CLAUDE.md" count={1} sectionKey={`${scopeId}:claude-md`}>
              <ContentPreview
                title="CLAUDE.md"
                contentKey={claudeMdContentKey}
                loader={claudeMdLoader}
              />
            </Section>
          )}

          {config.memoryFiles.length > 0 && (
            <Section
              icon={Brain}
              title="Memory"
              count={config.memoryFiles.length}
              sectionKey={`${scopeId}:memory`}
            >
              {config.memoryFiles.map((f) => (
                <MemoryFileCard key={f.relativePath} file={f} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
