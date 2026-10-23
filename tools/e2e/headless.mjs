// Starts a headless Edge for checks that only need the page, run against the dev server (mock
// backend). Nothing here shows a window, takes focus, or sends input to the desktop.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/**
 * A fresh profile still signs in and syncs extensions by default. Their welcome tabs push the test
 * page to the background, where screenshots never finish and the first launch can hang, so all of
 * that is switched off.
 */
const QUIET_FLAGS = [
  '--headless=new',
  '--disable-extensions',
  '--disable-sync',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=msImplicitSignin,msEdgeSync,EdgeSync',
];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Starts headless Edge with its own throwaway profile and waits for its blank page. Returns that
 * page's debugger address (for `openPage`) and `stop`, which ends the browser and removes the profile.
 */
export async function launchHeadlessEdge({ port, width = 1280, height = 800, name = 'e2e' }) {
  const profile = mkdtempSync(join(tmpdir(), `spelunker-${name}-`));
  const browser = spawn(
    EDGE,
    [...QUIET_FLAGS, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'],
    { stdio: 'ignore' },
  );

  const stop = async () => {
    browser.kill();
    await sleep(500);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Edge may still hold the folder for a moment. It is in the temp folder either way.
    }
  };

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const blank = targets.find((target) => target.type === 'page' && target.url === 'about:blank');
      if (blank) return { webSocketDebuggerUrl: blank.webSocketDebuggerUrl, stop };
    } catch {
      // The browser is still starting.
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`headless Edge did not open its debug port ${port}`);
}
