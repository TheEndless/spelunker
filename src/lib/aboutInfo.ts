/** What the About tab says about the app and the engine drawing it, and the text copied for a bug report. */

/** The version of WebView2 (the Edge engine that draws the window) in a user agent string, or null when it is not Edge. */
export function webViewVersion(userAgent: string): string | null {
  return /\bEdg\/(\d+(?:\.\d+)*)/.exec(userAgent)?.[1] ?? null;
}

/** The lines a person pastes into a bug report. */
export function versionReport(appVersion: string, webView: string | null): string {
  return [`Spelunker ${appVersion}`, `WebView2 ${webView ?? 'unknown'}`].join('\n');
}
