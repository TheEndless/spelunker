// Checks selecting many rows in the results list: the mouse (click, Ctrl, Shift, press and release),
// the keyboard (Shift, Ctrl, Space, Ctrl+A), what follows the current row (preview, map), the
// context menu on a selection, Enter, and what clears the selection.
//
// node ux8.mjs
//   Runs in headless Edge against the dev server (start it first: npm run dev). Needs no Spelunker
//   window, takes no focus, and sends nothing to the desktop. Every key and mouse event goes through
//   the page's own protocol (Input.dispatchKeyEvent and Input.dispatchMouseEvent).
import { PAGE_HELPERS } from './cdp.mjs';
import { drawFrame, launchHeadlessEdge, settleFrames } from './headless.mjs';
import { createChecker, openPage, sleep } from './page.mjs';

const APP_URL = 'http://localhost:5173/';
const HEADLESS_PORT = 9372;
const CTRL = 2;
const SHIFT = 8;
const TOTAL_ROWS = 100_000;

const { check, summarize } = createChecker();
const skip = (name, reason) => console.log(`SKIP  ${name}  (${reason})`);
const problems = [];
const onEvent = (event) => {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params.exceptionDetails;
    problems.push(`exception: ${details.exception?.description ?? details.text}`);
  } else if (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params.type)) {
    problems.push(`${event.params.type}: ${event.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`);
  }
};

// The page's protocol calls, filled in once the page is open.
let send, ev, key, mouse, setField;

const frame = () => drawFrame(send);
const settle = (milliseconds) => settleFrames(send, milliseconds);

/** Probes that run in the page. Rows are named by their position in the list, read from aria-rowindex. */
const SELECTION_HELPERS = `
  window.__ux8 = {
    rows() {
      return [...document.querySelectorAll('.body .row')].map((row) => {
        const name = row.querySelector('.cell .text').textContent;
        const folder = row.querySelector('.cell[title]:not([title=""])')?.getAttribute('title') ?? '';
        return {
          index: Number(row.getAttribute('aria-rowindex')) - 2,
          name,
          path: folder + '\\\\' + name,
          selected: row.getAttribute('aria-selected'),
          current: row.classList.contains('current'),
        };
      });
    },
    selected() { return window.__ux8.rows().filter((row) => row.selected === 'true').map((row) => row.index); },
    current() { return window.__ux8.rows().filter((row) => row.current).map((row) => row.index); },
    /** Every rendered row has aria-selected set to the string "true" or "false", never missing. */
    allRowsLabelled() { return window.__ux8.rows().every((row) => row.selected === 'true' || row.selected === 'false'); },
    grid() {
      const grid = document.querySelector('[data-pane="results"] [role=grid]');
      return {
        multiselectable: grid.getAttribute('aria-multiselectable'),
        scrollTop: grid.scrollTop,
        focused: document.activeElement === grid,
        activeDescendant: grid.getAttribute('aria-activedescendant'),
      };
    },
    status() {
      return {
        selection: document.querySelector('.status .selection')?.textContent ?? '',
        busy: !!document.querySelector('.status .state.busy'),
        announcement: document.getElementById('selection-announcement')?.textContent ?? '',
        previewName: document.querySelector('aside.preview .title .name')?.textContent ?? null,
      };
    },
    rowPoint(index) {
      const row = document.querySelector('.body .row[aria-rowindex="' + (index + 2) + '"]');
      if (!row) return null;
      const box = row.getBoundingClientRect();
      return { x: box.left + 40, y: box.top + box.height / 2 };
    },
    /** A checksum of the map's overlay canvas, which is where the selected file's outline is drawn. */
    overlay() {
      const source = document.querySelector('[data-map-stage] canvas.overlay');
      if (!source || source.width === 0) return null;
      const copy = document.createElement('canvas');
      copy.width = source.width;
      copy.height = source.height;
      const context = copy.getContext('2d');
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let sum = 0;
      let opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue;
        opaque++;
        sum = (Math.imul(sum, 31) + (i >> 2) + pixels[i + 3]) | 0;
      }
      return { sum, opaque };
    },
    menu() {
      const menu = document.querySelector('.menu[role=menu]');
      return menu ? [...menu.querySelectorAll('[role^=menuitem]')].map((item) => item.textContent.trim()) : null;
    },
    chooseMenuItem(label) {
      const item = [...document.querySelectorAll('.menu[role=menu] [role^=menuitem]')].find((candidate) => candidate.textContent.trim() === label);
      if (!item) return false;
      item.click();
      return true;
    },
    /** The largest file rectangles on the map, as the middle of each. */
    largestFiles(count) {
      return window.__spMapProbe.rects(100000)
        .sort((left, right) => right.width * right.height - left.width * left.height)
        .slice(0, count)
        .map((rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }));
    },
    tooltip() { return document.querySelector('.map .tooltip strong')?.textContent ?? null; },
  };
  window.__ux8Clipboard = [];
  navigator.clipboard.writeText = (text) => { window.__ux8Clipboard.push(text); return Promise.resolve(); };
  window.__ux8Opened = [];
  window.__spOpenPathHook = (path) => { window.__ux8Opened.push(path); };
  window.__ux8Keys = [];
  window.addEventListener('keydown', (event) => window.__ux8Keys.push({ key: event.key, defaultPrevented: event.defaultPrevented }));
  true`;

const rows = () => ev('window.__ux8.rows()');
const selected = () => ev('window.__ux8.selected()');
const current = () => ev('window.__ux8.current()');
const status = () => ev('window.__ux8.status()');
const grid = () => ev('window.__ux8.grid()');
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** A real mouse click on a row, with the given modifiers held. */
async function clickRow(index, modifiers = 0) {
  const point = await ev(`window.__ux8.rowPoint(${index})`);
  if (!point) throw new Error(`row ${index} is not on screen`);
  await mouse('mouseMoved', point.x, point.y, { modifiers });
  await mouse('mousePressed', point.x, point.y, { modifiers });
  await mouse('mouseReleased', point.x, point.y, { modifiers });
  await sleep(200);
}

async function rightClickRow(index) {
  const point = await ev(`window.__ux8.rowPoint(${index})`);
  await mouse('mouseMoved', point.x, point.y);
  await mouse('mousePressed', point.x, point.y, { button: 'right' });
  await mouse('mouseReleased', point.x, point.y, { button: 'right' });
  await sleep(300);
}

const focusGrid = () => ev(`document.querySelector('[data-pane="results"] [role=grid]').focus()`);

/** A fresh selection of one row, with the grid focused. */
async function startFrom(index) {
  await focusGrid();
  await clickRow(index);
}

async function loadFresh() {
  // A page of the same origin that is not the app, so no pending save of the app overwrites this.
  await send('Page.navigate', { url: `${APP_URL}package.json` });
  await sleep(800);
  await ev(`localStorage.setItem('spelunker.preferences.v1', JSON.stringify({ theme: 'light' }))`);
  await send('Page.navigate', { url: APP_URL });
  await sleep(2500);
  await ev(PAGE_HELPERS);
  await ev(SELECTION_HELPERS);
  await frame();
}

/** Starts the search from the Search button and waits until it has finished and the map has laid out. */
async function searchDeep() {
  await setField('[role=combobox]', 'C:\\data');
  await setField('input[placeholder="Text to find"]', 'deep');
  await sleep(300);
  await ev(`document.querySelector('button.go').click()`);
  await sleep(300);
  for (let attempt = 0; attempt < 240 && (await status()).busy; attempt++) {
    await frame();
    await sleep(250);
  }
  await settle(2500);
}

/** Sorts by Size, largest first, so the top rows are the files the map draws biggest. */
async function sortBySizeDescending() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const sort = await ev(`(() => { const head = [...document.querySelectorAll('[role=columnheader]')].find((candidate) => candidate.textContent.trim() === 'Size'); return head.getAttribute('aria-sort'); })()`);
    if (sort === 'descending') return true;
    await ev(`[...document.querySelectorAll('[role=columnheader] button')].find((button) => button.textContent.trim() === 'Size').click()`);
    await settle(500);
  }
  return false;
}

async function browserChecks() {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await loadFresh();
  await searchDeep();
  check('setup: the sort by Size, largest first, took hold', await sortBySizeDescending());
  const loaded = await rows();
  check('setup: the list shows rows from the top, none selected', loaded.length > 10 && loaded[0].index === 0 && loaded.every((row) => row.selected === 'false'), loaded.slice(0, 3));
  await ev('window.__ux8Keys.length = 0');

  // ---- the ARIA state
  const baseline = await grid();
  check('aria-multiselectable is "true" on the grid', baseline.multiselectable === 'true', baseline);
  check('every rendered row carries aria-selected "true" or "false"', await ev('window.__ux8.allRowsLabelled()'));

  // ---- mouse: click, Ctrl, Shift
  await startFrom(3);
  check('click selects exactly that row (aria-selected on row 3 only)', same(await selected(), [3]) && same(await current(), [3]), { selected: await selected(), current: await current() });
  check('a single selection shows no count in the status bar', (await status()).selection === '', await status());

  await clickRow(5, CTRL);
  check('Ctrl+click adds a row: rows 3 and 5 are selected, 5 is current', same(await selected(), [3, 5]) && same(await current(), [5]), { selected: await selected(), current: await current() });
  check('two selected rows show "2 selected" with a size in the status bar', /^2 selected, \S+ ?\S*$/.test((await status()).selection), (await status()).selection);
  await clickRow(3, CTRL);
  check('Ctrl+click on a selected row removes it: only row 5 stays', same(await selected(), [5]), await selected());

  await clickRow(4);
  await clickRow(7, SHIFT);
  check('Shift+click selects the range from the anchor down: rows 4 to 7', same(await selected(), range(4, 7)) && same(await current(), [7]), { selected: await selected(), current: await current() });
  await clickRow(1, SHIFT);
  check('Shift+click above the anchor selects upward and drops the old range: rows 1 to 4', same(await selected(), range(1, 4)) && same(await current(), [1]), { selected: await selected(), current: await current() });

  await clickRow(1);
  await clickRow(3, CTRL | SHIFT);
  check('Ctrl+Shift+click adds a range to the selection: rows 1 to 3', same(await selected(), range(1, 3)), await selected());
  await clickRow(6, CTRL);
  await clickRow(8, CTRL | SHIFT);
  check('Ctrl+Shift+click keeps what was selected before: rows 1 to 3 and 6 to 8', same(await selected(), [1, 2, 3, 6, 7, 8]), await selected());

  // ---- keyboard: Shift+Arrow, Ctrl+Arrow, Ctrl+Space
  await startFrom(5);
  await key('ArrowDown', { shift: true });
  await key('ArrowDown', { shift: true });
  check('Shift+Down twice extends the selection: rows 5 to 7, 7 current', same(await selected(), [5, 6, 7]) && same(await current(), [7]), { selected: await selected(), current: await current() });
  await key('ArrowUp', { shift: true });
  check('Shift+Up shrinks it back: rows 5 and 6, 6 current', same(await selected(), [5, 6]) && same(await current(), [6]), { selected: await selected(), current: await current() });
  await key('ArrowUp', { shift: true });
  await key('ArrowUp', { shift: true });
  check('Shift+Up past the anchor extends upward: rows 4 and 5', same(await selected(), [4, 5]) && same(await current(), [4]), { selected: await selected(), current: await current() });

  await startFrom(5);
  await key('ArrowDown', { shift: true });
  await key('ArrowDown', { ctrl: true });
  const afterCtrlArrow = await grid();
  check('Ctrl+Down moves the current row to 7 and leaves rows 5 and 6 selected', same(await selected(), [5, 6]) && same(await current(), [7]) && afterCtrlArrow.activeDescendant === 'result-row-7', { selected: await selected(), current: await current(), activeDescendant: afterCtrlArrow.activeDescendant });
  await key(' ', { ctrl: true });
  check('Ctrl+Space selects the current row: rows 5 to 7', same(await selected(), [5, 6, 7]), await selected());
  await key(' ', { ctrl: true });
  check('Ctrl+Space again deselects it: rows 5 and 6', same(await selected(), [5, 6]), await selected());

  // ---- the current row drives the preview and the map
  await previewAndMapChecks();

  // ---- Space does not scroll, Enter opens only the current row
  await startFrom(2);
  await clickRow(5, SHIFT);
  await ev('window.__ux8Keys.length = 0');
  const scrollBefore = (await grid()).scrollTop;
  await key(' ');
  await key(' ', { shift: true });
  const spaces = await ev('window.__ux8Keys');
  check('Space and Shift+Space are claimed by the grid (default prevented), so it does not scroll', spaces.length === 2 && spaces.every((entry) => entry.key === ' ' && entry.defaultPrevented) && (await grid()).scrollTop === scrollBefore, { spaces, scrollBefore, after: (await grid()).scrollTop });
  check('Space leaves the selection alone: rows 2 to 5', same(await selected(), range(2, 5)), await selected());

  await ev('window.__ux8Opened.length = 0');
  const currentRow = (await rows()).find((row) => row.current);
  await key('Enter');
  const opened = await ev('window.__ux8Opened');
  check('Enter opens only the current row, once, not the other selected rows', opened.length === 1 && opened[0] === currentRow.path, { opened, wanted: currentRow.path });

  // ---- Ctrl+A
  await startFrom(2);
  await key('a', { ctrl: true });
  const allStatus = await status();
  const allSelectedRendered = (await rows()).every((row) => row.selected === 'true');
  check(`Ctrl+A selects all ${TOTAL_ROWS.toLocaleString('en-US')} rows: the status bar says so, with a size`, new RegExp(`^${TOTAL_ROWS.toLocaleString('en-US')} selected, \\d`).test(allStatus.selection), allStatus.selection);
  check('after Ctrl+A every rendered row has aria-selected "true"', allSelectedRendered, (await rows()).map((row) => row.selected));
  await sleep(600);
  check('and the count is announced to screen readers', (await status()).announcement === `${TOTAL_ROWS.toLocaleString('en-US')} selected`, (await status()).announcement);

  // ---- a plain arrow collapses
  await startFrom(3);
  await clickRow(6, SHIFT);
  await key('ArrowDown');
  check('a plain Arrow key collapses the selection to the one new current row (7)', same(await selected(), [7]) && same(await current(), [7]), { selected: await selected(), current: await current() });

  // ---- press and release on a selected row
  await startFrom(2);
  await clickRow(5, SHIFT);
  await clickRow(3);
  check('press and release on a selected row, without moving, collapses to that row', same(await selected(), [3]), await selected());

  await startFrom(2);
  await clickRow(5, SHIFT);
  const press = await ev('window.__ux8.rowPoint(3)');
  await mouse('mouseMoved', press.x, press.y);
  await mouse('mousePressed', press.x, press.y);
  for (let step = 1; step <= 4; step++) {
    await mouse('mouseMoved', press.x + 4 * step, press.y + 2 * step, { buttons: 1 });
    await sleep(30);
  }
  await mouse('mouseReleased', press.x + 16, press.y + 8);
  await sleep(250);
  check('press, move 18 px, release on a selected row keeps the whole selection (rows 2 to 5)', same(await selected(), range(2, 5)), await selected());

  // ---- the context menu
  await contextMenuChecks();

  // ---- Ctrl+A in the Containing text box
  await startFrom(2);
  await clickRow(4, SHIFT);
  await setField('input[placeholder="Text to find"]', 'abc def');
  await ev(`document.querySelector('input[placeholder="Text to find"]').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: CTRL, commands: ['selectAll'] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: CTRL });
  await sleep(200);
  const textBox = await ev(`(() => { const box = document.querySelector('input[placeholder="Text to find"]'); return { start: box.selectionStart, end: box.selectionEnd, length: box.value.length, focused: document.activeElement === box }; })()`);
  check('Ctrl+A in the Containing text box selects the text in the box', textBox.focused && textBox.start === 0 && textBox.end === textBox.length && textBox.length === 7, textBox);
  check('and does not select the rows (still rows 2 to 4, no "N selected" for 100,000)', same(await selected(), range(2, 4)) && (await status()).selection.startsWith('3 selected'), { selected: await selected(), status: (await status()).selection });

  // ---- a new search clears the selection
  await setField('input[placeholder="Text to find"]', 'deep');
  await ev(`document.querySelector('button.go').click()`);
  await sleep(150);
  const duringSearch = await rows();
  check('a new search clears the selection at once: no row selected or current, no count', duringSearch.every((row) => row.selected === 'false' && !row.current) && (await status()).selection === '', { selected: await selected(), status: (await status()).selection });
  for (let attempt = 0; attempt < 240 && (await status()).busy; attempt++) {
    await frame();
    await sleep(250);
  }
  await settle(800);
  const afterSearch = await status();
  check('the new search\'s results come up with nothing selected and an empty preview', (await selected()).length === 0 && (await current()).length === 0 && afterSearch.previewName === 'Preview', { selected: await selected(), preview: afterSearch.previewName });

  skip('removing rows prunes the selection', 'rows are removed only after the system menu ran a shell command, which a plain browser has no way to do, and no DEV probe exposes the session. The pruning rule itself is covered by pruneSelection in selection.test.ts');
}

/**
 * The preview header and the map's outline follow the current row, not the first or last selected.
 * The map is compared with what a plain click on that same row draws, using two neighbouring rows
 * whose outlines differ (the largest files are drawn as their own rectangles).
 */
async function previewAndMapChecks() {
  await mouse('mouseMoved', 5, 5);
  const outlines = [];
  for (let index = 0; index <= 9; index++) {
    await focusGrid();
    await clickRow(index);
    await settle(400);
    await mouse('mouseMoved', 5, 5);
    await sleep(100);
    outlines.push(await ev('window.__ux8.overlay()'));
  }
  let first = -1;
  for (let index = 0; index < 9; index++) {
    if (outlines[index] && outlines[index + 1] && outlines[index].opaque > 0 && outlines[index + 1].opaque > 0 && outlines[index].sum !== outlines[index + 1].sum) {
      first = index;
      break;
    }
  }
  check('the map outlines a different rectangle for two neighbouring large rows (precondition for the map checks)', first >= 0, outlines);
  if (first < 0) return;
  const second = first + 1;
  const listRows = await rows();
  const secondName = listRows.find((row) => row.index === second).name;
  const firstName = listRows.find((row) => row.index === first).name;

  await startFrom(first);
  await key('ArrowDown', { shift: true });
  await settle(500);
  await mouse('mouseMoved', 5, 5);
  const afterShift = await ev('window.__ux8.overlay()');
  const shiftStatus = await status();
  check(`Shift+Down: rows ${first} and ${second} selected, ${second} current, the preview header names the current row (${secondName}) and not the anchor`, same(await selected(), [first, second]) && same(await current(), [second]) && shiftStatus.previewName === secondName && shiftStatus.previewName !== firstName, { selected: await selected(), preview: shiftStatus.previewName, secondName, firstName });
  check('Shift+Down: the map outline is the current row\'s, the same picture as a plain click on it', afterShift?.sum === outlines[second].sum && afterShift.sum !== outlines[first].sum, { afterShift, wanted: outlines[second], anchorOutline: outlines[first] });

  await startFrom(first);
  await key('ArrowDown', { ctrl: true });
  await settle(500);
  await mouse('mouseMoved', 5, 5);
  const afterCtrl = await ev('window.__ux8.overlay()');
  check(`Ctrl+Down: the selection stays on row ${first}, the preview header and the map move to the current row ${second}`, same(await selected(), [first]) && same(await current(), [second]) && (await status()).previewName === secondName && afterCtrl?.sum === outlines[second].sum, { selected: await selected(), current: await current(), preview: (await status()).previewName, afterCtrl, wanted: outlines[second] });

  // Clicking a rectangle on the map collapses a many-row selection to that file.
  await startFrom(0);
  await clickRow(4, SHIFT);
  const manySelected = await selected();
  const [target] = await ev('window.__ux8.largestFiles(1)');
  await mouse('mouseMoved', target.x, target.y);
  await sleep(250);
  await frame();
  const hoveredName = await ev('window.__ux8.tooltip()');
  await mouse('mousePressed', target.x, target.y);
  await mouse('mouseReleased', target.x, target.y);
  await settle(700);
  const afterMapClick = await rows();
  const selectedAfter = afterMapClick.filter((row) => row.selected === 'true');
  check('clicking a map rectangle collapses the selection to that file: five rows were selected, now one named like the rectangle', manySelected.length === 5 && hoveredName !== null && selectedAfter.length === 1 && selectedAfter[0].name === hoveredName && (await status()).selection === '' && (await status()).previewName === hoveredName, { before: manySelected, hoveredName, selectedAfter: selectedAfter.map((row) => row.name), status: await status() });
}

/** A right-click on the selection and on an unselected row, and what the app's menu offers. */
async function contextMenuChecks() {
  const shellMenuCalls = () => ev('window.__sp.shellMenuCalls.length');
  const callsBefore = await shellMenuCalls();
  await startFrom(2);
  await clickRow(5, SHIFT);
  await clickRow(8, CTRL);
  const wantedRows = (await rows()).filter((row) => [2, 3, 4, 5, 8].includes(row.index));
  await rightClickRow(4);
  check('right-click on a selected row keeps the selection (rows 2 to 5 and 8)', same(await selected(), [2, 3, 4, 5, 8]), await selected());
  const manyMenu = await ev('window.__ux8.menu()');
  check('the menu for several rows offers exactly Copy paths and Copy names', same(manyMenu, ['Copy paths', 'Copy names']), manyMenu);
  await ev('window.__ux8Clipboard.length = 0');
  await ev(`window.__ux8.chooseMenuItem('Copy paths')`);
  await sleep(250);
  const copied = await ev('window.__ux8Clipboard');
  check('Copy paths copies the path of every selected row, in list order', same(copied, [wantedRows.map((row) => row.path).join('\r\n')]), { copied, wanted: wantedRows.map((row) => row.path) });
  check('the menu closes after the choice', (await ev('window.__ux8.menu()')) === null);

  await ev('window.__ux8Clipboard.length = 0');
  await rightClickRow(8);
  await ev(`window.__ux8.chooseMenuItem('Copy names')`);
  await sleep(250);
  check('Copy names copies the file name of every selected row, in list order', same(await ev('window.__ux8Clipboard'), [wantedRows.map((row) => row.name).join('\r\n')]), await ev('window.__ux8Clipboard'));

  await rightClickRow(10);
  check('right-click on an unselected row selects only that row (row 10)', same(await selected(), [10]) && same(await current(), [10]), { selected: await selected(), current: await current() });
  const oneMenu = await ev('window.__ux8.menu()');
  check('the menu for one row offers Copy path and Copy name, and not the several-row entries', Array.isArray(oneMenu) && oneMenu.includes('Copy path') && oneMenu.includes('Copy name') && !oneMenu.includes('Copy paths') && !oneMenu.includes('Copy names'), oneMenu);
  await key('Escape');
  check('Escape closes the menu', (await ev('window.__ux8.menu()')) === null);
  check('no Windows menu was asked for (there is none in a plain browser)', (await shellMenuCalls()) === callsBefore, await shellMenuCalls());
}

let edge = null;
let page = null;
try {
  // Both inside the try, so a browser that starts but cannot be reached is still stopped.
  edge = await launchHeadlessEdge({ port: HEADLESS_PORT, name: 'ux8' });
  page = await openPage({ webSocketDebuggerUrl: edge.webSocketDebuggerUrl, onEvent });
  ({ send, ev, key, mouse, setField } = page);
  await browserChecks();
} catch (error) {
  check('the suite ran to the end', false, String(error?.stack ?? error));
} finally {
  check('no console errors, warnings, or exceptions', problems.length === 0, problems);
  summarize();
  page?.close();
  await edge?.stop();
}
