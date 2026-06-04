import { useState, useMemo } from "react";
import {
  BookText,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Shield,
  FileCode,
  FileText,
} from "lucide-react";
import { useUIStore } from "../../store/uiStore";
import type {
  DiscoveredKnowledge,
  KnowledgeCategory,
} from "../../store/configDiscoveryStore";

interface KnowledgeSectionProps {
  knowledge: DiscoveredKnowledge[];
  sectionKey: string;
}

const CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  security: "Security Checklists",
  templates: "Templates",
  general: "General",
};

const CATEGORY_ICON: Record<KnowledgeCategory, typeof BookText> = {
  security: Shield,
  templates: FileCode,
  general: FileText,
};

// Display order — security first because it's the highest-stakes content.
const ORDERED_CATEGORIES: KnowledgeCategory[] = ["security", "templates", "general"];

function KnowledgeCard({ entry }: { entry: DiscoveredKnowledge }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Copy-to-clipboard with optimistic check-icon feedback. Failure is silent;
  // a more verbose error toast would require routing through the toast store
  // and is overkill for a copy that almost never fails in a Tauri webview.
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(entry.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API failure — leave UI unchanged
    }
  };

  return (
    <div className="rounded-md shadow-hairline bg-surface-raised mb-1.5 hover:shadow-lift transition-shadow duration-200">
      <div
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-hover-overlay transition-colors cursor-pointer rounded-md"
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <BookText className="w-3 h-3 text-accent shrink-0" />
        <span className="text-xs font-semibold text-neutral-200 truncate flex-1">
          {entry.name}
        </span>
        <span className="text-[10px] text-neutral-500 font-mono shrink-0">
          .{entry.fileType}
        </span>
        <button
          onClick={handleCopy}
          className="p-0.5 text-neutral-500 hover:text-accent transition-colors"
          title="In Zwischenablage kopieren"
          aria-label={`${entry.name} in Zwischenablage kopieren`}
        >
          {copied ? (
            <Check className="w-3 h-3 text-success" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
      {expanded && (
        <div className="px-3 pb-2">
          <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap font-mono leading-relaxed bg-surface-base rounded-md shadow-hairline p-3 max-h-[40vh] overflow-auto">
            {entry.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export function KnowledgeSection({ knowledge, sectionKey }: KnowledgeSectionProps) {
  const open = useUIStore(
    (s) => s.librarySectionOpen[sectionKey] ?? false,
  );
  const setLibrarySectionOpen = useUIStore((s) => s.setLibrarySectionOpen);

  const groups = useMemo(() => {
    const result: Record<KnowledgeCategory, DiscoveredKnowledge[]> = {
      security: [],
      templates: [],
      general: [],
    };
    for (const k of knowledge) {
      result[k.category].push(k);
    }
    return result;
  }, [knowledge]);

  if (knowledge.length === 0) return null;

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
        <BookText className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
        <span className="text-xs font-medium text-neutral-300">Knowledge</span>
        <span className="text-[10px] text-neutral-500 ml-auto">{knowledge.length}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {ORDERED_CATEGORIES.map((cat) => {
            const items = groups[cat];
            if (items.length === 0) return null;
            const SubIcon = CATEGORY_ICON[cat];
            return (
              <div key={cat}>
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <SubIcon className="w-3 h-3 text-neutral-500 shrink-0" />
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                    {CATEGORY_LABEL[cat]}
                  </span>
                  <span className="text-[10px] text-neutral-600 ml-auto">
                    {items.length}
                  </span>
                </div>
                {items.map((entry) => (
                  <KnowledgeCard key={entry.relativePath} entry={entry} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
