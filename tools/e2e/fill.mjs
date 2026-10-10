// Checks that the results columns always fill their pane as the window changes size, in automatic
// and in hand-sized mode. It runs the page in headless Edge against the dev server (mock backend),
// because that reports resizes the way a real window does, and needs no Spelunker window.
// Usage: start the dev server (npm run dev), then: node fill.mjs
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9341;
const profile = mkdtempSync(join(tmpdir(), 'spelunker-fill-'));
const browser = spawn(edge, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,780', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let targets;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    if (targets.some((target) => target.type === 'page')) break;
  } catch {
    // The browser is still starting.
  }
  await sleep(250);
}
const page = targets.find((target) => target.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (socket.onopen = resolve));
let nextId = 1;
const pending = new Map();
socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) pending.get(data.id)(data);
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result.exceptionDetails) return { exception: reply.result.exceptionDetails.exception?.description ?? reply.result.exceptionDetails.text };
  return reply.result.result.value;
};
const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + JSON.stringify(detail)}`);
};
const resizeTo = async (width, height) => {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  // Headless Edge only runs the rendering steps (where resize events and size observers fire) when a
  // frame is drawn, so one is asked for, as a real window draws them on its own.
  await send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
  await sleep(700);
};
/** How well the columns fill the grid: header total against the grid, and whether it scrolls sideways. */
const fill = () =>
  ev(`(() => { const g = document.querySelector('[role=grid]'); const heads = [...document.querySelectorAll('.head')].map((h) => h.getBoundingClientRect().width); const total = heads.reduce((a, b) => a + b, 0); return { pane: g.clientWidth, total: Math.round(total), gap: Math.round(g.clientWidth - total), scrolls: g.scrollWidth > g.clientWidth + 1 }; })()`);
const fills = (state) => !state.scrolls && state.gap >= 0 && state.gap <= 40;

await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`localStorage.removeItem('spelunker.preferences.v1')`);
await resizeTo(1280, 780);
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`(async () => {
  const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('[role=combobox]', 'C:/Windows');
  set('input[placeholder="Text to find"]', 'a');
  await new Promise((r) => setTimeout(r, 300));
  document.querySelector('button.go').click();
  await new Promise((r) => setTimeout(r, 2500));
})()`);

// ---- automatic mode
const startState = await fill();
check('automatic: the columns fill the pane at 1280', fills(startState), startState);
await resizeTo(1900, 900);
const wide = await fill();
check('automatic: they follow the window when it widens', fills(wide) && wide.total > startState.total + 300, { startState, wide });
await resizeTo(1000, 650);
const narrow = await fill();
check('automatic: and when it narrows', fills(narrow) && narrow.total < startState.total, { startState, narrow });

// ---- hand-sized mode: a drag on a column edge, which switches automatic fitting off
await resizeTo(1280, 780);
const dragged = await ev(`(async () => {
  const handle = document.querySelectorAll('.resizer')[0];
  const x = handle.getBoundingClientRect().left + 3;
  handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, button: 0, bubbles: true, cancelable: true, pointerId: 1 }));
  for (let i = 1; i <= 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + i * 15, bubbles: true, pointerId: 1 })); await new Promise((r) => setTimeout(r, 20)); }
  window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + 90, bubbles: true, pointerId: 1 }));
  await new Promise((r) => setTimeout(r, 500));
  return JSON.parse(localStorage.getItem('spelunker.preferences.v1')).columns.autoSize;
})()`);
check('a drag turns automatic fitting off', dragged === false, dragged);
const afterDrag = await fill();
check('hand-sized: the pane is still filled right after the drag (neighbours gave up the room)', fills(afterDrag), afterDrag);
await resizeTo(1900, 900);
const handWide = await fill();
check('hand-sized: the columns still widen with the window', fills(handWide) && handWide.total > afterDrag.total + 300, { afterDrag, handWide });
await resizeTo(1000, 650);
const handNarrow = await fill();
check('hand-sized: and narrow with it', fills(handNarrow) && handNarrow.total < afterDrag.total, { afterDrag, handNarrow });

// ---- hiding the preview gives the grid the whole width
await resizeTo(1280, 780);
const beforeHide = await fill();
await ev(`document.querySelector('button[aria-label="Hide the preview"]').click()`);
await sleep(400);
await send('Page.captureScreenshot', { format: 'jpeg', quality: 10 });
await sleep(700);
const afterHide = await fill();
check('hiding the preview widens the columns to the full width', fills(afterHide) && afterHide.total > beforeHide.total + 300, { beforeHide, afterHide });

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
socket.close();
browser.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // Edge may still hold the folder for a moment. It is in the temp folder either way.
}
