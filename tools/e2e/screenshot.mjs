// Takes the README screenshot: the app in headless Edge against the dev server (mock backend),
// showing the invented documents folder from src/lib/demoFixture.ts, so no real file or folder name
// can appear in it. Nothing here shows a window, takes focus, or sends input to the desktop.
// Usage: start the dev server (npm run dev), then: node screenshot.mjs [out.png] [theme]
//   out.png defaults to ../../docs/images/screenshot.png, theme to dark (or light).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchHeadlessEdge, resizeTo, settleFrames } from './headless.mjs';
import { openPage } from './page.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, '../../docs/images/screenshot.png'));
const theme = process.argv[3] === 'light' ? 'light' : 'dark';
const WIDTH = 1640;
const HEIGHT = 1000;

const edge = await launchHeadlessEdge({ port: 9352, width: WIDTH, height: HEIGHT, name: 'screenshot' });
try {
  const { send, sleep, ev, close } = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2500);
  // A clean start with the chosen theme, as a first run would look, with Matches shown since this
  // is a search for text (it is hidden by default). The preferences are set before the page's own
  // scripts run, because the page saves its own on the way out and would overwrite them.
  const preferences = { theme, columns: { order: [], hidden: [], widths: {}, autoSize: true } };
  // New-document scripts only run once the page domain is enabled.
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('spelunker.preferences.v1', ${JSON.stringify(JSON.stringify(preferences))})`,
  });
  await resizeTo(send, WIDTH, HEIGHT, 1.5);
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2500);

  await ev(`(async () => {
    const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('[role=combobox]', 'C:\\\\Users\\\\sam\\\\Documents');
    set('input[placeholder="Text to find"]', 'invoice');
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('button.go').click();
  })()`);
  await settleFrames(send, 4000);

  // Select the email whose preview is the demo text, with a real click on its row. The list only
  // draws the rows in view, so it is scrolled until that row is drawn, then a little back so a few
  // rows of the same folder show above it.
  const rowPoint = () =>
    ev(`(() => {
      const view = document.querySelector('[role=grid]').getBoundingClientRect();
      const target = [...document.querySelectorAll('[role=row]')].find((r) => r.textContent.includes('invoice-question.eml'));
      if (!target) return null;
      const box = target.getBoundingClientRect();
      // The list keeps a few rows drawn beyond its edges, which a click cannot reach.
      if (box.top < view.top + 30 || box.bottom > view.bottom) return null;
      return { x: box.left + 60, y: box.top + box.height / 2 };
    })()`);
  const grid = `document.querySelector('[role=grid]')`;
  const gridHeight = await ev(`${grid}.clientHeight`);
  const gridLength = await ev(`${grid}.scrollHeight`);
  let point = null;
  for (let top = 0; top < gridLength && !point; top += Math.floor(gridHeight / 2)) {
    await ev(`${grid}.scrollTop = ${top}`);
    await settleFrames(send, 250);
    point = await rowPoint();
  }
  if (!point) {
    const seen = await ev(`({ status: document.querySelector('footer.status')?.innerText, rows: [...document.querySelectorAll('[role=row]')].slice(0, 4).map((r) => r.textContent.slice(0, 80)), lookIn: document.querySelector('[role=combobox]')?.value })`);
    throw new Error(`the demo email is not in the results: ${JSON.stringify(seen)}`);
  }
  // Click until the email is the selected row: a click can land on a row that has just moved.
  const selectedName = () => ev(`document.querySelector('[role=row][aria-selected="true"]')?.textContent ?? ''`);
  for (let attempt = 0; attempt < 6 && !(await selectedName()).includes('invoice-question.eml'); attempt++) {
    point = await rowPoint();
    if (!point) throw new Error('the demo email scrolled out of view');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await settleFrames(send, 1200);
  }
  if (!(await selectedName()).includes('invoice-question.eml')) {
    throw new Error(`could not select the demo email (selected: ${JSON.stringify(await selectedName())}, last click: ${JSON.stringify(point)})`);
  }
  // Selecting can leave the row at an edge of the list, so it is brought to about the middle, with
  // other kinds of file above it.
  await ev(`(() => {
    const view = document.querySelector('[role=grid]');
    const selected = document.querySelector('[role=row][aria-selected="true"]');
    const offset = selected.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientHeight * 0.55;
    view.scrollTop += offset;
  })()`);
  await settleFrames(send, 1500);
  // The pointer is moved off the page, so no row or tile is drawn as hovered.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await settleFrames(send, 600);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(`saved ${out}`);
  close();
} finally {
  await edge.stop();
}
