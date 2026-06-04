import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { NotesPanel } from "../shared/NotesPanel";
import { useAutoUpdate, type UpdateStatus } from "../../hooks/useAutoUpdate";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { version } from "../../../package.json";
import { logError } from "../../utils/errorLogger";

interface DockLauncher {
  /** Detached-window view id passed to the Rust `open_detached_window` command. */
  view: string;
  label: string;
  icon: typeof ICONS.nav.kanban;
}

interface SessionPanelDockProps {
  /** Start a new session from the active defaults. */
  onNewSession: () => void;
  /** Open the folder picker to add a favorite. */
  onAddFavorite: () => void;
}

// Uniform icon-button grammar shared by every dock control (launchers + tools +
// actions) so the row reads as one designed set, not a loose pile.
const ICON_BTN =
  "relative flex items-center justify-center w-9 h-9 rounded-md text-neutral-400 " +
  "hover:text-accent hover:bg-accent-a05 transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

/**
 * Horizontal dock at the foot of the session panel. Replaces the old 56px
 * SideNav rail: the main window is always the Sessions view, so Kanban /
 * Bibliothek / Editor / Einstellungen (and optional Protokolle) become
 * detached-window launchers instead of in-window tab switches.
 *
 * Layout: a launcher row spread across the full width, a tools/actions row,
 * and a discreet right-aligned version pill — so nothing clusters left and the
 * version no longer reads as raw inline text.
 *
 * IMPORTANT (protected updater path): the version badge + handleVersionClick +
 * showInstallToast / showRestartToast + status-dot render + useAutoUpdate wiring
 * are migrated 1:1 from SideNav. The toast itself renders via the AppShell-level
 * ToastContainer, independent of this dock's visibility.
 */
export function SessionPanelDock({ onNewSession, onAddFavorite }: SessionPanelDockProps): JSX.Element {
  const addToast = useUIStore((s) => s.addToast);
  const updateToast = useUIStore((s) => s.updateToast);
  const removeToast = useUIStore((s) => s.removeToast);
  const mode = useSettingsStore((s) => s.theme.mode);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const showProtokolleTab = useSettingsStore((s) => s.preferences.showProtokolleTab);
  const { status, progress, newVersion, lastChecked, checkForUpdate, downloadAndInstall, confirmRelaunch } = useAutoUpdate();

  // Track previous status to fire toast exactly once per transition.
  const prevStatusRef = useRef<UpdateStatus>("idle");
  // Id of the live download-progress toast, so we can update its progress and
  // remove it when the download finishes/errors. null when no download is shown.
  const downloadToastIdRef = useRef<string | null>(null);
  // Track whether the last check was user-initiated — only THEN do we toast "Auf neuestem Stand".
  const userInitiatedRef = useRef(false);

  // Toast helpers — extracted to avoid duplicating payloads between useEffect and handleVersionClick.
  const showInstallToast = useCallback(
    (versionStr: string) => {
      addToast({
        type: "info",
        title: `Update v${versionStr} verfügbar`,
        message: "Klick auf Installieren startet den Download.",
        duration: 12000,
        action: {
          label: "Installieren",
          onClick: () => {
            downloadAndInstall().catch((err: unknown) =>
              logError("SessionPanelDock.downloadAndInstall", err),
            );
          },
        },
      });
    },
    [addToast, downloadAndInstall],
  );

  const showRestartToast = useCallback(() => {
    addToast({
      type: "success",
      title: "Update bereit",
      message: "App muss neu gestartet werden.",
      duration: 0, // sticky until user clicks action
      action: {
        label: "Neu starten",
        onClick: () => {
          confirmRelaunch().catch((err: unknown) =>
            logError("SessionPanelDock.confirmRelaunch", err),
          );
        },
      },
    });
  }, [addToast, confirmRelaunch]);

  // Toast on status transitions — fires for both manual click and auto-check.
  useEffect(() => {
    const prev = prevStatusRef.current;
    if (status === "available" && prev !== "available" && newVersion) {
      showInstallToast(newVersion);
    } else if (status === "downloading" && prev !== "downloading") {
      // Persistent progress toast — updated in place by the progress effect
      // below, removed when the download finishes (ready) or errors.
      downloadToastIdRef.current = addToast({
        type: "info",
        title: "Update wird geladen",
        message: newVersion ? `v${newVersion}` : undefined,
        progress: 0,
        duration: 0, // sticky until ready/error; user may still dismiss via ×
      });
    } else if (status === "ready" && prev !== "ready") {
      if (downloadToastIdRef.current) {
        removeToast(downloadToastIdRef.current);
        downloadToastIdRef.current = null;
      }
      showRestartToast();
    } else if (status === "error" && prev !== "error") {
      if (downloadToastIdRef.current) {
        removeToast(downloadToastIdRef.current);
        downloadToastIdRef.current = null;
      }
      addToast({
        type: "error",
        title: "Update-Check fehlgeschlagen",
        duration: 5000,
      });
    } else if (status === "upToDate" && prev === "checking" && userInitiatedRef.current) {
      // Only confirm "up to date" when user explicitly initiated — silent for auto-checks.
      addToast({
        type: "success",
        title: "Auf neuestem Stand",
        duration: 2500,
      });
    }
    // Clear the user-initiated flag once the check settles (any outcome), so a
    // later auto-check can never inherit a stale `true` and fire a stray toast.
    if (status !== "checking") {
      userInitiatedRef.current = false;
    }
    prevStatusRef.current = status;
  }, [status, newVersion, addToast, removeToast, showInstallToast, showRestartToast]);

  // Live download progress: update the persistent progress toast in place as
  // `progress` advances. Separate from the transition effect so it can fire on
  // every progress tick without re-running the once-per-transition logic.
  useEffect(() => {
    if (status === "downloading" && downloadToastIdRef.current !== null) {
      updateToast(downloadToastIdRef.current, { progress });
    }
  }, [progress, status, updateToast]);

  // State-aware version-click: idle→toast+check; available/ready→re-show actionable toast.
  function handleVersionClick() {
    if (status === "available" && newVersion) {
      showInstallToast(newVersion);
      return;
    }
    if (status === "ready") {
      showRestartToast();
      return;
    }
    // idle / checking / upToDate / error → trigger fresh check with immediate "Suche..."-Feedback.
    userInitiatedRef.current = true;
    addToast({
      type: "info",
      title: "Suche nach Updates...",
      duration: 1500,
    });
    checkForUpdate().catch((err: unknown) => logError("SessionPanelDock.checkForUpdate", err));
  }

  // Tooltip wording mirrors the click action so user sees what will happen.
  const versionTooltip =
    status === "available" && newVersion
      ? `Update v${newVersion} verfügbar — Klick: Installieren`
      : status === "ready"
        ? "Update bereit — Klick: Neu starten"
        : lastChecked
          ? `Version ${version} — Zuletzt geprüft: ${lastChecked.toLocaleTimeString("de-DE")} (Klick: nach Updates suchen)`
          : `Version ${version} (Klick: nach Updates suchen)`;

  const launchers: DockLauncher[] = [
    { view: "kanban", label: "Kanban", icon: ICONS.nav.kanban },
    { view: "library", label: "Bibliothek", icon: ICONS.nav.library },
    { view: "editor", label: "Editor", icon: ICONS.nav.editor },
  ];
  if (showProtokolleTab) {
    launchers.push({ view: "logs", label: "Protokolle", icon: ICONS.nav.logs });
  }

  function openWindow(view: string, title: string) {
    invoke("open_detached_window", { view, title }).catch((err: unknown) =>
      logError("SessionPanelDock.openDetachedWindow", err),
    );
  }

  const isDark = mode === "dark";
  const SunIcon = ICONS.theme.light;
  const MoonIcon = ICONS.theme.dark;
  const SettingsIcon = ICONS.nav.settings;
  const AddFavoriteIcon = ICONS.action.addFavorite;
  const NewSessionIcon = ICONS.action.newSession;
  const showStatusDot = status === "available" || status === "ready";

  return (
    <div className="shrink-0 border-t border-neutral-800 bg-surface-base px-3 py-2.5 flex flex-col gap-2">
      {/* Row 1 — window launchers · divider · session actions */}
      <div className="flex items-center gap-1">
        {launchers.map((l) => {
          const Icon = l.icon;
          return (
            <button
              key={l.view}
              onClick={() => openWindow(l.view, l.label)}
              className={ICON_BTN}
              aria-label={l.label}
              title={`${l.label} (eigenes Fenster)`}
            >
              <Icon className={ICON_SIZE.nav} aria-hidden="true" />
            </button>
          );
        })}

        <span className="w-px h-5 bg-neutral-700 mx-0.5" aria-hidden="true" />

        <button
          onClick={onAddFavorite}
          className={ICON_BTN}
          aria-label="Ordner als Favorit hinzufügen"
          title="Favorit hinzufügen"
        >
          <AddFavoriteIcon className={ICON_SIZE.nav} aria-hidden="true" />
        </button>
        <button
          onClick={onNewSession}
          className={ICON_BTN}
          aria-label="Neue Session starten"
          title="Session starten"
        >
          <NewSessionIcon className={ICON_SIZE.nav} aria-hidden="true" />
        </button>
      </div>

      {/* Row 2 — utilities (left) · version pill (right) */}
      <div className="flex items-center justify-between border-t border-neutral-800 pt-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTheme({ mode: isDark ? "light" : "dark" })}
            className={ICON_BTN}
            aria-label={isDark ? "Light Mode aktivieren" : "Dark Mode aktivieren"}
            title={isDark ? "Light Mode" : "Dark Mode"}
          >
            {isDark
              ? <SunIcon className={ICON_SIZE.nav} aria-hidden="true" />
              : <MoonIcon className={ICON_SIZE.nav} aria-hidden="true" />}
          </button>
          <NotesPanel variant="dock" />
          <button
            onClick={() => openWindow("settings", "Einstellungen")}
            className={ICON_BTN}
            aria-label="Einstellungen"
            title="Einstellungen (eigenes Fenster)"
          >
            <SettingsIcon className={ICON_SIZE.nav} aria-hidden="true" />
          </button>
        </div>

        {/* Version — discreet pill. Click = update-check; leading dot when an action is pending. */}
        <button
          onClick={handleVersionClick}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-surface-raised text-[10px] font-medium tracking-tight text-neutral-500 hover:text-accent transition-colors focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          title={versionTooltip}
        >
          {showStatusDot && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${status === "ready" ? "bg-success" : "bg-accent"}`}
              aria-label={status === "ready" ? "Update installationsbereit" : "Update verfügbar"}
            />
          )}
          <span>v{version}</span>
        </button>
      </div>
    </div>
  );
}
