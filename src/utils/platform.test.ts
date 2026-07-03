import { describe, it, expect, afterEach, vi } from "vitest";
import { isWindows } from "./platform";

describe("isWindows", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns true for a Windows WebView2 user-agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    });
    expect(isWindows()).toBe(true);
  });

  it("returns false for a macOS WKWebView user-agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
    });
    expect(isWindows()).toBe(false);
  });
});
