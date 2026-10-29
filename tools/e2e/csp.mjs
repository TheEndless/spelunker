// Checks the production Content Security Policy from tauri.conf.json against the built frontend.
// Tauri applies that policy only to the pages it serves itself, which a dev window does not (it
// loads the Vite server), so this serves dist/ over HTTP with the policy as a response header and
// loads it in headless Edge with the mock backend. It first proves the policy is enforced, by making
// the page do three things the policy forbids and expecting each to be reported, then drives the
// app (a search, the map and its worker, the preview, the settings dialog) and expects no violation.
// What it cannot reach is the real asset protocol and IPC, which need the release exe (see
// release-check.ps1 and README.md). Run `npm run build` first. Needs no window and takes no focus.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHeadlessEdge, settleFrames } from './headless.mjs';
import { createChecker, openPage } from './page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', '..', 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing: run npm run build first');
const config = JSON.parse(readFileSync(resolve(here, '..', '..', 'src-tauri', 'tauri.conf.json'), 'utf8'));
const policy = config.app.security.csp;
if (typeof policy !== 'string') throw new Error('tauri.conf.json has no csp string');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname;
  const file = join(dist, name === '/' ? 'index.html' : name);
  if (!file.startsWith(dist) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': policy });
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const address = `http://127.0.0.1:${server.address().port}/`;

const { check, summarize } = createChecker();
const edge = await launchHeadlessEdge({ port: 9381, width: 1280, height: 800, name: 'csp' });
try {
  const { send, sleep, ev, close } = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl });
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__violations = [];
      document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(event.violatedDirective + ' ' + event.blockedURI));`,
  });
  await send('Page.navigate', { url: address });
  await sleep(3000);

  // Proof that the policy is enforced and that a violation is seen: three things it forbids.
  await ev(`(async () => {
    try { await fetch('http://example.com/x'); } catch {}
    const script = document.createElement('script');
    script.textContent = 'window.__ran = true';
    document.head.appendChild(script);
    const frame = document.createElement('iframe');
    frame.src = 'http://example.com/';
    document.body.appendChild(frame);
    await new Promise((resolve) => setTimeout(resolve, 600));
  })()`);
  const forbidden = await ev('window.__violations');
  check('the policy is enforced: a request, an inline script and a frame it forbids are all reported', forbidden.length >= 3 && (await ev('window.__ran')) !== true, forbidden);

  // Start again clean, then use the app.
  await send('Page.navigate', { url: address });
  await sleep(3000);
  await ev(`(async () => {
    const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('[role=combobox]', 'C:\\\\Windows');
    set('input[placeholder="Text to find"]', 'deep');
    await new Promise((resolve) => setTimeout(resolve, 300));
    document.querySelector('button.go').click();
    await new Promise((resolve) => setTimeout(resolve, 3500));
  })()`);
  await settleFrames(send, 1500);
  const rows = await ev(`document.querySelectorAll('[role=row]').length`);
  check('the app searches and lists results under the policy', rows > 5, rows);
  const map = await ev(`(() => { const canvas = document.querySelector('.map canvas'); return canvas ? canvas.width : 0; })()`);
  check('the map and its worker run under the policy', map > 0, map);
  await ev(`(() => { const row = [...document.querySelectorAll('[role=row]')][3]; row.click(); })()`);
  await settleFrames(send, 1500);
  const preview = await ev(`document.querySelectorAll('.preview .line').length`);
  check('the preview shows file text under the policy', preview > 0, preview);
  await ev(`document.querySelector('button[aria-label="Settings"], button[title^="Settings"]')?.click()`);
  await settleFrames(send, 800);
  check('the settings dialog opens under the policy', await ev(`!!document.querySelector('[role=dialog][aria-labelledby="settings-title"]')`));

  const violations = await ev('window.__violations');
  check('using the app reported no policy violation', violations.length === 0, violations);
  close();
} finally {
  await edge.stop();
  server.close();
}
summarize();
