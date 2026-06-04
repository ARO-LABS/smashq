import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useUIStore } from "../store/uiStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("./errorLogger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

// We need to import after mocks are set up
const { logError } = await import("./errorLogger");

describe("globalErrorHandler", () => {
  let errorListeners: ((event: ErrorEvent) => void)[];
  let rejectionListeners: ((event: unknown) => void)[];

  beforeEach(() => {
    vi.clearAllMocks();
    useUIStore.setState({ toasts: [] });
    errorListeners = [];
    rejectionListeners = [];

    // Capture event listeners added by installGlobalErrorHandlers
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type: string, handler: EventListenerOrEventListenerObject) => {
        if (type === "error") {
          errorListeners.push(handler as (event: ErrorEvent) => void);
        } else if (type === "unhandledrejection") {
          rejectionListeners.push(handler as (event: unknown) => void);
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function install() {
    const mod = await import("./globalErrorHandler");
    mod.installGlobalErrorHandlers();
  }

  // jsdom does not have PromiseRejectionEvent — create a fake event shape
  function fakeRejectionEvent(reason: unknown) {
    return { reason } as unknown;
  }

  it("installs error and unhandledrejection listeners", async () => {
    await install();
    expect(errorListeners.length).toBe(1);
    expect(rejectionListeners.length).toBe(1);
  });

  it("handles window error event with Error object", async () => {
    await install();
    const error = new Error("Test error message");
    const event = new ErrorEvent("error", {
      error,
      message: "Test error message",
    });

    errorListeners[0](event);

    expect(logError).toHaveBeenCalledWith("window", error);
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe("error");
    expect(toasts[0].message).toContain("Test error message");
  });

  it("handles window error event without Error object (fallback message)", async () => {
    await install();
    const event = new ErrorEvent("error", {
      message: "Script error",
    });

    errorListeners[0](event);

    expect(logError).toHaveBeenCalled();
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("Script error");
  });

  it("handles unhandled rejection with Error reason", async () => {
    await install();
    const reason = new Error("Promise failed");

    rejectionListeners[0](fakeRejectionEvent(reason));

    expect(logError).toHaveBeenCalledWith("promise", reason);
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("Promise failed");
  });

  it("handles unhandled rejection with string reason", async () => {
    await install();

    rejectionListeners[0](fakeRejectionEvent("string error reason"));

    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toContain("string error reason");
  });

  it("handles unhandled rejection with non-Error/non-string reason", async () => {
    await install();

    rejectionListeners[0](fakeRejectionEvent({ code: 42 }));

    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toBe("Unbehandelte Promise-Rejection");
  });

  it("truncates long error messages to 120 chars", async () => {
    await install();
    const longMsg = "A".repeat(200);
    const event = new ErrorEvent("error", {
      error: new Error(longMsg),
      message: longMsg,
    });

    errorListeners[0](event);

    const toasts = useUIStore.getState().toasts;
    // 120 chars + ellipsis character
    expect(toasts[0].message?.length).toBeLessThanOrEqual(121);
  });

  it("appends an ellipsis when truncating", async () => {
    await install();
    const longMsg = "B".repeat(200);
    errorListeners[0](
      new ErrorEvent("error", { error: new Error(longMsg), message: longMsg }),
    );
    const toasts = useUIStore.getState().toasts;
    expect(toasts[0].message?.endsWith("…")).toBe(true);
  });

  it("does not truncate messages exactly 120 chars long", async () => {
    await install();
    const msg = "C".repeat(120);
    errorListeners[0](
      new ErrorEvent("error", { error: new Error(msg), message: msg }),
    );
    const toasts = useUIStore.getState().toasts;
    expect(toasts[0].message).toBe(msg);
    expect(toasts[0].message?.endsWith("…")).toBe(false);
  });

  it("does not truncate short messages", async () => {
    await install();
    errorListeners[0](
      new ErrorEvent("error", { error: new Error("short"), message: "short" }),
    );
    expect(useUIStore.getState().toasts[0].message).toBe("short");
  });

  it("error toast uses title 'Fehler' and 8000ms duration", async () => {
    await install();
    errorListeners[0](
      new ErrorEvent("error", { error: new Error("x"), message: "x" }),
    );
    const toast = useUIStore.getState().toasts[0];
    expect(toast.title).toBe("Fehler");
    expect(toast.duration).toBe(8000);
  });

  it("synthesizes a fallback error when event has neither error nor message", async () => {
    await install();
    errorListeners[0](new ErrorEvent("error", {}));
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    // event.error undefined + empty message → synthesized "Unbekannter Fehler"
    expect(toasts[0].message).toBe("Unbekannter Fehler");
  });

  it("logs a synthesized Error for error events lacking an error object", async () => {
    await install();
    errorListeners[0](new ErrorEvent("error", { message: "synth" }));
    expect(logError).toHaveBeenCalledWith("window", expect.any(Error));
  });

  it("handles unhandled rejection with null reason", async () => {
    await install();
    rejectionListeners[0](fakeRejectionEvent(null));
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].message).toBe("Unbehandelte Promise-Rejection");
  });

  it("handles unhandled rejection with undefined reason", async () => {
    await install();
    rejectionListeners[0](fakeRejectionEvent(undefined));
    expect(useUIStore.getState().toasts[0].message).toBe(
      "Unbehandelte Promise-Rejection",
    );
  });

  it("handles unhandled rejection with numeric reason", async () => {
    await install();
    rejectionListeners[0](fakeRejectionEvent(404));
    expect(useUIStore.getState().toasts[0].message).toBe(
      "Unbehandelte Promise-Rejection",
    );
  });

  it("truncates long rejection messages from Error reasons", async () => {
    await install();
    const longMsg = "D".repeat(200);
    rejectionListeners[0](fakeRejectionEvent(new Error(longMsg)));
    const msg = useUIStore.getState().toasts[0].message;
    expect(msg?.length).toBeLessThanOrEqual(121);
    expect(msg?.endsWith("…")).toBe(true);
  });

  it("truncates long string rejection reasons", async () => {
    await install();
    rejectionListeners[0](fakeRejectionEvent("E".repeat(200)));
    expect(
      useUIStore.getState().toasts[0].message?.length,
    ).toBeLessThanOrEqual(121);
  });

  it("logs the raw reason for rejections (string)", async () => {
    await install();
    rejectionListeners[0](fakeRejectionEvent("plain"));
    expect(logError).toHaveBeenCalledWith("promise", "plain");
  });

  it("logs the raw reason for rejections (object)", async () => {
    await install();
    const obj = { code: 7 };
    rejectionListeners[0](fakeRejectionEvent(obj));
    expect(logError).toHaveBeenCalledWith("promise", obj);
  });

  it("each handled error produces an independent toast", async () => {
    await install();
    errorListeners[0](
      new ErrorEvent("error", { error: new Error("first"), message: "first" }),
    );
    errorListeners[0](
      new ErrorEvent("error", { error: new Error("second"), message: "second" }),
    );
    const toasts = useUIStore.getState().toasts;
    expect(toasts.length).toBe(2);
  });

  it("does not show a toast or log when handlers are merely installed", async () => {
    await install();
    expect(logError).not.toHaveBeenCalled();
    expect(useUIStore.getState().toasts.length).toBe(0);
  });
});
