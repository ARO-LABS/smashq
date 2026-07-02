/**
 * Icon Registry — zentrale Quelle fuer Icon-Zuordnung und Groessen.
 *
 * Warum zentral?
 * - Design-System-Regel (CLAUDE.md): "Lucide-Icons only, 2px stroke, currentColor."
 * - 24+ kanonische Icon-Zuordnungen aus `docs/design-system/README.md` werden
 *   hier als Code-Konstanten abgelegt, damit Rename/Swap ein Ein-Datei-Edit ist.
 * - Groessen-Standard wird ueber `ICON_SIZE` erzwungen — nicht-standard
 *   Icon-Groessen (z. B. `w-6 h-6`) sollen kein Pattern werden.
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
  // diff
  GitCompare,
  // toast
  CheckCircle2, AlertTriangle, Trophy, Info, CheckCircle,
  // update
  ArrowDownCircle, AlertCircle,
  // misc
  Pin, NotebookPen,
  // tasks
  ListChecks, Check, CalendarClock, Calendar, CalendarPlus, ArrowRight, Clock, Circle,
} from "lucide-react";

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
