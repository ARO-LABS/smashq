import { useState } from "react";
import { Scroll, ChevronDown, ChevronRight } from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import type { DiscoveredRule } from "../../store/configDiscoveryStore";

interface RulesSectionProps {
  rules: DiscoveredRule[];
  sectionKey: string;
}

function RuleCard({ rule }: { rule: DiscoveredRule }) {
  const [expanded, setExpanded] = useState(false);

  // Glob can be long; truncate visually but keep full text in the title attribute
  // so users can hover-read the exact pattern.
  const globShort =
    rule.glob && rule.glob.length > 30
      ? `${rule.glob.slice(0, 27)}...`
      : rule.glob;

  return (
    <div className="rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-3 py-1.5 hover:bg-hover-overlay transition-colors rounded-md"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Scroll className="w-3 h-3 text-accent shrink-0" />
          <span className="text-xs font-semibold text-neutral-200">
            {rule.name}
          </span>
          {rule.glob ? (
            <span
              className="text-[10px] px-1.5 py-0.5 bg-accent-a10 text-accent font-mono truncate"
              title={`Applies to ${rule.glob}`}
            >
              {globShort}
            </span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 bg-neutral-700 text-neutral-400 font-mono">
              global
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2">
          <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed bg-surface-base rounded-md shadow-hairline p-3 max-h-[40vh] overflow-auto">
            {rule.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export function RulesSection({ rules, sectionKey }: RulesSectionProps) {
  const open = useUIStore(
    (s) => s.librarySectionOpen[sectionKey] ?? false,
  );
  const setLibrarySectionOpen = useUIStore((s) => s.setLibrarySectionOpen);

  if (rules.length === 0) return null;

  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <button
        onClick={() => setLibrarySectionOpen(sectionKey, !open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-hover-overlay transition-colors"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neutral-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neutral-500 shrink-0" />
        )}
        <Scroll className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        <span className="text-xs font-medium text-neutral-300">Rules</span>
        <span className="text-[10px] text-neutral-500 ml-auto">{rules.length}</span>
      </button>
      {open && (
        <div className="px-3 pb-3">
          {rules.map((r) => (
            <RuleCard key={r.filename} rule={r} />
          ))}
        </div>
      )}
    </div>
  );
}
