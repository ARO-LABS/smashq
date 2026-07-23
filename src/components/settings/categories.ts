import type { ComponentType, LazyExoticComponent } from "react";
import { lazy } from "react";
import { ICONS, type LucideIcon } from "../../utils/icons";

const Palette = ICONS.category.theme;
const Monitor = ICONS.nav.sessions;
const Bell = ICONS.category.notify;
const Cpu = ICONS.viewer.system;
const InfoIcon = ICONS.toast.info;

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
 *
 * Tab-Konsolidierung (Issue #52): the former "terminal" tab lives on as the
 * Terminal-Verlauf section inside "sessions"; the former "advanced" tab as the
 * Debug-Logging section inside "system". PreferencesView resolves unknown ids
 * (e.g. the removed ones) to the first category.
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
    Panel: lazy(() => import("./panels/SessionsPanel").then((m) => ({ default: m.SessionsPanel }))),
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
    id: "about",
    label: "Über",
    icon: InfoIcon,
    Panel: lazy(() => import("./panels/AboutPanel").then((m) => ({ default: m.AboutPanel }))),
  },
] as const;
