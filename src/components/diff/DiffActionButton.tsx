import { invoke } from "@tauri-apps/api/core";
import { ICONS, type IconSize, ICON_SIZE } from "../../utils/icons";
import { logError } from "../../utils/errorLogger";
import { useSessionStore } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";

interface DiffActionButtonProps {
  sessionId: string;
  /** Card-Variante: w-3.5 (default). Grid-Variante: w-3. */
  iconSize?: IconSize;
  /** Tailwind-Padding-Klasse — kompakter im Grid, fuller-bleed auf Cards. */
  padding?: "p-1" | "p-1.5";
  /** Source-Tag fuers logError-Channel (z.B. "SessionCard.openDiff"). */
  errorSource: string;
}

/**
 * Shared Diff-Button fuer Session-/Favorite-/Grid-Card-Action-Bars + Solo-
 * Toolbar.
 *
 * Sichtbarkeits- und Farb-Vertrag (Option 3 Reloaded, 2026-05-27):
 *   - Session ohne Git-Repo (isGitRepo !== true) → Komponente rendert `null`.
 *   - Session mit Git-Repo, hasDiff === true   → Icon in `text-accent`.
 *   - Session mit Git-Repo, hasDiff === false  → Icon in `text-neutral-500`
 *     (gedimmt, „clean").
 *   - hasDiff === undefined (noch nicht geprobt) → Icon in `text-neutral-700`
 *     (sehr dezent).
 *
 * onClick-Strategie minimiert IPC-Round-Trips:
 *   - hasDiff === true: direkt `open_session_diff_window` (1 IPC, instant feel,
 *     vertraut dem bestehenden Probe-State).
 *   - sonst: einmal `session_has_diff` refresh, Store updaten, dann handeln —
 *     bei `true` Window aufmachen, bei `false` Info-Toast.
 */
export function DiffActionButton({
  sessionId,
  iconSize = "card",
  padding = "p-1.5",
  errorSource,
}: DiffActionButtonProps) {
  const session = useSessionStore((s) =>
    s.sessions.find((sess) => sess.id === sessionId),
  );
  const setSessionHasDiff = useSessionStore((s) => s.setSessionHasDiff);
  const addToast = useUIStore((s) => s.addToast);
  const Icon = ICONS.action.diff;

  if (!session || session.isGitRepo !== true) {
    return null;
  }

  const colorClass =
    session.hasDiff === true
      ? "text-accent"
      : session.hasDiff === false
        ? "text-neutral-500"
        : "text-neutral-700";

  const openDiffWindow = (): void => {
    invoke("open_session_diff_window", { sessionId }).catch((err: unknown) =>
      logError(errorSource, err),
    );
  };

  const handleClick = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (session.hasDiff === true) {
      openDiffWindow();
      return;
    }
    try {
      const fresh = await invoke<boolean>("session_has_diff", { sessionId });
      setSessionHasDiff(sessionId, fresh);
      if (fresh) {
        openDiffWindow();
      } else {
        addToast({
          type: "info",
          title: "Diff leer",
          message: "Keine Aenderungen seit Session-Start.",
        });
      }
    } catch (err) {
      logError(errorSource, err);
    }
  };

  return (
    <button
      onClick={(e) => {
        void handleClick(e);
      }}
      className={`${padding} ${colorClass} hover:text-accent hover:bg-hover-overlay transition-colors`}
      aria-label="Diff anzeigen"
      title="Diff anzeigen"
    >
      <Icon className={ICON_SIZE[iconSize]} />
    </button>
  );
}
