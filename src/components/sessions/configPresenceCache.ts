import type { PresenceKey } from "./configPanelShared";

// Single source of truth: derive the presence map shape from PresenceKey so a
// new presence-gated tab forces a compile error at every producer until it
// supplies the new flag.
export type Presence = Record<PresenceKey, boolean>;

/**
 * Modul-Cache: letzter bekannter Presence-Stand pro Projekt-Key.
 * Ein Remount des Config-Panels (Zuklappen unmountet es) startet damit
 * sofort mit dem letzten Stand statt „alle Tabs anzeigen und dann
 * sichtbar schrumpfen" — der Refresh läuft still im Hintergrund und
 * aktualisiert nur bei realer Änderung.
 */
const cache = new Map<string, Presence>();

export function getCachedPresence(key: string): Presence | null {
  return cache.get(key) ?? null;
}

export function setCachedPresence(key: string, presence: Presence): void {
  cache.set(key, presence);
}

/**
 * Flacher Vergleich über alle Presence-Flags — erlaubt es dem Aufrufer,
 * ein No-op-`setPresence` (und damit einen sinnlosen Re-Render bei jedem
 * erneuten Öffnen) zu vermeiden, wenn der Refresh nichts geändert hat.
 */
export function presenceEquals(a: Presence | null, b: Presence): boolean {
  if (a === null) return false;
  return (Object.keys(b) as PresenceKey[]).every((k) => a[k] === b[k]);
}

/** Nur für Tests: Cache leeren, damit Testfälle isoliert bleiben. */
export function clearPresenceCacheForTests(): void {
  cache.clear();
}
