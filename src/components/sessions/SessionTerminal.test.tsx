import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";

// jsdom doesn't provide ResizeObserver — stub it
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

// ── Mock xterm.js ────────────────────────────────────────────────────

const mockScrollToBottom = vi.fn();
const mockDispose = vi.fn();
const mockOpen = vi.fn();
const mockWrite = vi.fn((_data: string, cb?: () => void) => {
  if (cb) cb();
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnScroll = vi.fn((_cb: any) => ({ dispose: vi.fn() }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnData = vi.fn((_cb: any) => ({ dispose: vi.fn() }));
const mockLoadAddon = vi.fn();
const mockAttachCustomKeyEventHandler = vi.fn();
const mockGetSelection = vi.fn(() => "");

let terminalOptions: Record<string, unknown> = {};
let lastTerminalElement: HTMLElement = document.createElement("div");
const mockBuffer = {
  active: {
    viewportY: 0,
    baseY: 0,
  },
};

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation((opts: Record<string, unknown>) => {
    terminalOptions = opts;
    lastTerminalElement = document.createElement("div");
    return {
      open: mockOpen,
      write: mockWrite,
      dispose: mockDispose,
      scrollToBottom: mockScrollToBottom,
      onScroll: mockOnScroll,
      onData: mockOnData,
      loadAddon: mockLoadAddon,
      attachCustomKeyEventHandler: mockAttachCustomKeyEventHandler,
      getSelection: mockGetSelection,
      cols: 80,
      rows: 24,
      element: lastTerminalElement,
      buffer: mockBuffer,
    };
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../../utils/errorLogger", () => ({
  logError: vi.fn(),
}));

// Tauri clipboard plugin (Option B) — production code calls writeText/readText
// from this module instead of navigator.clipboard. The mocks default to safe
// resolved promises so unrelated tests are unaffected; individual cases override
// them with mockResolvedValueOnce / mockRejectedValueOnce.
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
  readText: vi.fn(() => Promise.resolve("")),
}));

// uiStore mock — SessionTerminal subscribes via useUIStore((s) => s.addToast).
// We expose a stable spy and route the selector call through a fake state object
// so calling `useUIStore(selector)` yields the spy regardless of reference identity.
const mockAddToast = vi.fn();
vi.mock("../../store/uiStore", () => ({
  useUIStore: (selector: (state: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}));

// ── Import after mocks ──────────────────────────────────────────────

import { SessionTerminal } from "./SessionTerminal";
import { logError } from "../../utils/errorLogger";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { invoke } from "@tauri-apps/api/core";

// ── Tests ────────────────────────────────────────────────────────────

describe("SessionTerminal", () => {
  let listenCallback: ((event: { payload: { id: string; data: string } }) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    listenCallback = null;
    terminalOptions = {};
    mockAttachCustomKeyEventHandler.mockReset();
    mockGetSelection.mockReset();
    mockGetSelection.mockReturnValue("");
    mockBuffer.active.viewportY = 0;
    mockBuffer.active.baseY = 0;

    // Reset clipboard-plugin mocks to safe defaults
    vi.mocked(writeText).mockReset();
    vi.mocked(writeText).mockResolvedValue(undefined);
    vi.mocked(readText).mockReset();
    vi.mocked(readText).mockResolvedValue("");

    // Reset uiStore.addToast spy
    mockAddToast.mockReset();

    // Mock document.fonts.ready (not available in jsdom). SessionTerminal
    // awaits this before initial fit/resize.
    if (!(document as unknown as { fonts?: unknown }).fonts) {
      Object.defineProperty(document, "fonts", {
        value: { ready: Promise.resolve() },
        writable: true,
        configurable: true,
      });
    }

    // Capture the listen callback for session-output events
    vi.mocked(listen).mockImplementation(
      (_eventName, cb) => {
        listenCallback = cb as typeof listenCallback;
        return Promise.resolve(() => {}) as ReturnType<typeof listen>;
      },
    );
  });

  it("renders terminal container with overflow:hidden to prevent scroll conflicts", () => {
    const { container } = render(<SessionTerminal sessionId="sess-1" />);
    const terminalDiv = container.firstElementChild as HTMLDivElement;

    expect(terminalDiv).toBeTruthy();
    expect(terminalDiv.style.overflow).toBe("hidden");
  });

  it("configures explicit scrollback buffer", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    expect(terminalOptions).toHaveProperty("scrollback");
    expect(terminalOptions.scrollback).toBeGreaterThanOrEqual(1000);
  });

  it("auto-scrolls to bottom on new output when viewport is at bottom", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    expect(listenCallback).toBeTruthy();

    // Simulate output arriving
    act(() => {
      listenCallback!({ payload: { id: "sess-1", data: "hello world" } });
    });

    expect(mockWrite).toHaveBeenCalledWith("hello world", expect.any(Function));
    expect(mockScrollToBottom).toHaveBeenCalled();
  });

  it("does NOT auto-scroll when user has manually scrolled up", async () => {
    vi.useFakeTimers();
    render(<SessionTerminal sessionId="sess-1" />);

    // Advance past the 150ms scroll-track activation delay
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();

    // Capture the onScroll handler (registered after the delay)
    expect(mockOnScroll).toHaveBeenCalled();
    const scrollHandler = mockOnScroll.mock.calls[0]![0] as () => void;
    expect(scrollHandler).toBeTruthy();

    // Simulate: terminal has scrollback (baseY > 0) and user scrolled up (viewportY < baseY)
    // The mock terminal's buffer is shared — mutate it directly
    mockBuffer.active.baseY = 100;
    mockBuffer.active.viewportY = 50; // user scrolled up

    // Trigger the scroll event
    act(() => {
      scrollHandler();
    });

    // Reset mock to only track subsequent calls
    mockScrollToBottom.mockClear();

    // Now simulate new output
    act(() => {
      listenCallback!({ payload: { id: "sess-1", data: "new output" } });
    });

    // Should NOT auto-scroll because user scrolled up
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });

  it("ignores output events for different session IDs", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    act(() => {
      listenCallback!({ payload: { id: "sess-OTHER", data: "not mine" } });
    });

    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("cleans up terminal and listeners on unmount", () => {
    const { unmount } = render(<SessionTerminal sessionId="sess-1" />);

    unmount();

    expect(mockDispose).toHaveBeenCalled();
  });

  // ── Clipboard / context-menu regression guards (Option B: 8d81a9d + a122dbb) ──
  //
  // These tests pin the Tauri-clipboard-plugin migration and the contextmenu
  // suppression introduced in a122dbb. They fail if the plugin import is
  // reverted to navigator.clipboard, the Ctrl+V handler is removed, the
  // Shift+Ctrl+V passthrough is broken, or the contextmenu listener is dropped.

  it("clipboard copy failure surfaces toast and logs", async () => {
    const clipboardError = new Error("clipboard write denied");
    vi.mocked(writeText).mockRejectedValueOnce(clipboardError);

    render(<SessionTerminal sessionId="sess-1" />);

    expect(mockAttachCustomKeyEventHandler).toHaveBeenCalled();
    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    // Selection present → Ctrl+C must call plugin.writeText
    mockGetSelection.mockReturnValue("selected text");

    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "c" }),
    );

    // Plugin (not navigator.clipboard) was called
    expect(vi.mocked(writeText)).toHaveBeenCalledWith("selected text");
    // Custom handler consumed the event (selection present → false)
    expect(consumed).toBe(false);

    // Allow the rejected promise's .catch to run
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      "SessionTerminal.clipboardCopy",
      clipboardError,
    );
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("Ctrl+V with clipboard text invokes write_session via wrapInvoke", async () => {
    vi.mocked(readText).mockResolvedValueOnce("hello world");

    render(<SessionTerminal sessionId="sess-1" />);

    expect(mockAttachCustomKeyEventHandler).toHaveBeenCalled();
    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: false, key: "v" }),
    );

    // Custom handler consumes Ctrl+V so xterm doesn't also forward \x16
    expect(consumed).toBe(false);

    // Plugin readText was called
    expect(vi.mocked(readText)).toHaveBeenCalled();

    // Drain the readText() → wrapInvoke() → invoke() promise chain
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // wrapInvoke routes through the mocked @tauri-apps/api/core invoke
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("write_session", {
      id: "sess-1",
      data: "hello world",
    });
  });

  it("Ctrl+V with rejected readText surfaces error toast and logs", async () => {
    const pasteError = new Error("clipboard read denied");
    vi.mocked(readText).mockRejectedValueOnce(pasteError);

    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: false, key: "v" }),
    );

    // Drain async chain (readText rejects → .catch runs)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      "SessionTerminal.clipboardPaste",
      pasteError,
    );
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: expect.stringMatching(/Einf|paste|clipboard/i),
      }),
    );
  });

  it("Ctrl+V with empty readText is a defensive no-op", async () => {
    vi.mocked(readText).mockResolvedValueOnce("");

    render(<SessionTerminal sessionId="sess-1" />);

    // Snapshot how often invoke was called *before* the paste
    const invokeCallsBefore = vi.mocked(invoke).mock.calls.length;

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: false, key: "v" }),
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // No write_session invocation triggered by the paste (other invokes like
    // resize_session may still fire from the effect, but none with the paste data).
    const writeSessionCalls = vi
      .mocked(invoke)
      .mock.calls.slice(invokeCallsBefore)
      .filter((call) => call[0] === "write_session");
    expect(writeSessionCalls).toEqual([]);

    // No error toast
    const errorToasts = mockAddToast.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === "error",
    );
    expect(errorToasts).toEqual([]);
  });

  it("Shift+Ctrl+V is NOT consumed by the custom handler (Linux compat)", async () => {
    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, key: "v" }),
    );

    // Falls through to xterm's internal paste handler
    expect(consumed).toBe(true);
    // Plugin readText must NOT be called for Shift+Ctrl+V
    expect(vi.mocked(readText)).not.toHaveBeenCalled();

    // Drain microtasks just to be safe — still no paste-driven invoke
    await act(async () => {
      await Promise.resolve();
    });
    const pasteInvokes = vi
      .mocked(invoke)
      .mock.calls.filter(
        (call) =>
          call[0] === "write_session" &&
          (call[1] as { data?: string } | undefined)?.data !== undefined,
      );
    // Filter out any that aren't from a real paste path is implicitly satisfied —
    // there's no other code path that pushes data into write_session in this test.
    expect(pasteInvokes).toEqual([]);
  });

  it("Ctrl+C with selection uses writeText from plugin (not navigator.clipboard)", () => {
    // Spy on navigator.clipboard.writeText — must NOT be called after migration
    const navWriteText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: navWriteText, readText: vi.fn(() => Promise.resolve("")) },
      writable: true,
      configurable: true,
    });

    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    mockGetSelection.mockReturnValue("copied text");

    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "c" }),
    );

    // Plugin path used
    expect(vi.mocked(writeText)).toHaveBeenCalledWith("copied text");
    // Old API NOT used
    expect(navWriteText).not.toHaveBeenCalled();
    // Selection-present Ctrl+C must consume so SIGINT does not also fire
    expect(consumed).toBe(false);
  });

  it("contextmenu event on the terminal container calls preventDefault", () => {
    const { container } = render(<SessionTerminal sessionId="sess-1" />);
    const terminalDiv = container.firstElementChild as HTMLDivElement;
    expect(terminalDiv).toBeTruthy();

    // The listener is attached unconditionally at effect-time after term.open();
    // dispatch a cancelable contextmenu event and verify it's prevented.
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    terminalDiv.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("case-insensitive: Ctrl+C with key='C' uses plugin writeText", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;

    mockGetSelection.mockReturnValue("x");

    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, key: "C" }),
    );

    expect(vi.mocked(writeText)).toHaveBeenCalledWith("x");
    expect(consumed).toBe(false);
  });

  // ── Paste de-duplication regression guard (c7b56ae) ──
  //
  // WebView2 fires BOTH a keydown event AND a separate paste DOM event for
  // Ctrl+V. The custom keydown handler consumes the keydown, but the paste
  // DOM event still reaches xterm's helper textarea, which forwards the text
  // through term.onData. Without the dedup-window guard the user sees the
  // paste inserted twice. These tests pin that guard against silent removal.

  it("Ctrl+V suppresses the parallel term.onData echo within the dedup window", async () => {
    vi.mocked(readText).mockResolvedValueOnce("hello world");
    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;
    expect(mockOnData).toHaveBeenCalled();
    const onDataCb = mockOnData.mock.calls[0]![0] as (data: string) => void;

    // Trigger custom Ctrl+V → marker stamped synchronously inside the handler
    keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: false, key: "v" }),
    );

    // Simulate the parallel DOM paste-event echo arriving immediately (xterm
    // would route it through term.onData with the same text).
    await act(async () => {
      onDataCb("hello world");
      // Drain readText().then(...) → wrapInvoke(...) → invoke chain
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // write_session must have been invoked exactly once with the paste text —
    // the echo via onData must be suppressed.
    const writeSessionCalls = vi
      .mocked(invoke)
      .mock.calls.filter((call) => call[0] === "write_session");
    expect(writeSessionCalls).toHaveLength(1);
    expect(writeSessionCalls[0]).toEqual([
      "write_session",
      { id: "sess-1", data: "hello world" },
    ]);
  });

  it("term.onData runs normally outside the paste dedup window", async () => {
    // Deterministic time control via Date.now spy — fake timers + microtasks
    // interact awkwardly here because readText is a resolved promise (no timer).
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
    vi.mocked(readText).mockResolvedValueOnce("foo");
    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;
    const onDataCb = mockOnData.mock.calls[0]![0] as (data: string) => void;

    // t=1000: trigger Ctrl+V → marker stamped
    keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: false, key: "v" }),
    );

    // Drain the readText → wrapInvoke → invoke promise chain (still at t=1000)
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const before = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === "write_session").length;

    // t=1500: 500 ms later — well past PASTE_DEDUP_WINDOW_MS (150)
    dateNowSpy.mockReturnValue(1500);

    // A normal keystroke must NOT be suppressed at this point
    await act(async () => {
      onDataCb("a");
      await Promise.resolve();
    });

    const after = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === "write_session");
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toEqual([
      "write_session",
      { id: "sess-1", data: "a" },
    ]);

    dateNowSpy.mockRestore();
  });

  it("Shift+Ctrl+V does not engage the paste dedup window — onData stays live", async () => {
    render(<SessionTerminal sessionId="sess-1" />);

    const keyHandler = mockAttachCustomKeyEventHandler.mock.calls[0]![0] as (
      e: KeyboardEvent,
    ) => boolean;
    const onDataCb = mockOnData.mock.calls[0]![0] as (data: string) => void;

    // Shift+Ctrl+V is intentionally NOT consumed — falls through to xterm's
    // internal paste path. The custom handler does NOT stamp the marker.
    const consumed = keyHandler(
      new KeyboardEvent("keydown", { ctrlKey: true, shiftKey: true, key: "v" }),
    );
    expect(consumed).toBe(true);

    // Immediately after, a regular onData call must be processed normally
    // (it would be the legitimate output of xterm's internal paste flow, not
    // a suppressed echo).
    await act(async () => {
      onDataCb("pasted");
      await Promise.resolve();
    });

    const writeSessionCalls = vi
      .mocked(invoke)
      .mock.calls.filter((c) => c[0] === "write_session");
    expect(writeSessionCalls).toContainEqual([
      "write_session",
      { id: "sess-1", data: "pasted" },
    ]);
  });

  // ── Regression guards for b92cc60 / ea3a6df (Option A scroll/config fixes) ──
  //
  // These tests pin the xterm.js constructor options and the onData auto-scroll
  // decoupling introduced in ea3a6df. They are designed to turn red if any of
  // these knobs is silently removed or flipped in a future refactor.

  it("instantiates Terminal with convertEol: true (regression guard for ea3a6df)", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    // terminalOptions is captured by the vi.mock factory on the Terminal constructor.
    expect(terminalOptions).toMatchObject({ convertEol: true });
  });

  it("instantiates Terminal with scrollOnUserInput: false (regression guard for ea3a6df)", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    expect(terminalOptions).toMatchObject({ scrollOnUserInput: false });
  });

  it("instantiates Terminal with windowsPty backend 'conpty' (regression guard for ea3a6df)", () => {
    render(<SessionTerminal sessionId="sess-1" />);

    expect(terminalOptions).toMatchObject({
      windowsPty: { backend: "conpty" },
    });
    // buildNumber must be present and numeric (value not constrained — different
    // Windows baselines are acceptable, but the property itself is load-bearing
    // for xterm's ConPTY reflow heuristics).
    expect(
      (terminalOptions.windowsPty as { buildNumber: unknown }).buildNumber,
    ).toEqual(expect.any(Number));
  });

  it("onData handler scrolls to bottom when viewport is at bottom (regression guard for ea3a6df)", async () => {
    render(<SessionTerminal sessionId="sess-1" />);

    // Default mock state: baseY=0, viewportY=0 → isAtBottom=true → userScrolledUpRef=false.
    // The onData callback should therefore invoke scrollToBottom after forwarding
    // the keystroke to the backend.
    expect(mockOnData).toHaveBeenCalled();
    const onDataCb = mockOnData.mock.calls[0]![0] as (data: string) => void;
    expect(onDataCb).toBeTruthy();

    mockScrollToBottom.mockClear();

    await act(async () => {
      onDataCb("x");
      // Allow the wrapInvoke → invoke promise chain to settle.
      await Promise.resolve();
    });

    expect(mockScrollToBottom).toHaveBeenCalled();
  });

  it("onData handler does NOT scroll to bottom when user is reading scrollback (regression guard for ea3a6df)", async () => {
    vi.useFakeTimers();
    render(<SessionTerminal sessionId="sess-1" />);

    // Advance past the 150ms scroll-track activation delay so onScroll is wired up.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();

    // Simulate: terminal has scrollback and user has scrolled away from the bottom.
    mockBuffer.active.baseY = 100;
    mockBuffer.active.viewportY = 50;

    // Fire the scroll event so userScrolledUpRef flips to true.
    expect(mockOnScroll).toHaveBeenCalled();
    const scrollHandler = mockOnScroll.mock.calls[0]![0] as () => void;
    act(() => {
      scrollHandler();
    });

    // Now trigger an onData callback. Before the fix, xterm would auto-scroll via
    // scrollOnUserInput=true (its default) — our decoupled logic must NOT call
    // scrollToBottom because the user is actively reading scrollback.
    expect(mockOnData).toHaveBeenCalled();
    const onDataCb = mockOnData.mock.calls[0]![0] as (data: string) => void;

    mockScrollToBottom.mockClear();

    await act(async () => {
      onDataCb("y");
      await Promise.resolve();
    });

    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });

  it("resize invoke failure is logged via logError", async () => {
    const resizeError = new Error("resize failed");
    vi.mocked(invoke).mockRejectedValueOnce(resizeError);

    // runFit-Guard (eingeführt mit Always-Mounted-Terminals) skippt fit(),
    // wenn der Container 0x0 ist — was in jsdom ohne Layout-Engine der Default ist.
    // Für diesen Test simulieren wir einen sichtbaren Container, damit fit() läuft
    // und der Resize-invoke tatsächlich stattfindet.
    const offsetWidthSpy = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(800);
    const offsetHeightSpy = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(600);

    vi.useFakeTimers();
    render(<SessionTerminal sessionId="sess-1" />);

    // Advance past the 50ms initial resize timer
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    vi.useRealTimers();

    // Flush microtasks so document.fonts.ready.then(...).catch(...) runs
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(logError)).toHaveBeenCalledWith("SessionTerminal.resize", resizeError);

    offsetWidthSpy.mockRestore();
    offsetHeightSpy.mockRestore();
  });
});
