import { useState, useMemo } from "react";
import { ICONS } from "../../utils/icons";
import {
  type SettingsSource,
  SETTINGS_SOURCES,
  useClaudeSettingsRaws,
  SourceBadge,
  SourceLegend,
  RawJsonView,
} from "./claudeSettingsSources";

const RefreshCw = ICONS.action.refresh;
const Settings = ICONS.nav.settings;
const Code2 = ICONS.viewer.code;
const Shield = ICONS.viewer.permissions;
const ShieldOff = ICONS.viewer.permissionsOff;
const Server = ICONS.viewer.server;
const Cpu = ICONS.viewer.system;

interface SettingsViewerProps {
  folder: string;
}

interface SettingsEntry {
  key: string;
  value: unknown;
  source: SettingsSource;
}

interface SettingsSection {
  title: string;
  icon: typeof Shield;
  entries: SettingsEntry[];
}

/** Known top-level keys and their display config */
const SECTION_CONFIG: Record<string, { title: string; icon: typeof Shield }> = {
  allowedTools: { title: "Erlaubte Tools", icon: Shield },
  disallowedTools: { title: "Verbotene Tools", icon: ShieldOff },
  mcpServers: { title: "MCP-Server", icon: Server },
  model: { title: "Modell", icon: Cpu },
  permissions: { title: "Berechtigungen", icon: Shield },
};

/** Keys that are displayed in dedicated tabs (Hooks) or not relevant for the overview */
const EXCLUDED_KEYS = new Set(["hooks"]);

// eslint-disable-next-line react-refresh/only-export-components
export function parseSettings(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildSettingsSections(
  raws: Record<SettingsSource, string>,
): SettingsSection[] {
  /** Collect entries grouped by key */
  const keyMap = new Map<string, SettingsEntry[]>();

  for (const source of SETTINGS_SOURCES) {
    const raw = raws[source];
    if (!raw) continue;
    const parsed = parseSettings(raw);
    if (!parsed) continue;

    for (const [key, value] of Object.entries(parsed)) {
      if (EXCLUDED_KEYS.has(key)) continue;
      const existing = keyMap.get(key) ?? [];
      existing.push({ key, value, source });
      keyMap.set(key, existing);
    }
  }

  const sections: SettingsSection[] = [];
  for (const [key, entries] of keyMap) {
    const config = SECTION_CONFIG[key] ?? { title: key, icon: Settings };
    sections.push({ title: config.title, icon: config.icon, entries });
  }

  // Sort: known sections first (by SECTION_CONFIG order), then alphabetical
  const knownOrder = Object.keys(SECTION_CONFIG);
  sections.sort((a, b) => {
    const aIdx = knownOrder.indexOf(
      a.entries[0]?.key ?? "",
    );
    const bIdx = knownOrder.indexOf(
      b.entries[0]?.key ?? "",
    );
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.title.localeCompare(b.title);
  });

  return sections;
}

export function SettingsViewer({ folder }: SettingsViewerProps) {
  const { raws, loading, reload } = useClaudeSettingsRaws(
    folder,
    "SettingsViewer.load",
  );
  const [showRaw, setShowRaw] = useState(false);

  const sections = useMemo(() => buildSettingsSections(raws), [raws]);

  const visibleSources = useMemo(
    () => new Set(sections.flatMap((s) => s.entries.map((e) => e.source))),
    [sections],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        Lade Settings...
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500 px-6">
        <Settings className="w-10 h-10 text-neutral-600" />
        <span className="text-sm font-medium">Keine Settings konfiguriert</span>
        <p className="text-xs text-neutral-600 text-center max-w-xs leading-relaxed">
          Claude-Settings werden in{" "}
          <code className="text-neutral-400">.claude/settings.json</code>{" "}
          konfiguriert. Hooks werden im separaten{" "}
          <code className="text-neutral-400">Hooks</code>-Tab angezeigt.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 font-medium">
            {sections.length}{" "}
            {sections.length === 1 ? "Kategorie" : "Kategorien"}
          </span>
          {/* Source legend */}
          <SourceLegend visibleSources={visibleSources} />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`p-1 transition-colors rounded-sm ${
              showRaw
                ? "text-accent bg-accent-a10"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
            title={showRaw ? "Strukturierte Ansicht" : "Raw JSON"}
          >
            <Code2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={reload}
            className="p-1 text-neutral-500 hover:text-neutral-300 transition-colors"
            title="Neu laden"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {showRaw ? (
          <RawJsonView raws={raws} />
        ) : (
          <div className="space-y-4">
            {sections.map((section) => (
              <SectionCard key={section.title} section={section} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: SettingsSection }) {
  const Icon = section.icon;
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-accent font-bold mb-2">
        <Icon className="w-3.5 h-3.5" />
        {section.title}
      </div>
      <div className="space-y-2">
        {section.entries.map((entry, i) => (
          <div
            key={`${entry.source}-${i}`}
            className="bg-surface-raised border border-neutral-700 rounded-sm px-3 py-2.5"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <SourceBadge source={entry.source} />
            </div>
            <SettingsValue value={entry.value} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span className="text-xs text-neutral-500 italic">Leer</span>
      );
    }
    return (
      <ul className="space-y-1">
        {value.map((item, i) => (
          <li
            key={i}
            className="text-xs text-neutral-200 font-mono bg-neutral-900 px-2.5 py-1.5 rounded-sm"
          >
            {typeof item === "string" ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    );
  }

  if (value !== null && typeof value === "object") {
    return (
      <pre className="text-xs text-neutral-200 whitespace-pre-wrap font-mono leading-relaxed bg-neutral-900 rounded-sm px-3 py-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return (
    <span className="text-xs text-neutral-200 font-mono">
      {String(value)}
    </span>
  );
}
