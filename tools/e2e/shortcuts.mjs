// Checks the keyboard shortcuts dialog: opening with its button and with F1, the sections and keys,
// that nothing scrolls sideways at any size, that it stays inside a short or narrow window and
// scrolls only up and down there, Escape and the backdrop closing it, focus going back, and Tab
// staying inside while it is open. It runs the page in headless Edge against the dev server (mock
// backend), so it needs no Spelunker window and takes no focus.
// Usage: start the dev server (npm run dev), then: node shortcuts.mjs
import { launchHeadlessEdge, resizeTo } from './headless.mjs';
import { createChecker, openPage } from './page.mjs';

const edge = await launchHeadlessEdge({ port: 9392, width: 1400, height: 880, name: 'shortcuts' });
const { check, summarize } = createChecker();
try {
  const { send, sleep, ev, key, close } = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2500);

  const isOpen = () => ev(`!!document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]')`);
  const layout = () =>
    ev(`(() => {
      const dialog = document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]').getBoundingClientRect();
      const list = document.querySelector('.groups');
      return { top: Math.round(dialog.top), bottom: Math.round(dialog.bottom), left: Math.round(dialog.left), right: Math.round(dialog.right), viewport: [innerWidth, innerHeight], scrollsSideways: list.scrollWidth > list.clientWidth + 1, scrollsUpDown: list.scrollHeight > list.clientHeight + 1 };
    })()`);

  // ---- opening and what it shows
  const button = `document.querySelector('button[aria-label="Keyboard shortcuts"]')`;
  await ev(`${button}.focus()`);
  await ev(`${button}.click()`);
  await sleep(300);
  check('the button opens the dialog', await isOpen());
  check('the dialog is modal and named', await ev(`(() => { const dialog = document.querySelector('[role=dialog][aria-label="Keyboard shortcuts"]'); return dialog.getAttribute('aria-modal') === 'true'; })()`));
  const headings = await ev(`[...document.querySelectorAll('.dialog h3')].map((heading) => heading.textContent.trim())`);
  check('it has the six sections', JSON.stringify(headings) === JSON.stringify(['Search', 'Results', 'General', 'Column headings', 'Results map', 'Panes']), headings);
  const content = await ev(`({ rows: document.querySelectorAll('.dialog li').length, keys: document.querySelectorAll('.dialog kbd').length, emptyKeys: [...document.querySelectorAll('.dialog kbd')].filter((key) => key.textContent.trim() === '').length })`);
  check('every shortcut has its keys shown', content.rows >= 30 && content.keys >= content.rows && content.emptyKeys === 0, content);
  check('the place a key works is shown under its action, not mixed into the key', await ev(`[...document.querySelectorAll('.dialog .where')].map((where) => where.textContent.trim()).join('|')`) === 'On the preview splitter|On the map splitter');
  check('focus starts on the close button', await ev(`document.activeElement?.getAttribute('aria-label') === 'Close the shortcuts'`));

  // ---- size: a roomy window shows everything, and no size scrolls sideways
  const roomy = await layout();
  check('in a roomy window everything is shown without scrolling', !roomy.scrollsSideways && !roomy.scrollsUpDown, roomy);
  const widths = [];
  for (const [width, height] of [[1000, 700], [800, 600], [640, 520], [560, 520]]) {
    await resizeTo(send, width, height);
    await sleep(350);
    const size = await layout();
    widths.push({ width, height, ...size });
  }
  check('at no size does it scroll sideways', widths.every((size) => !size.scrollsSideways), widths.map((size) => [size.width, size.scrollsSideways]));
  check('at every size the dialog stays inside the window', widths.every((size) => size.top >= 0 && size.left >= 0 && size.bottom <= size.viewport[1] && size.right <= size.viewport[0]), widths);
  check('in a short window the list scrolls up and down instead', widths.find((size) => size.height === 520).scrollsUpDown === true, widths.find((size) => size.height === 520));
  const narrow = await ev(`(() => { const columns = [...document.querySelectorAll('.dialog .column')].map((column) => Math.round(column.getBoundingClientRect().left)); return columns; })()`);
  check('in a narrow window the two columns stack', narrow.length === 2 && narrow[0] === narrow[1], narrow);
  await resizeTo(send, 1400, 880);
  await sleep(350);

  // ---- keyboard
  for (let press = 0; press < 5; press++) await key('Tab');
  check('Tab stays inside while it is open', await ev(`!!document.activeElement.closest('[role=dialog][aria-label="Keyboard shortcuts"]')`));
  await key('Escape');
  await sleep(250);
  check('Escape closes it', !(await isOpen()));
  check('focus goes back to the button that opened it', await ev(`document.activeElement === ${button}`));

  await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
  await key('F1');
  await sleep(300);
  check('F1 opens it from anywhere', await isOpen());
  await ev(`document.querySelector('.backdrop').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await sleep(250);
  check('clicking outside closes it', !(await isOpen()));
  check('focus goes back to the field F1 was pressed in', await ev(`document.activeElement === document.querySelector('input[placeholder="Text to find"]')`));

  summarize();
  close();
} finally {
  await edge.stop();
}
