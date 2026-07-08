import React, { useState, useRef, useEffect, useCallback } from "react";
import { ICONS } from "../../utils/icons";
import { invoke } from "@tauri-apps/api/core";
import { DiffActionButton } from "../diff/DiffActionButton";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import type { ClaudeSession } from "../../store/sessionStore";
import { logError } from "../../utils/errorLogger";
import { folderLabel } from "../../utils/pathUtils";
import { resolveSessionAccent, accentCssVars, accentColorFor, type AccentName } from "../../utils/sessionAccent";
import { getGridMiniMap } from "./sessionGridLayout";
import { SessionAccentMenu } from "./SessionAccentMenu";

const X = ICONS.action.close;
const FolderOpen = ICONS.action.folderOpen;
const Terminal = ICONS.action.terminal;

interface SessionCardProps {
  session: ClaudeSession;
  isActive: boolean;
  /**
   * Grid-Slot dieser Session, falls im Grid: `index` = Position in
   * `gridSessionIds`, `count` = Anzahl der Grid-Sessions. Steuert die
   * positions-aware Mini-Map. Undefined = nicht im Grid.
   */
  gridSlot?: { index: number; count: number };
  onClick: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}


const SessionCardInner = ({ session, isActive, gridSlot, onClick, onClose }: SessionCardProps) => {
  const renameSession = useSessionStore((s) => s.renameSession);

  const sessionAccents = useSettingsStore((s) => s.sessionAccents);
  const folderAccents = useSettingsStore((s) => s.folderAccents);
  const setFolderAccent = useSettingsStore((s) => s.setFolderAccent);
  const clearFolderAccent = useSettingsStore((s) => s.clearFolderAccent);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const accent: AccentName = resolveSessionAccent(session, sessionAccents, folderAccents);
  // Color is now keyed by folder path (shared "project color") — always present,
  // unlike claudeSessionId which is undefined pre-discovery.
  const folder = session.folder ?? "";
  const hasOverride = folder in folderAccents;
  const dotColor = accentColorFor(folder, accent);
  const projectName = folderLabel(session.folder);

  // Position-aware grid indicator: a 12px mini-map mirroring the real grid
  // template (2 = halves, 3 = T-shape, 4 = quadrants). null when not in grid.
  const miniMap = gridSlot ? getGridMiniMap(gridSlot.index, gridSlot.count) : null;

  // Dot encodes session health on top of project identity:
  // error/waiting override the color; running pulses; done dims; else plain project color.
  const dotBackground =
    session.status === "error"
      ? "var(--color-error)"
      : session.status === "waiting"
        ? "var(--color-warning)"
        : dotColor;
  const dotStateClass =
    session.status === "running" || session.status === "starting"
      ? "animate-pulse"
      : session.status === "done"
        ? "opacity-40"
        : "";

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  // displayId exists only for internal title-collision uniqueness and is never
  // shown to the user, so inline-edit pre-fills the plain title.
  const displayString = session.title;

  const startRename = useCallback(() => {
    setIsEditing(true);
    setEditValue(displayString);
  }, [displayString]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    // Compare against the plain title so a no-op edit (open + save unchanged)
    // does not trigger a rename.
    if (trimmed && trimmed !== displayString) {
      renameSession(session.id, trimmed);
      // Record the rename under the stable internal id so the intent survives
      // even when the Claude UUID isn't known yet. If it IS known, flush now so
      // the History override updates synchronously (fast path); otherwise the
      // discovery/restore seam flushes it once the UUID resolves.
      const settings = useSettingsStore.getState();
      settings.setPendingTitleOverride(session.id, trimmed);
      if (session.claudeSessionId) {
        settings.flushPendingTitleOverride(session.id, session.claudeSessionId);
      }
    }
    setIsEditing(false);
    setEditValue("");
  }, [editValue, session.id, session.claudeSessionId, displayString, renameSession]);

  const cancelRename = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
  }, []);

  return (
    <div
      onClick={() => onClick(session.id)}
      onContextMenu={(e) => {
        e.preventDefault(); // natives WebView-Menü auf allen Karten unterdrücken
        // Folder path is always present → menu always opens (fixes the
        // "only the active session reacts" bug where claudeSessionId was missing).
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      style={accentCssVars(accent)}
      className={`
        relative group flex items-center gap-2 h-7 pl-3 pr-2 cursor-pointer rounded-md transition-colors
        ${isActive ? "bg-accent-a10" : "hover:bg-hover-overlay"}
      `}
    >
      <span
        data-testid="sess-dot"
        className={`shrink-0 w-2 h-2 rounded-full ${dotStateClass}`}
        style={{ background: dotBackground }}
        aria-hidden="true"
      />
      {isEditing ? (
        <input
          ref={editInputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") cancelRename();
          }}
          onClick={(e) => e.stopPropagation()}
          className="font-medium text-sm text-neutral-200 bg-neutral-800 border border-neutral-600 rounded-sm px-1 py-0 flex-1 min-w-0 outline-none focus:border-accent"
          aria-label="Session umbenennen"
        />
      ) : (
        <span
          className="font-medium text-sm text-neutral-200 truncate flex-1 min-w-0"
          onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
          title="Doppelklick zum Umbenennen"
        >
          {session.title}
        </span>
      )}
      {/*
        Dynamic right region — no fixed reserve. At rest the project name shows
        (narrow) so the flex-1 title keeps maximum width. On hover it is swapped
        for the action chrome below. Because the chrome is IN the flex flow (not
        absolute), the wider hover state makes flexbox shrink the title, which
        then truncates with an ellipsis — the collision is impossible by
        construction and no magic-number reserve width is hard-coded. `mr-4`
        clears the bottom-right grid mini-map at rest. `max-w-[96px]` only caps a
        very long project name; it never reserves space against the title.
      */}
      <span
        className={`shrink-0 max-w-[96px] text-[11px] text-neutral-500 font-mono truncate group-hover:hidden ${
          miniMap ? "mr-4" : ""
        }`}
      >
        {projectName}
      </span>

      {/* Hover action chrome — in-flow (not absolute) so the title yields to it */}
      <div className="shrink-0 hidden group-hover:flex items-center gap-0.5">
        <DiffActionButton sessionId={session.id} errorSource="SessionCard.openDiff" />
        <button
          onClick={(e) => {
            e.stopPropagation();
            invoke("open_folder_in_explorer", { path: session.folder }).catch((err: unknown) =>
              logError("SessionCard.openFolder", err)
            );
          }}
          className="p-1 text-neutral-400 hover:text-accent hover:bg-hover-overlay transition-colors"
          aria-label="Ordner im Explorer öffnen"
          title="Ordner im Explorer öffnen"
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            invoke("open_terminal_in_folder", { path: session.folder }).catch((err: unknown) =>
              logError("SessionCard.openTerminal", err)
            );
          }}
          className="p-1 text-neutral-400 hover:text-accent hover:bg-hover-overlay transition-colors"
          aria-label="Terminal im Ordner öffnen"
          title="Terminal im Ordner öffnen"
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose(session.id);
          }}
          className="p-1 text-neutral-500 hover:text-error hover:bg-hover-overlay transition-colors"
          aria-label="Session schließen"
          title="Session schließen"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/*
        Grid-Indicator: 12px mini-map vertically centered at the right edge
        (right-1 top-1/2), mirroring the real grid template so it shows WHERE
        the session sits (2 = halves, 3 = T-shape, 4 = quadrants). The occupied
        cell is accent-filled, the rest dim. Fades out on hover so the action
        chrome (same centered right zone) owns that spot while hovering — at
        rest the mini-map owns it. Rest-state name clearance is handled via the
        projectName span's conditional mr-4.
      */}
      {miniMap && (
        <div
          data-testid="grid-minimap"
          role="img"
          aria-label={`Im Grid: ${miniMap.position}`}
          title={`Im Grid: ${miniMap.position}`}
          className="absolute right-1 top-1/2 -translate-y-1/2 grid gap-px w-3 h-3 group-hover:opacity-0 transition-opacity"
          style={{
            gridTemplateColumns: miniMap.columns,
            gridTemplateRows: miniMap.rows,
            gridTemplateAreas: miniMap.areas,
          }}
        >
          {miniMap.cells.map((area) => {
            const on = area === miniMap.active;
            return (
              <span
                key={area}
                data-cell={area}
                data-active={on ? "true" : undefined}
                className={`rounded-xs ${on ? "bg-accent" : "bg-neutral-600"}`}
                style={{ gridArea: area }}
              />
            );
          })}
        </div>
      )}
      {menuPos && (
        <SessionAccentMenu
          x={menuPos.x}
          y={menuPos.y}
          current={accent}
          hasOverride={hasOverride}
          onSelect={(name) => {
            setFolderAccent(folder, name);
            setMenuPos(null);
          }}
          onReset={() => {
            clearFolderAccent(folder);
            setMenuPos(null);
          }}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
};

export const SessionCard = React.memo(SessionCardInner);
