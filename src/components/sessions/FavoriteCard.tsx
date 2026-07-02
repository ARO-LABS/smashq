import { useState } from "react";
import { Play, X, FolderOpen, Terminal } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { FavoriteFolder } from "../../store/settingsStore";
import { useUIStore } from "../../store/uiStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { logError } from "../../utils/errorLogger";
import { DiffActionButton } from "../diff/DiffActionButton";
import { accentColorFor, hashFolderToAccent, isAccentName, type AccentName } from "../../utils/sessionAccent";
import { SessionAccentMenu } from "./SessionAccentMenu";

/**
 * Returns the most recently created live session in this favorite's folder,
 * or null when no live session exists. Was previously `hasDiff===true`-filtered;
 * since 2026-05-27 the DiffActionButton itself encodes diff-state via icon
 * color and lazy-scan on click — the FavoriteCard no longer needs to guess
 * "which session would show a diff," it just hands off the newest live one.
 */
function useFavoriteLiveSessionId(path: string): string | null {
  return useSessionStore((s) => {
    const matches = s.sessions
      .filter((sess) => sess.folder === path)
      .sort((a, b) => b.createdAt - a.createdAt);
    return matches[0]?.id ?? null;
  });
}

/**
 * Aggregates live-session state for a favorite's folder so the card shows
 * a persistent status pill instead of hiding state behind hover.
 */
function useFavoriteSessionStats(path: string): { count: number; hasWaiting: boolean; hasLive: boolean } {
  return useSessionStore((s) => {
    const matches = s.sessions.filter((sess) => sess.folder === path);
    const liveStatuses = new Set(["starting", "running", "waiting"]);
    return {
      count: matches.length,
      hasWaiting: matches.some((sess) => sess.status === "waiting"),
      hasLive: matches.some((sess) => liveStatuses.has(sess.status)),
    };
  });
}

interface FavoriteCardProps {
  favorite: FavoriteFolder;
  onStart: () => void;
  onRemove: () => void;
}

export function FavoriteCard({ favorite, onStart, onRemove }: FavoriteCardProps) {
  const openPreview = useUIStore((s) => s.openPreview);
  const liveSessionId = useFavoriteLiveSessionId(favorite.path);
  const stats = useFavoriteSessionStats(favorite.path);

  // Per-project accent color, shared with the folder's session cards (#right-click-color).
  const folderAccents = useSettingsStore((s) => s.folderAccents);
  const setFolderAccent = useSettingsStore((s) => s.setFolderAccent);
  const clearFolderAccent = useSettingsStore((s) => s.clearFolderAccent);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const override = folderAccents[favorite.path];
  const currentAccent: AccentName = isAccentName(override) ? override : hashFolderToAccent(favorite.path);
  const hasOverride = favorite.path in folderAccents;
  const dotColor = accentColorFor(favorite.path, override ?? null);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="relative group flex items-center gap-2 h-7 pl-3 pr-2 cursor-pointer rounded-md hover:bg-hover-overlay transition-colors"
      onClick={() => openPreview(favorite.path)}
      onContextMenu={(e) => {
        e.preventDefault(); // natives WebView-Menü unterdrücken
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      title={favorite.path}
    >
      {/* Project color dot — pulses when the folder has a live session */}
      <span
        data-testid="fav-dot"
        className={`shrink-0 w-2 h-2 rounded-full ${stats.hasLive ? "animate-pulse" : ""}`}
        style={{ background: stats.hasWaiting ? "var(--color-warning)" : dotColor }}
        aria-hidden="true"
      />
      <span className="font-medium text-sm text-neutral-200 truncate flex-1">
        {favorite.label}
      </span>
      {/* Action cluster — display-toggle reserves NO width at rest (hidden =
          display:none), so the label spans the full row. On hover the cluster
          re-enters normal flow beside the truncating label — no overlap. */}
      <div
        data-actions
        className="hidden group-hover:flex items-center gap-0.5 shrink-0"
      >
        <button
          onClick={(e) => { e.stopPropagation(); onStart(); }}
          className="p-1 rounded text-success hover:text-accent hover:bg-hover-overlay transition-colors"
          aria-label="Session starten"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
        </button>
        {liveSessionId && (
          <DiffActionButton sessionId={liveSessionId} errorSource="FavoriteCard.openDiff" />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            invoke("open_folder_in_explorer", { path: favorite.path }).catch((err: unknown) =>
              logError("FavoriteCard.openFolder", err)
            );
          }}
          className="p-1 rounded text-neutral-400 hover:text-accent hover:bg-hover-overlay transition-colors"
          aria-label="Ordner im Explorer öffnen"
          title="Ordner im Explorer öffnen"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            invoke("open_terminal_in_folder", { path: favorite.path }).catch((err: unknown) =>
              logError("FavoriteCard.openTerminal", err)
            );
          }}
          className="p-1 rounded text-neutral-400 hover:text-accent hover:bg-hover-overlay transition-colors"
          aria-label="Terminal im Ordner öffnen"
          title="Terminal im Ordner öffnen"
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded text-neutral-500 hover:text-error hover:bg-hover-overlay transition-colors"
          aria-label="Favorit entfernen"
          title="Favorit entfernen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {menuPos && (
        <SessionAccentMenu
          x={menuPos.x}
          y={menuPos.y}
          current={currentAccent}
          hasOverride={hasOverride}
          onSelect={(name) => {
            setFolderAccent(favorite.path, name);
            setMenuPos(null);
          }}
          onReset={() => {
            clearFolderAccent(favorite.path);
            setMenuPos(null);
          }}
          onClose={() => setMenuPos(null)}
        />
      )}
    </motion.div>
  );
}
