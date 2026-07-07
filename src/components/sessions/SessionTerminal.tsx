import { useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal, type ITheme } from "@xterm/xterm";
import { wrapInvoke, markRender } from "../../utils/perfLogger";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { logError } from "../../utils/errorLogger";
import { isWindows } from "../../utils/platform";
import { useUIStore } from "../../store/uiStore";
import { useSettingsStore, sanitizeScrollbackLines } from "../../store/settingsStore";
import "@xterm/xterm/css/xterm.css";

interface SessionTerminalProps {
  sessionId: string;
}

/** Threshold (in rows) to consider the viewport "at the bottom" */
const SCROLL_BOTTOM_THRESHOLD = 1;

/**
 * Window in milliseconds during which a term.onData call is treated as a duplicate
 * echo of the most recent custom Ctrl+V paste. WebView2 dispatches BOTH a keydown
 * event AND a separate paste DOM event for Ctrl+V; the keydown is consumed by
 * attachCustomKeyEventHandler, but the paste DOM event still reaches xterm's
 * helper textarea and produces a term.onData call with the same text. Without
 * this guard the user sees the paste inserted twice. 150 ms is conservative —
 * normal human typing rate is well above that interval.
 */
const PASTE_DEDUP_WINDOW_MS = 150;

/**
 * Debounce helper — returns a debounced version of `fn`.
 * The returned function also exposes `.cancel()` for cleanup.
 */
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/**
 * Builds the xterm theme from the live design tokens on :root so the terminal
 * follows the app's light/dark switch and the azure accent.
 *
 * xterm's color parser accepts hex/rgb/rgba but NOT `oklch()`, and our tokens
 * are authored in oklch. Reading the var and handing it to xterm directly would
 * render as transparent/black. So we rasterize each token via a 1x1 canvas
 * (fillRect + getImageData), which forces the browser to convert the oklch
 * value to concrete sRGB bytes we then format as rgb()/rgba().
 */
function resolveTerminalTheme(): ITheme {
  const cs = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  const toRgb = (varName: string, fallback: string): string => {
    const raw = cs.getPropertyValue(varName).trim();
    if (!raw || !ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback; // if `raw` is unparsable, fillStyle keeps the fallback
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  };
  return {
    background: toRgb("--surface-base", "#0d1117"),
    foreground: toRgb("--neutral-100", "#e6edf3"),
    cursor: toRgb("--color-accent", "#00b5f5"),
    selectionBackground: toRgb("--accent-a30", "#264f78"),
  };
}

export function SessionTerminal({ sessionId }: SessionTerminalProps) {
  const renderDone = markRender("SessionTerminal");
  useEffect(() => {
    renderDone.done();
  });

  const addToast = useUIStore((s) => s.addToast);

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  /** Tracks whether the user has manually scrolled away from the bottom */
  const userScrolledUpRef = useRef(false);
  /**
   * Timestamp of the most recent custom Ctrl+V paste. Set synchronously in the
   * keydown handler before the async readText, so the parallel DOM paste-event
   * echo (which arrives in term.onData) can be recognised and suppressed.
   */
  const justCustomPastedRef = useRef<number>(0);

  /**
   * Check if the terminal viewport is at (or near) the bottom of the scrollback buffer.
   */
  const isAtBottom = useCallback((term: Terminal): boolean => {
    const viewportRow = term.buffer.active.viewportY;
    const baseY = term.buffer.active.baseY;
    return baseY - viewportRow <= SCROLL_BOTTOM_THRESHOLD;
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    // Read scrollback limit from user preferences at terminal-creation time.
    // Default 25_000 (5× xterm.js default of 1000) — Claude-CLI-Sessions
    // produce 5–10× the output of typical shells (tool-calls, TUI repaints,
    // status-bar redraws). User can change in Settings → Terminal-Verlauf.
    // sanitize: clamp to safe band (1k..100k) to prevent corrupt-settings OOM.
    // NOTE: live-changes apply on NEXT session creation (existing xterm
    // instances keep their original buffer to avoid data loss on shrink).
    const scrollbackLines = sanitizeScrollbackLines(
      useSettingsStore.getState().preferences.scrollbackLines,
    );

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      scrollback: scrollbackLines,
      // Normalize bare LF (often emitted by Node child processes under PowerShell)
      // to CRLF so xterm renders lines correctly.
      convertEol: true,
      // Decouple xterm's built-in "scroll on keystroke" from our own logic:
      // we track userScrolledUpRef manually and trigger scrollToBottom in onData
      // only when the user is NOT actively reading scrollback. Leaving the default
      // (true) causes xterm to scroll on every keystroke and fights our own tracking.
      scrollOnUserInput: false,
      // Tell xterm it's attached to a ConPTY backend — ONLY on Windows. This
      // enables the correct line-wrap / reflow heuristics for ConPTY output
      // (xtermjs/xterm.js#2666). buildNumber 19041 = Windows 10 20H1 baseline;
      // >= 21376 would unlock reflow, but Claude-Code's output does not rely on
      // it and we stay conservative. On macOS/Linux the PTY is a Unix pty, not
      // ConPTY — passing this option there feeds xterm wrong reflow heuristics.
      ...(isWindows() ? { windowsPty: { backend: "conpty" as const, buildNumber: 19041 } } : {}),
      theme: resolveTerminalTheme(),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    // Suppress the WebView2 default page context menu (Zurück / Aktualisieren / …)
    // on the Terminal container only. xterm renders selection on a Canvas overlay,
    // so without this listener the WebView2 page menu wins on right-click. Scoping
    // to containerRef keeps the menu intact in the sidebar / app chrome.
    const terminalContainer = containerRef.current;
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    terminalContainer.addEventListener("contextmenu", handleContextMenu);

    // Initial fit nur wenn Container sichtbar ist (offsetWidth/Height > 0).
    // Bei Always-Mounted-Strategie startet ein inaktives Terminal mit display:none,
    // dann liefert fit() NaN-Dimensions. ResizeObserver triggert fit() beim Unhide.
    if (containerRef.current.offsetWidth > 0 && containerRef.current.offsetHeight > 0) {
      fitAddon.fit();
    }
    terminalRef.current = term;

    // Clipboard handling (xterm v6 has no built-in keydown path for either shortcut):
    //   Ctrl+C        → copy current selection via Tauri-Plugin; otherwise pass through
    //                   so the PTY receives SIGINT.
    //   Ctrl+V        → read clipboard via Tauri-Plugin and forward the text to the PTY.
    //                   Consumed here so the raw \x16 keystroke does not also reach the PTY.
    //   Shift+Ctrl+V  → intentionally NOT consumed → falls through to xterm's internal
    //                   paste-event path, preserving the Linux-style paste shortcut.
    // Failures of either operation surface as user-visible toasts via uiStore.addToast.
    // event.key is normalized to lower-case so Capslock does not break the shortcuts.
    term.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === "c") {
        const selection = term.getSelection();
        if (selection) {
          writeText(selection).catch((err) => {
            logError("SessionTerminal.clipboardCopy", err);
            addToast({
              type: "error",
              title: "Kopieren fehlgeschlagen",
              duration: 3000,
            });
          });
          return false; // Consumed — do NOT forward to PTY
        }
        // No selection → allow normal Ctrl+C (SIGINT) to pass through
        return true;
      }
      if (event.ctrlKey && !event.shiftKey && key === "v") {
        // Mark IMMEDIATELY (synchronously, before awaiting readText) so the
        // parallel DOM paste-event echo arriving in term.onData below is
        // recognised and suppressed within PASTE_DEDUP_WINDOW_MS.
        justCustomPastedRef.current = Date.now();
        readText()
          .then((text) => {
            if (text != null && text.length > 0) {
              wrapInvoke("write_session", { id: sessionId, data: text }).catch(
                (err) => logError("SessionTerminal.writeSession", err),
              );
            }
          })
          .catch((err) => {
            logError("SessionTerminal.clipboardPaste", err);
            addToast({
              type: "error",
              title: "Einfügen fehlgeschlagen",
              duration: 3000,
            });
          });
        return false; // Consumed — paste path goes through Tauri plugin only
      }
      return true;
    });

    // Scroll tracking: delay activation so the initial fitAddon.fit() resize event
    // doesn't falsely set userScrolledUpRef=true (which would break auto-scroll).
    let scrollDisposable: { dispose: () => void } = { dispose: () => {} };
    const scrollTrackTimer = setTimeout(() => {
      // Only reset to "at bottom" if the user hasn't already scrolled up during
      // the delay window — blindly resetting would kick them back into auto-scroll.
      if (isAtBottom(term)) {
        userScrolledUpRef.current = false;
      }
      scrollDisposable = term.onScroll(() => {
        userScrolledUpRef.current = !isAtBottom(term);
      });
    }, 150);

    // Input: User types -> send to backend
    term.onData((data: string) => {
      // Suppress the DOM paste-event echo that arrives shortly after a custom
      // Ctrl+V paste: xterm's helper textarea forwards the paste through onData,
      // and our custom Ctrl+V handler also writes the clipboard text — without
      // this guard the user sees the paste inserted twice.
      if (Date.now() - justCustomPastedRef.current < PASTE_DEDUP_WINDOW_MS) {
        return;
      }
      wrapInvoke("write_session", { id: sessionId, data }).catch((err) => {
        logError("SessionTerminal.writeSession", err);
      });
      // Manual auto-scroll on user input: because we set scrollOnUserInput=false
      // above, xterm no longer jumps to the bottom on keystrokes. We replicate that
      // behaviour here, but gated on userScrolledUpRef so the user can read
      // scrollback while typing without being yanked back to the prompt.
      if (!userScrolledUpRef.current) {
        term.scrollToBottom();
      }
    });

    // Output: Backend PTY output -> xterm
    const unlistenPromise = listen<{ id: string; data: string }>(
      "session-output",
      (event) => {
        if (
          event?.payload?.id === sessionId &&
          typeof event?.payload?.data === "string"
        ) {
          term.write(event.payload.data, () => {
            // After write completes: auto-scroll to bottom unless user scrolled up
            if (!userScrolledUpRef.current) {
              term.scrollToBottom();
            }
          });
        }
      },
    );

    // Fit-Guard: Wenn Container 0x0 ist (z.B. display:none beim Initial-Mount
    // durch Always-Mounted-Strategie in SessionManagerView), skippe fit().
    // Der ResizeObserver triggert fit() automatisch sobald der Container sichtbar wird
    // und echte Dimensions bekommt.
    const runFit = () => {
      const el = containerRef.current;
      if (!term.element) return;
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return;
      fitAddon.fit();
      wrapInvoke("resize_session", {
        id: sessionId,
        cols: term.cols,
        rows: term.rows,
      }).catch((err) => logError("SessionTerminal.resize", err));
    };

    // Debounced fit — prevents layout thrashing during rapid resizes
    const debouncedFit = debounce(() => {
      runFit();
    }, 100);

    // Resize observer with debounced fit
    const resizeObserver = new ResizeObserver(() => {
      debouncedFit();
    });
    resizeObserver.observe(containerRef.current);

    // Report initial size (slightly delayed so the DOM has settled)
    const initialTimer = setTimeout(() => {
      document.fonts.ready.then(() => {
        runFit();
      });
    }, 50);

    return () => {
      clearTimeout(initialTimer);
      clearTimeout(scrollTrackTimer);
      debouncedFit.cancel();
      terminalContainer.removeEventListener("contextmenu", handleContextMenu);
      unlistenPromise
        .then((unlisten) => {
          try { unlisten(); }
          catch (e) { logError("SessionTerminal.cleanup.unlisten", e); }
        })
        .catch((e) => logError("SessionTerminal.cleanup.unlistenPromise", e));
      scrollDisposable.dispose();
      resizeObserver.disconnect();
      term.dispose();
      terminalRef.current = null;
    };
  }, [sessionId, isAtBottom, addToast]);

  // Re-theme the live terminal when the app toggles light/dark. useThemeEffect
  // flips the `.dark` class on :root, which swaps the token values; we observe
  // that class change and re-resolve the xterm theme from the fresh tokens.
  // Reads terminalRef lazily so it survives terminal re-creation.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const term = terminalRef.current;
      if (term) term.options.theme = resolveTerminalTheme();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: "4px", backgroundColor: "var(--surface-base)", overflow: "hidden" }}
    />
  );
}
