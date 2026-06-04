import { lazy, Suspense } from "react";
import { FileText, Puzzle, Webhook, Settings, Bot, Github, GitBranch, Columns3, Clock } from "lucide-react";
import type { ConfigSubTab } from "../../store/uiStore";
import { isPinTab, getPinIdFromTab } from "../../store/uiStore";

export const ClaudeMdViewer = lazy(() => import("./ClaudeMdViewer").then(m => ({ default: m.ClaudeMdViewer })));
export const SkillsViewer = lazy(() => import("./SkillsViewer").then(m => ({ default: m.SkillsViewer })));
export const HooksViewer = lazy(() => import("./HooksViewer").then(m => ({ default: m.HooksViewer })));
export const SettingsViewer = lazy(() => import("./SettingsViewer").then(m => ({ default: m.SettingsViewer })));
export const AgentsViewer = lazy(() => import("./AgentsViewer").then(m => ({ default: m.AgentsViewer })));
export const GitHubViewer = lazy(() => import("./GitHubViewer").then(m => ({ default: m.GitHubViewer })));
export const WorktreeViewer = lazy(() => import("./WorktreeViewer").then(m => ({ default: m.WorktreeViewer })));
export const KanbanBoard = lazy(() => import("../kanban/KanbanBoard").then(m => ({ default: m.KanbanBoard })));
export const SessionHistoryViewer = lazy(() => import("./SessionHistoryViewer"));
export const PinnedDocViewer = lazy(() => import("./PinnedDocViewer").then(m => ({ default: m.PinnedDocViewer })));

export type TabGroup = "context" | "project" | "history";

export type PresenceKey =
  | "claudeMd"
  | "skills"
  | "agents"
  | "hooks"
  | "settings"
  | "git"
  | "github";

export interface ConfigTab {
  id: ConfigSubTab;
  label: string;
  icon: typeof FileText;
  group: TabGroup;
  /** If set, the tab is only shown when the folder contains the named artifact. */
  requiresPresence?: PresenceKey;
}

// eslint-disable-next-line react-refresh/only-export-components
export const CONFIG_TABS: ConfigTab[] = [
  { id: "claude-md", label: "CLAUDE.md", icon: FileText, group: "context", requiresPresence: "claudeMd" },
  { id: "skills",    label: "Skills",    icon: Puzzle,   group: "context", requiresPresence: "skills" },
  { id: "hooks",     label: "Hooks",     icon: Webhook,  group: "context", requiresPresence: "hooks" },
  { id: "settings",  label: "Settings",  icon: Settings, group: "context", requiresPresence: "settings" },
  { id: "agents",    label: "Agents",    icon: Bot,      group: "context", requiresPresence: "agents" },
  { id: "github",    label: "GitHub",    icon: Github,   group: "project", requiresPresence: "github" },
  { id: "worktrees", label: "Worktrees", icon: GitBranch, group: "project", requiresPresence: "git" },
  { id: "kanban",    label: "Kanban",    icon: Columns3, group: "project", requiresPresence: "github" },
  { id: "history",   label: "History",   icon: Clock,    group: "history" },
];

interface ConfigPanelContentProps {
  folder: string;
  activeTab: ConfigSubTab;
  onResumeSession?: (sessionId: string, cwd: string, title?: string) => void;
}

export function ConfigPanelContent({ folder, activeTab, onResumeSession }: ConfigPanelContentProps) {
  const pinId = isPinTab(activeTab) ? getPinIdFromTab(activeTab) : null;

  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center text-neutral-500 py-8">
          Laden...
        </div>
      }
    >
      {pinId !== null ? (
        <PinnedDocViewer folder={folder} pinId={pinId} />
      ) : activeTab === "claude-md" ? (
        <ClaudeMdViewer folder={folder} />
      ) : activeTab === "skills" ? (
        <SkillsViewer folder={folder} />
      ) : activeTab === "hooks" ? (
        <HooksViewer folder={folder} />
      ) : activeTab === "settings" ? (
        <SettingsViewer folder={folder} />
      ) : activeTab === "agents" ? (
        <AgentsViewer folder={folder} />
      ) : activeTab === "github" ? (
        <GitHubViewer folder={folder} />
      ) : activeTab === "worktrees" ? (
        <WorktreeViewer folder={folder} />
      ) : activeTab === "kanban" ? (
        <KanbanBoard folder={folder} />
      ) : activeTab === "history" ? (
        <SessionHistoryViewer folder={folder} onResumeSession={onResumeSession} />
      ) : null}
    </Suspense>
  );
}
