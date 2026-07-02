import { useState, useEffect, type CSSProperties } from "react";
import { markRender } from "../../utils/perfLogger";
import { SessionList } from "./SessionList";
import { SessionTerminal } from "./SessionTerminal";
import { GridCellChrome } from "./GridCell";
import { TerminalToolbar } from "./TerminalToolbar";
import { EmptyState } from "./EmptyState";
import { ConfigPanel } from "./ConfigPanel";
import { FavoritePreview } from "./FavoritePreview";
import { useSessionStore, selectActiveSession } from "../../store/sessionStore";
import { useUIStore } from "../../store/uiStore";
import { useResizeHandle } from "./hooks/useResizeHandle";
import { useSessionEvents } from "./hooks/useSessionEvents";
import { useSessionCreation } from "./hooks/useSessionCreation";
import { GRID_AREAS, getGridStyle, SINGLE_LAYOUT_STYLE } from "./sessionGridLayout";
import { ICONS, ICON_SIZE } from "../../utils/icons";
import { accentFrameColorFor, resolveSessionAccent } from "../../utils/sessionAccent";
import { useSettingsStore } from "../../store/settingsStore";

export function SessionManagerView() {
  const renderDone = markRender("SessionManagerView");
  useEffect(() => { renderDone.done(); });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const configPanelOpen = useUIStore((s) => s.configPanelOpen);
  const toggleConfigPanel = useUIStore((s) => s.toggleConfigPanel);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSession = useSessionStore(selectActiveSession);
  const layoutMode = useSessionStore((s) => s.layoutMode);
  const gridSessionIds = useSessionStore((s) => s.gridSessionIds);
  const focusedGridSessionId = useSessionStore((s) => s.focusedGridSessionId);
  const setLayoutMode = useSessionStore((s) => s.setLayoutMode);
  const setFocusedGridSession = useSessionStore((s) => s.setFocusedGridSession);
  const maximizeGridSession = useSessionStore((s) => s.maximizeGridSession);
  const removeFromGrid = useSessionStore((s) => s.removeFromGrid);
  const configPanelWidth = useUIStore((s) => s.configPanelWidth);
  const previewFolder = useUIStore((s) => s.previewFolder);
  const closePreview = useUIStore((s) => s.closePreview);
  const sessionAccents = useSettingsStore((s) => s.sessionAccents);

  const { containerRef, handleResizeStart } = useResizeHandle();
  useSessionEvents();
  const { handleResumeSession, handleQuickStart, handleNewSessionFromDefaults } = useSessionCreation();

  // ─────────────────────────────────────────────────────────────────
  // Einheitlicher Render-Baum (Scroll-Bug-Fix, Option B).
  //
  // Alle SessionTerminals leben in EINEM stabilen JSX-Baum, egal ob
  // Single- oder Grid-Modus. Der Layout-Modus steuert nur noch
  // `grid-template` und die Sichtbarkeit der Wrapper-Divs (display).
  //
  // Frühere Implementation hatte einen Ternary `layoutMode === "single"
  // ? <single-tree> : <grid-tree>` — bei jedem Layout-Switch wurden die
  // xterm-Instanzen remountet und der Scrollback-Puffer ging verloren.
  // ─────────────────────────────────────────────────────────────────
  const isGrid = layoutMode === "grid";
  const hasAnySession = sessions.length > 0;
  const showTerminals = isGrid ? gridSessionIds.length > 0 : hasAnySession && !!activeSessionId;
  const showEmptyState = !showTerminals && !(previewFolder && !isGrid);

  // FavoritePreview (nur im Single-Modus relevant) — bei aktivem Preview
  // wird der Terminal-Baum ausgeblendet, bleibt aber gemountet, damit
  // die xterm-Instanzen beim Schliessen des Previews erhalten bleiben.
  const showPreview = !isGrid && !!previewFolder;

  const gridTemplateStyle = isGrid
    ? getGridStyle(Math.min(Math.max(gridSessionIds.length, 1), 4))
    : SINGLE_LAYOUT_STYLE;

  // Im Single-Modus bekommt die aktive Session immer "a" als grid-area.
  // Im Grid-Modus folgt der Index der Session-Reihenfolge in gridSessionIds.
  function resolveGridArea(sessionId: string): string | undefined {
    if (isGrid) {
      const idx = gridSessionIds.indexOf(sessionId);
      return idx >= 0 ? GRID_AREAS[idx] : undefined;
    }
    return sessionId === activeSessionId ? "a" : undefined;
  }

  function isVisible(sessionId: string): boolean {
    if (showPreview) return false;
    if (isGrid) return gridSessionIds.includes(sessionId);
    return sessionId === activeSessionId;
  }

  // ConfigPanel (nur Single-Modus mit aktiver Session) bzw. Preview-Panel (Grid+Single)
  const showConfigPanelSingle = !isGrid && !showPreview && configPanelOpen && !!activeSession;
  const showPreviewPanelGrid = isGrid && !!previewFolder;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        {/* Left column: Session list (collapsible) */}
        {!sidebarCollapsed && (
          <div className="w-[240px] min-w-[240px] border-r border-neutral-700 flex flex-col min-h-0">
            <SessionList onNewSession={handleNewSessionFromDefaults} onQuickStart={handleQuickStart} />
          </div>
        )}
        {/* Sidebar toggle — soft, transparent rail visible only on hover */}
        <button
          onClick={() => setSidebarCollapsed((v) => !v)}
          className="w-3 shrink-0 flex items-center justify-center bg-transparent hover:bg-hover-overlay text-neutral-600 hover:text-neutral-300 transition-colors"
          title={sidebarCollapsed ? "Sidebar einblenden" : "Sidebar ausblenden"}
          aria-label={sidebarCollapsed ? "Sidebar einblenden" : "Sidebar ausblenden"}
        >
          {sidebarCollapsed
            ? <ICONS.action.chevronRight className={ICON_SIZE.inline} aria-hidden="true" />
            : <ICONS.action.chevronLeft className={ICON_SIZE.inline} aria-hidden="true" />}
        </button>

        {/* Right column: Terminal + optional Config panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* Content area — relative so the floating TerminalToolbar anchors here */}
          <div className="flex-1 min-h-0">
            {/* FavoritePreview overrides the terminal view (single-mode only).
                Sessions remain mounted in a hidden sibling so xterm state is preserved. */}
            {showPreview && (
              <FavoritePreview
                key={previewFolder}
                folder={previewFolder!}
                onClose={closePreview}
                onResumeSession={handleResumeSession}
              />
            )}

            {/* EmptyState — only when no sessions AND no preview to show */}
            {!showPreview && showEmptyState && (
              <EmptyState onNewSession={handleNewSessionFromDefaults} />
            )}

            {/* Unified terminal tree — ALL sessions stay mounted regardless of layout.
                Visibility is controlled via `display: none` on the wrapper div.
                Layout-switches (single ↔ grid) do NOT remount SessionTerminal,
                so xterm's scrollback buffer survives. */}
            <div
              className="flex flex-row h-full"
              ref={containerRef}
              style={{ display: showPreview ? "none" : undefined }}
            >
              <div className="relative flex-1 min-w-0 flex flex-col">
                {/* Floating overlay-toolbar — only when a single-mode session
                    is the focused content (not in grid, not behind preview). */}
                {!isGrid && !showPreview && activeSessionId && (
                  <TerminalToolbar
                    layoutMode={layoutMode}
                    onLayoutChange={setLayoutMode}
                    folder={activeSession?.folder}
                    sessionId={activeSessionId}
                    configPanelOpen={configPanelOpen}
                    onToggleConfigPanel={toggleConfigPanel}
                  />
                )}
                <div
                  className="flex-1 min-h-0 grid"
                  style={{
                    ...gridTemplateStyle,
                    gap: isGrid ? "2px" : undefined,
                    display: hasAnySession ? "grid" : "none",
                  }}
                  data-testid="session-terminal-root"
                >
                  {sessions.map((session) => {
                    const visible = isVisible(session.id);
                    const gridArea = resolveGridArea(session.id);
                    const isGridMember = isGrid && gridSessionIds.includes(session.id);
                    const isCellFocused = isGridMember && session.id === focusedGridSessionId;
                    // Frame each grid cell in its session's hue — same hue source as the
                    // sidebar dot, but L/C follow the theme stops (accentFrameColorFor)
                    // so the frame keeps contrast on the light surface too.
                    const cellOverride = session.claudeSessionId
                      ? (sessionAccents[session.claudeSessionId.trim()] ?? null)
                      : null;
                    const cellColor = accentFrameColorFor(session.folder, cellOverride);

                    return (
                      <div
                        key={session.id}
                        data-session-wrapper={session.id}
                        data-testid={isGridMember ? `grid-cell-${session.id}` : undefined}
                        onClick={isGridMember ? () => setFocusedGridSession(session.id) : undefined}
                        style={{
                          display: visible ? "flex" : "none",
                          flexDirection: "column",
                          minHeight: 0,
                          minWidth: 0,
                          gridArea,
                          // Solid colored frame = the session's project color (same source
                          // as the sidebar dot). Color goes through the --qr-frame custom
                          // property; focused cell gets a thicker border.
                          ...(isGridMember
                            ? ({
                                ["--qr-frame"]: cellColor,
                                borderColor: "var(--qr-frame)",
                                borderStyle: "solid",
                                borderWidth: isCellFocused ? "3px" : "2px",
                              } as CSSProperties)
                            : {}),
                        }}
                        className={
                          isGridMember
                            ? "relative rounded-md overflow-hidden box-border"
                            : undefined
                        }
                      >
                        {isGridMember && (
                          <GridCellChrome
                            sessionId={session.id}
                            onMaximize={() => maximizeGridSession(session.id)}
                            onRemove={() => removeFromGrid(session.id)}
                          />
                        )}
                        <div className="flex-1 min-h-0">
                          <SessionTerminal sessionId={session.id} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Resize handle + ConfigPanel (single-mode, active session) */}
              {showConfigPanelSingle && (
                <>
                  <div
                    onMouseDown={handleResizeStart}
                    className="w-1 cursor-col-resize bg-neutral-700 hover:bg-accent transition-colors shrink-0"
                    title="Breite anpassen"
                  />
                  <ConfigPanel
                    folder={activeSession?.folder ?? ""}
                    width={configPanelWidth}
                    // Session-Akzent inkl. Per-Session-Override — Panel-Tabs
                    // zeigen dieselbe Farbe wie Kachel-Rahmen und Sidebar-Punkt.
                    accent={
                      activeSession
                        ? resolveSessionAccent(activeSession, sessionAccents)
                        : undefined
                    }
                    onResumeSession={handleResumeSession}
                  />
                </>
              )}

              {/* Preview panel (grid-mode) */}
              {showPreviewPanelGrid && (
                <>
                  <div
                    onMouseDown={handleResizeStart}
                    className="w-1 cursor-col-resize bg-neutral-700 hover:bg-accent transition-colors shrink-0"
                    title="Breite anpassen"
                  />
                  <ConfigPanel
                    folder={previewFolder!}
                    width={configPanelWidth}
                    onResumeSession={handleResumeSession}
                    onClose={closePreview}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
