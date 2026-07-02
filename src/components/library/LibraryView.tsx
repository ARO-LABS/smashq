import { useEffect, useCallback, useMemo } from "react";
import { BookOpen, RefreshCw, Globe, FolderOpen } from "lucide-react";
import { useSessionStore, selectEffectiveSession } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useConfigDiscoveryStore, hasScopeContent } from "../../store/configDiscoveryStore";
import { LibraryDetailModal } from "./LibraryDetailModal";
import { ScopePanel } from "./ScopePanel";

// ── Main View ────────────────────────────────────────────────────────

export function LibraryView(): JSX.Element {
  const activeSession = useSessionStore(selectEffectiveSession);
  const folder = activeSession?.folder ?? "";

  const globalConfig = useConfigDiscoveryStore((s) => s.globalConfig);
  const projectConfig = useConfigDiscoveryStore((s) => s.projectConfig);
  const favoriteConfigs = useConfigDiscoveryStore((s) => s.favoriteConfigs);
  const loading = useConfigDiscoveryStore((s) => s.loading);
  const discoverGlobal = useConfigDiscoveryStore((s) => s.discoverGlobal);
  const discoverProject = useConfigDiscoveryStore((s) => s.discoverProject);
  const discoverFavorites = useConfigDiscoveryStore((s) => s.discoverFavorites);

  const favorites = useSettingsStore((s) => s.favorites);

  // Favorite projects excluding the active session folder — derived once,
  // reused by the discovery effect, handleRefresh, and the render below.
  const favProjects = useMemo(
    () => favorites.filter((f) => f.path !== folder),
    [favorites, folder],
  );

  useEffect(() => {
    discoverGlobal();
  }, [discoverGlobal]);

  useEffect(() => {
    if (folder) {
      discoverProject(folder);
    }
  }, [folder, discoverProject]);

  // Discover configs for all favorite projects (excluding the active session folder)
  useEffect(() => {
    if (favProjects.length > 0) {
      discoverFavorites(favProjects.map((f) => f.path));
    }
  }, [favProjects, discoverFavorites]);

  // Project panels without any discovered config are hidden entirely;
  // the count feeds the footnote so hidden projects stay discoverable.
  // Only scanned configs count — a favorite whose scan is still pending
  // (no entry in favoriteConfigs yet) is neither shown nor counted.
  const hiddenCount =
    (projectConfig && folder && !hasScopeContent(projectConfig) ? 1 : 0) +
    favProjects.filter((f) => {
      const config = favoriteConfigs[f.path];
      return config !== undefined && !hasScopeContent(config);
    }).length;

  const handleRefresh = useCallback(() => {
    discoverGlobal();
    if (folder) {
      discoverProject(folder);
    }
    if (favProjects.length > 0) {
      discoverFavorites(favProjects.map((f) => f.path));
    }
  }, [discoverGlobal, discoverProject, discoverFavorites, folder, favProjects]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-surface-base shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          <h1 className="text-sm font-semibold text-neutral-200">
            Library
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className={`p-1 text-neutral-500 hover:text-neutral-300 transition-colors ${
              loading ? "animate-spin" : ""
            }`}
            title="Neu laden"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Detail modal — mounts here, reads state from store */}
      <LibraryDetailModal />

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {loading && !globalConfig && !projectConfig ? (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            Scanne Konfigurationen...
          </div>
        ) : (
          <>
            {/* Global scope */}
            {globalConfig && (
              <ScopePanel
                scope="global"
                config={globalConfig}
                label="Global (~/.claude/)"
                icon={Globe}
                scopeId="global"
                folder="global"
              />
            )}

            {/* Active session project scope */}
            {projectConfig && folder && hasScopeContent(projectConfig) && (
              <ScopePanel
                scope="project"
                config={projectConfig}
                label={`Projekt (${folder.split(/[\\/]/).pop() ?? folder})`}
                icon={FolderOpen}
                scopeId={`project:${folder}`}
                folder={folder}
              />
            )}

            {/* Favorite projects */}
            {favProjects
              .map((fav) => {
                const config = favoriteConfigs[fav.path];
                if (!config || !hasScopeContent(config)) return null;
                return (
                  <ScopePanel
                    key={fav.id}
                    scope="project"
                    config={config}
                    label={`${fav.label} (${fav.path.split(/[\\/]/).pop() ?? fav.path})`}
                    icon={FolderOpen}
                    scopeId={`fav:${fav.id}`}
                    folder={fav.path}
                  />
                );
              })}

            {hiddenCount > 0 && (
              <div className="text-xs text-neutral-600 px-1">
                {hiddenCount === 1
                  ? "1 Projekt ohne Konfiguration ausgeblendet"
                  : `${hiddenCount} Projekte ohne Konfiguration ausgeblendet`}
              </div>
            )}

            {!globalConfig && !projectConfig && Object.keys(favoriteConfigs).length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-neutral-500">
                <BookOpen className="w-10 h-10 text-neutral-600" />
                <span className="text-sm">Keine Konfigurationen gefunden</span>
                <span className="text-xs text-neutral-600">
                  ~/.claude/ oder .claude/ im Projekt
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
