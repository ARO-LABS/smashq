/**
 * Best-effort host-OS detection from inside the Tauri webview.
 *
 * The Rust backend stays the authority on platform (it resolves shells, PATH,
 * bundling, …). This helper only covers the few purely-cosmetic frontend
 * decisions that need a *synchronous* answer before any async Tauri call could
 * resolve: xterm's ConPTY reflow hint and the "auto" shell display label.
 *
 * The webview user-agent is reliable for that narrow purpose — WKWebView on
 * macOS reports "Macintosh", WebView2 on Windows reports "Windows NT". Do NOT
 * use this for security- or correctness-critical logic; ask the backend there.
 */
export function isWindows(): boolean {
  if (typeof navigator === "undefined") return false;
  return /windows/i.test(navigator.userAgent);
}

/**
 * Best-effort macOS detection from the webview user-agent — WKWebView reports
 * "Macintosh". Same narrow, cosmetic-only contract as {@link isWindows}: used
 * for the platform-specific install hints in the prerequisite UI, never for
 * correctness-critical logic (the Rust backend stays the platform authority).
 */
export function isMacOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /macintosh|mac os x/i.test(navigator.userAgent);
}
