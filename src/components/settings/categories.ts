import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";
import { ICONS, type LucideIcon } from "../../utils/icons";

const Palette = ICONS.category.theme;
const Monitor = ICONS.nav.sessions;
const TerminalIcon = ICONS.action.terminal;
const Bell = ICONS.category.notify;
const Bug = ICONS.category.debug;
const Cpu = ICONS.viewer.system;

export interface SettingsCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  Panel: LazyExoticComponent<ComponentType>;
}

/**
 * Single-source schema for the categorized Settings view (Concept B Phase 6).
 * Order here = order in CategoryNav. New categories: add a new entry; existing
 * panels are imported via lazy() so the settings bundle stays split per panel.
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    id: "appearance",
    label: "Darstellung",
    icon: Palette,
    Panel: lazy(() => import("./panels/ThemePanel").then((m) => ({ default: m.ThemePanel }))),
  },
  {
    id: "sessions",
    label: "Sessions",
    icon: Monitor,
    Panel: lazy(() => import("./NewSessionDefaultsPanel").then((m) => ({ default: m.NewSessionDefaultsPanel }))),
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: TerminalIcon,
    Panel: lazy(() => import("./TerminalScrollbackPanel").then((m) => ({ default: m.TerminalScrollbackPanel }))),
  },
  {
    id: "notifications",
    label: "Benachrichtigungen",
    icon: Bell,
    Panel: lazy(() => import("./panels/NotificationsPanel").then((m) => ({ default: m.NotificationsPanel }))),
  },
  {
    id: "system",
    label: "System",
    icon: Cpu,
    Panel: lazy(() => import("./panels/SystemPanel").then((m) => ({ default: m.SystemPanel }))),
  },
  {
    id: "advanced",
    label: "Erweitert",
    icon: Bug,
    Panel: lazy(() => import("./DebugLoggingPanel").then((m) => ({ default: m.DebugLoggingPanel }))),
  },
] as const;
