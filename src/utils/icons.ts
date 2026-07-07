/**
 * Icon Registry — zentrale Quelle fuer Icon-Zuordnung und Groessen.
 *
 * Warum zentral?
 * - Design-System-Regel (CLAUDE.md): "Lucide-Icons only, 2px stroke, currentColor."
 * - Kanonische Icon-Zuordnungen aus `docs/design-system/README.md` werden hier
 *   als Code-Konstanten abgelegt, damit Rename/Swap ein Ein-Datei-Edit ist.
 * - Groessen-Standard wird ueber `ICON_SIZE` angeboten — freie `w-6 h-6`-Klassen
 *   sollen kein Pattern werden.
 * - Direkter `lucide-react`-Import ist ausserhalb dieser Datei per ESLint verboten
 *   (`no-restricted-imports`). Neue Icons hier ergaenzen.
 *
 * Verwendung:
 * ```tsx
 * import { ICONS, ICON_SIZE } from "@/utils/icons";
 * const Close = ICONS.action.close;
 * <Close className={ICON_SIZE.nav} aria-hidden="true" />
 * ```
 *
 * Lucide setzt `strokeWidth={2}` bereits als Default — explizit nur setzen,
 * wenn abweichend.
 */

import {
  // nav
  Monitor, Columns3, BookOpen, FileEdit, ScrollText, Settings,
  // theme
  Sun, Moon,
  // actions
  X, FolderOpen, Terminal, ExternalLink, LayoutGrid, ChevronDown, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, RotateCcw, Download, Trash2, ArrowDownToLine, Search, Move, FolderPlus, Plus,
  Copy, Eye, EyeOff, Pencil, Save, Play, Maximize2, LayoutList, PanelRightOpen, PanelRightClose,
  // diff
  GitCompare,
  // toast
  CheckCircle2, AlertTriangle, Trophy, Info, CheckCircle,
  // update
  ArrowDownCircle, AlertCircle,
  // library (Typ-/Scope-Kodierung)
  Bot, Brain, Webhook, Scroll, Zap, BookText, Puzzle, Globe,
  // git / issues
  GitBranch, GitCommit, GitPullRequest, Github, CircleDot, MessageSquare, Milestone, Tag, User, XCircle,
  // files
  FileText, FileCode,
  // config viewers
  Code2, Cpu, Server, Shield, ShieldOff,
  // settings categories
  Bell, Bug, Palette,
  // misc
  Pin, NotebookPen,
  // tasks
  ListChecks, Check, CalendarClock, Calendar, CalendarPlus, ArrowRight, Clock, Circle,
} from "lucide-react";

/** Re-export the Lucide component type so consumers never import lucide directly. */
export type { LucideIcon } from "lucide-react";

/**
 * Kanonische Icon-Zuordnung — gruppiert nach semantischer Rolle.
 *
 * Neue Icons: hier hinzufuegen statt direkt aus `lucide-react` importieren.
 */
export const ICONS = {
  nav: {
    sessions: Monitor,
    kanban: Columns3,
    library: BookOpen,
    editor: FileEdit,
    logs: ScrollText,
    settings: Settings,
  },
  theme: {
    light: Sun,
    dark: Moon,
  },
  action: {
    close: X,
    folderOpen: FolderOpen,
    terminal: Terminal,
    externalLink: ExternalLink,
    detach: LayoutGrid,
    collapse: ChevronDown,
    chevronLeft: ChevronLeft,
    chevronRight: ChevronRight,
    addFavorite: FolderPlus,
    newSession: Plus,
    /** Lucide `Move` = 4-direction arrow cross. Used for window drag-handles. */
    move: Move,
    loading: Loader2,
    refresh: RefreshCw,
    retry: RotateCcw,
    download: Download,
    trash: Trash2,
    scrollToBottom: ArrowDownToLine,
    search: Search,
    /** Lucide `GitCompare` = side-by-side diff icon. Used for the Session-Diff button. */
    diff: GitCompare,
    copy: Copy,
    /** Preview-toggle (Editor/Doc viewers). */
    preview: Eye,
    previewOff: EyeOff,
    edit: Pencil,
    save: Save,
    run: Play,
    maximize: Maximize2,
    listView: LayoutList,
    panelOpen: PanelRightOpen,
    panelClose: PanelRightClose,
  },
  toast: {
    success: CheckCircle2,
    error: AlertTriangle,
    achievement: Trophy,
    info: Info,
    ready: CheckCircle,
  },
  update: {
    available: ArrowDownCircle,
    error: AlertCircle,
  },
  /** Library entry-type + scope glyphs. */
  library: {
    agent: Bot,
    skill: Brain,
    hook: Webhook,
    rule: Scroll,
    command: Zap,
    knowledge: BookText,
    plugin: Puzzle,
    scopeGlobal: Globe,
  },
  /** Git / GitHub-issue glyphs (Kanban detail, GitHub viewer, history). */
  git: {
    branch: GitBranch,
    commit: GitCommit,
    pr: GitPullRequest,
    github: Github,
    issueOpen: CircleDot,
    comment: MessageSquare,
    milestone: Milestone,
    tag: Tag,
    user: User,
    checkFailed: XCircle,
  },
  /** Generic file glyphs (knowledge/doc viewers, scope panel). */
  file: {
    text: FileText,
    code: FileCode,
  },
  /** Config-viewer glyphs (settings sources, permissions, system). */
  viewer: {
    code: Code2,
    system: Cpu,
    server: Server,
    permissions: Shield,
    permissionsOff: ShieldOff,
  },
  /** Settings-category glyphs (categories.ts). */
  category: {
    notify: Bell,
    debug: Bug,
    theme: Palette,
  },
  pin: Pin,
  /** Notebook with pen — the Notes side-panel toggle. */
  notes: NotebookPen,
  /** Inline "+ Neue Gruppe" button (FavoritesList footer). */
  groupCreate: Plus,
  groupCollapse: ChevronDown,
  /** Tasks feature — dock launcher, status dots, deadline chips, actions. */
  tasks: {
    /** Dock launcher + terminal-toolbar icon + window header. */
    panel: ListChecks,
    /** Erledigt action + done dot + subtask done. */
    check: Check,
    /** Open status dot (rendered as hollow ring). */
    open: Circle,
    /** Deadline chip + Deadline field value. */
    deadline: CalendarClock,
    /** Date display / editor header. */
    calendar: Calendar,
    /** "In Kalender" .ics export. */
    calendarAdd: CalendarPlus,
    /** Wieder öffnen. */
    reopen: RotateCcw,
    /** "nächste" marker + "In großer Ansicht öffnen". */
    next: ArrowRight,
    /** Relative-deadline glyph inside chip. */
    clock: Clock,
  },
} as const;

/**
 * Icon-Size-Standard (Tailwind-Klassen).
 *
 * Verwendung statt freier `w-X h-X`-Klassen:
 * - `inline` (12px) — inline nav badges, chevrons, status dots
 * - `card`   (14px) — session card buttons, toolbar buttons
 * - `nav`    (16px) — side nav, panel headers (Standard)
 * - `close`  (20px) — toast icon, modal close button
 */
export const ICON_SIZE = {
  inline: "w-3 h-3",
  card: "w-3.5 h-3.5",
  nav: "w-4 h-4",
  close: "w-5 h-5",
} as const;

export type IconSize = keyof typeof ICON_SIZE;
