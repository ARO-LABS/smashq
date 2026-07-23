import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { ICONS } from "../../utils/icons";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useUIStore, type ConfigSubTab } from "../../store/uiStore";
import { useSettingsStore, normalizeProjectKey } from "../../store/settingsStore";
import { logError } from "../../utils/errorLogger";
import { CONFIG_TABS } from "./configPanelShared";
import {
  getCachedPresence,
  setCachedPresence,
  presenceEquals,
  type Presence,
} from "./configPresenceCache";
import { useTasksStore, selectOpenTaskCountForProject } from "../../store/tasksStore";

const X = ICONS.action.close;
const Plus = ICONS.action.newSession;
const Pin = ICONS.pin;

interface ConfigPanelTabListProps {
  folder: string;
  /** Tab size variant — ConfigPanel uses "md", FavoritePreview uses "sm" */
  size?: "sm" | "md";
  /**
   * Whether this instance owns the canonical tab state.
   * Only the primary instance is allowed to auto-switch the global
   * `configSubTab` when its current value isn't visible for the folder.
   * Non-primary instances (e.g. FavoritePreview) must not mutate the
   * shared store on mount — otherwise they hijack the main panel's tab.
   */
  isPrimary?: boolean;
}

/**
 * Renders the tab buttons (fixed tabs + user pins + add-pin button) shared
 * between ConfigPanel (split-view) and FavoritePreview (favorite preview).
 *
 * Uses `uiStore.configSubTab` so tab selection stays consistent across views.
 * File-picking, pin add/remove and toasts are handled here.
 */
export function ConfigPanelTabList({ folder, size = "md", isPrimary = true }: ConfigPanelTabListProps) {
  const configSubTab = useUIStore((s) => s.configSubTab);
  const setConfigSubTabRaw = useUIStore((s) => s.setConfigSubTab);
  const addToast = useUIStore((s) => s.addToast);
  const hasDirtyEditor = useUIStore((s) => s.hasDirtyEditor);

  /** Tab-switch with unsaved-changes guard. */
  const setConfigSubTab = (newTab: ConfigSubTab) => {
    if (hasDirtyEditor && newTab !== configSubTab) {
      const ok = window.confirm(
        "Ungespeicherte Änderungen gehen verloren. Wirklich wechseln?"
      );
      if (!ok) return;
    }
    setConfigSubTabRaw(newTab);
  };

  const pins = useSettingsStore(
    (s) => s.pinnedDocs[normalizeProjectKey(folder)] ?? []
  );
  const addPinnedDoc = useSettingsStore((s) => s.addPinnedDoc);
  const removePinnedDoc = useSettingsStore((s) => s.removePinnedDoc);
  const renamePinnedDoc = useSettingsStore((s) => s.renamePinnedDoc);

  // Inline-Edit state for pin labels
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus + select when edit mode starts
  useEffect(() => {
    if (editingPinId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingPinId]);

  const startRename = (pinId: string, currentLabel: string) => {
    setEditingPinId(pinId);
    setEditValue(currentLabel);
  };

  const commitRename = () => {
    if (!editingPinId) return;
    const trimmed = editValue.trim();
    if (trimmed) {
      renamePinnedDoc(folder, editingPinId, trimmed);
    }
    setEditingPinId(null);
    setEditValue("");
  };

  const cancelRename = () => {
    setEditingPinId(null);
    setEditValue("");
  };

  // ── Presence detection ─────────────────────────────────────────────────
  // Check which context artifacts exist in the folder so we can hide empty tabs.
  // Das Panel wird beim Zuklappen unmountet — deshalb startet jeder Mount aus
  // dem Modul-Cache (letzter bekannter Stand pro Projekt) und refresht still im
  // Hintergrund: nur eine echte Änderung löst einen Re-Render aus. Erst-Öffnen
  // eines Ordners (Cache leer, presence === null) zeigt weiterhin alle Tabs,
  // bis die Erkennung auflöst — das kleinere Übel gegenüber leerer Leiste.
  const [presence, setPresence] = useState<Presence | null>(() =>
    getCachedPresence(normalizeProjectKey(folder))
  );

  useEffect(() => {
    let cancelled = false;
    const projectKey = normalizeProjectKey(folder);
    // Re-Seed bei Ordnerwechsel: der useState-Initializer läuft nur beim Mount,
    // also hier sofort auf den Cache-Stand (oder null) des NEUEN Ordners
    // umschalten — nie die Tab-Leiste des vorherigen Ordners stehen lassen.
    setPresence(getCachedPresence(projectKey));
    if (!folder) return;

    (async () => {
      // Resolve to the main working tree root — worktree sessions may point to a
      // branch-specific path that lacks the context artifacts (CLAUDE.md, .claude/...).
      // Mirrors the resolution done in ClaudeMdViewer.load/save.
      const resolvedFolder = await invoke<string>("resolve_project_root", { folder }).catch(() => folder);
      if (cancelled) return;

      const [claudeMdText, skillDirs, agentFiles, settingsText, projectPresence] = await Promise.all([
        invoke<string>("read_project_file", { folder: resolvedFolder, relativePath: "CLAUDE.md" }).catch(() => ""),
        invoke<unknown[]>("list_skill_dirs", { folder: resolvedFolder }).catch(() => [] as unknown[]),
        invoke<string[]>("list_project_dir", { folder: resolvedFolder, relativePath: ".claude/agents" })
          .then((files) => files.filter((f) => f.endsWith(".md")))
          .catch(() => [] as string[]),
        invoke<string>("read_project_file", { folder: resolvedFolder, relativePath: ".claude/settings.json" }).catch(() => ""),
        invoke<{ has_git: boolean; has_github: boolean; remote_url: string | null }>(
          "check_project_presence", { folder: resolvedFolder }
        ).catch(() => ({ has_git: false, has_github: false, remote_url: null })),
      ]);

      if (cancelled) return;

      let hasHooks = false;
      try {
        const parsed = JSON.parse(settingsText || "{}") as Record<string, unknown>;
        const hooksObj = parsed?.hooks;
        hasHooks = !!hooksObj && typeof hooksObj === "object" && Object.keys(hooksObj).length > 0;
      } catch { /* not valid JSON — no hooks */ }

      const next: Presence = {
        claudeMd: !!claudeMdText,
        skills: (skillDirs as unknown[]).length > 0,
        agents: agentFiles.length > 0,
        hooks: hasHooks,
        settings: !!settingsText,
        git: projectPresence.has_git,
        github: projectPresence.has_github,
      };
      setCachedPresence(projectKey, next);
      // Gleiche Referenz zurückgeben, wenn nichts geändert hat — React bailt
      // dann aus dem Re-Render aus (kein sichtbares Zucken bei jedem Öffnen).
      setPresence((prev) => (presenceEquals(prev, next) ? prev : next));
    })();

    return () => { cancelled = true; };
  }, [folder]);

  const visibleTabs = useMemo(() => CONFIG_TABS.filter((tab) => {
    if (!tab.requiresPresence) return true;
    if (presence === null) return true; // loading — show all to avoid flash
    return presence[tab.requiresPresence];
  }), [presence]);

  // Auto-switch away from a now-hidden tab when session folder changes.
  // Gated on isPrimary so a non-primary instance (FavoritePreview) cannot
  // hijack the main panel's tab via the shared uiStore.
  useEffect(() => {
    if (!isPrimary) return;
    if (presence === null) return;
    const isActiveVisible = visibleTabs.some((t) => t.id === configSubTab);
    const isPinned = configSubTab.startsWith("pin:");
    if (!isActiveVisible && !isPinned) {
      setConfigSubTabRaw(visibleTabs[0]?.id ?? "github");
    }
  }, [isPrimary, presence, visibleTabs, configSubTab, setConfigSubTabRaw]);

  const buttonPadding = size === "sm" ? "px-2.5 py-1" : "px-2 py-1";
  const iconSize = "w-3 h-3";
  const textSize = "text-[11px]";

  const handleAddPin = async () => {
    try {
      const filePath = await open({
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
        multiple: false,
        defaultPath: folder,
        title: "Markdown-Datei zum Anpinnen auswählen",
      });
      if (!filePath || typeof filePath !== "string") return;

      // Derive relativePath by stripping folder prefix
      const normalizedFile = filePath.replace(/\\/g, "/");
      const normalizedFolder = folder.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!normalizedFile.toLowerCase().startsWith(normalizedFolder.toLowerCase() + "/")) {
        addToast({
          type: "error",
          title: "Datei außerhalb des Projekts",
          message: "Nur Dateien innerhalb des Projektordners können angepinnt werden.",
        });
        return;
      }
      const relativePath = normalizedFile.slice(normalizedFolder.length + 1);

      const err = addPinnedDoc(folder, relativePath);
      if (err) {
        addToast({ type: "error", title: "Pin fehlgeschlagen", message: err });
        return;
      }

      // Activate the newly created pin
      const updated = useSettingsStore.getState().pinnedDocs?.[normalizeProjectKey(folder)] ?? [];
      const newPin = updated.find((p) => p.relativePath === relativePath.replace(/\\/g, "/"));
      if (newPin) {
        setConfigSubTab(`pin:${newPin.id}`);
      }
      addToast({ type: "success", title: "Angepinnt", message: relativePath });
    } catch (e) {
      logError("ConfigPanelTabList.handleAddPin", e);
      addToast({ type: "error", title: "Pin fehlgeschlagen", message: String(e) });
    }
  };

  const handleRemovePin = (pinId: string, label: string) => {
    removePinnedDoc(folder, pinId);
    // If the removed pin was active, switch to the first visible tab.
    // Use raw setter to bypass dirty-guard (user removed the pin intentionally).
    if (configSubTab === `pin:${pinId}`) {
      setConfigSubTabRaw(visibleTabs[0]?.id ?? "github");
    }
    addToast({ type: "info", title: "Pin entfernt", message: label });
  };

  return (
    <>
      {visibleTabs.map((tab, idx) => {
        const Icon = tab.icon;
        const isActive = configSubTab === tab.id;
        const prevGroup = idx > 0 ? visibleTabs[idx - 1].group : null;
        const showSeparator = prevGroup !== null && prevGroup !== tab.group;
        return (
          <Fragment key={tab.id}>
            {showSeparator && (
              <div className="w-px h-4 bg-neutral-700 shrink-0 mx-0.5" />
            )}
            <button
              onClick={() => setConfigSubTab(tab.id)}
              className={`flex items-center gap-1 ${buttonPadding} ${textSize} font-medium rounded-sm whitespace-nowrap transition-colors ${
                isActive
                  ? "text-accent bg-accent-a30"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
              }`}
              title={tab.label}
            >
              <Icon className={`${iconSize} shrink-0`} />
              {tab.label}
              {tab.id === "tasks" && <TasksTabBadge folder={folder} />}
            </button>
          </Fragment>
        );
      })}

      {/* User-pinned docs */}
      {pins.length > 0 && (
        <div className="w-px h-4 bg-neutral-700 shrink-0 mx-0.5" />
      )}
      {pins.map((pin) => {
        const tabId: ConfigSubTab = `pin:${pin.id}`;
        const isActive = configSubTab === tabId;
        const isEditing = editingPinId === pin.id;
        return (
          <div
            key={pin.id}
            className={`group flex items-center gap-0.5 rounded-sm whitespace-nowrap transition-colors ${
              isActive
                ? "text-accent bg-accent-a30"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-hover-overlay"
            }`}
          >
            {isEditing ? (
              <div className={`flex items-center gap-1 pl-2 py-1 ${textSize}`}>
                <Pin className={`${iconSize} shrink-0`} />
                <input
                  ref={editInputRef}
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  className={`${textSize} font-medium bg-transparent border border-accent rounded-sm px-1 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 min-w-[60px] max-w-[200px]`}
                  maxLength={64}
                  aria-label="Pin-Label bearbeiten"
                />
              </div>
            ) : (
              <button
                onClick={() => setConfigSubTab(tabId)}
                onDoubleClick={() => startRename(pin.id, pin.label)}
                className={`flex items-center gap-1 pl-2 py-1 ${textSize} font-medium`}
                title={`${pin.relativePath}\n(Doppelklick zum Umbenennen)`}
              >
                <Pin className={`${iconSize} shrink-0`} />
                {pin.label}
              </button>
            )}
            {!isEditing && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemovePin(pin.id, pin.label);
                }}
                className="p-0.5 pr-1.5 text-neutral-500 hover:text-error opacity-0 group-hover:opacity-100 transition-opacity"
                title="Pin entfernen"
                aria-label={`Pin ${pin.label} entfernen`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        );
      })}

      {/* Add pin button */}
      <button
        onClick={handleAddPin}
        className={`flex items-center gap-1 px-1.5 py-1 ${textSize} rounded-sm whitespace-nowrap text-neutral-500 hover:text-accent hover:bg-accent-a10 transition-colors`}
        title="Markdown-Datei anpinnen"
        aria-label="Markdown-Datei anpinnen"
      >
        <Plus className={iconSize} />
      </button>
    </>
  );
}

function TasksTabBadge({ folder }: { folder: string }) {
  const key = normalizeProjectKey(folder);
  const openCount = useTasksStore((s) => selectOpenTaskCountForProject(key)(s));
  if (openCount === 0) return null;
  return (
    <span
      data-testid="tasks-tab-badge"
      aria-label={`${openCount} offene Aufgabe${openCount === 1 ? "" : "n"}`}
      className="ml-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-accent text-surface-base text-[9px] font-bold font-mono inline-flex items-center justify-center"
    >
      {openCount > 9 ? "9+" : openCount}
    </span>
  );
}
